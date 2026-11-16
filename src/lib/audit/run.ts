import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetch, UnsafeUrlError } from "@/lib/security/safe-fetch";
import { analyseHtml, emptyObservations, robotsDisallowsRoot, type Observations } from "./observe";
import { scoreOpportunity, type Criterion, type ScoreResult } from "./score";
import { aiAvailable } from "@/lib/ai/client";
import { runAuditAgent, type AuditJudgement } from "@/lib/ai/agents/audit-agent";
import { industryById } from "@/lib/industries";
import { mobileRenderCheck } from "./mobile-render";

export interface BusinessRow {
  id: string;
  organisation_id: string;
  name: string;
  category: string | null;
  sector: string | null;
  city: string | null;
  country_code: string;
  website_url: string | null;
  email: string | null;
  phone: string | null;
  contact_page_url: string | null;
  is_demo: boolean;
  industry_id: string | null;
}

export async function observeWebsite(url: string, opts: { checkLinks?: number } = {}): Promise<Observations> {
  let robotsDisallowed = false;
  try {
    const robots = await safeFetch(new URL("/robots.txt", url).toString(), { timeoutMs: 8000, maxBytes: 200_000 });
    if (robots.status === 200) robotsDisallowed = robotsDisallowsRoot(robots.body);
  } catch {
    /* robots.txt unavailable: proceed */
  }

  let res;
  try {
    res = await safeFetch(url);
  } catch (e) {
    const msg = e instanceof UnsafeUrlError ? `Blocked for safety: ${e.message}` : (e as Error).message || "Request failed";
    return emptyObservations({ error: msg, robotsDisallowed });
  }

  const final = new URL(res.url);
  const base = emptyObservations({
    fetched: true,
    finalUrl: res.url,
    httpStatus: res.status,
    https: final.protocol === "https:",
    redirectedToHttps: new URL(url).protocol === "http:" && final.protocol === "https:",
    timeToFirstByteMs: res.timeToFirstByteMs,
    totalTimeMs: res.elapsedMs,
    pageBytes: res.bytes,
    robotsDisallowed,
  });
  if (res.status >= 400 || !(res.headers["content-type"] ?? "text/html").includes("html")) return base;

  const obs: Observations = { ...base, ...analyseHtml(res.body, res.url) };

  // Broken link check on a sample of internal links, unless robots.txt asks us not to crawl.
  if (!robotsDisallowed) {
    const sample = obs.internalLinks.filter((l) => l !== res.url).slice(0, opts.checkLinks ?? 12);
    const results = await mapLimit(sample, 4, async (link) => {
      try {
        let r = await safeFetch(link, { method: "HEAD", timeoutMs: 8000 });
        if (r.status === 405 || r.status === 501) r = await safeFetch(link, { timeoutMs: 8000, maxBytes: 50_000 });
        return { url: link, status: r.status as number | string };
      } catch (e) {
        return { url: link, status: (e as Error).message.slice(0, 80) };
      }
    });
    obs.linksChecked = results.length;
    obs.brokenLinks = results.filter((r) => typeof r.status !== "number" || r.status >= 400);
  }

  const mobile = await mobileRenderCheck(res.url);
  obs.mobileRender = mobile.checked ? { checked: true, horizontalOverflow: mobile.horizontalOverflow, viewportWidth: mobile.viewportWidth, contentWidth: mobile.contentWidth } : null;
  return obs;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/** Rule-based write-up used when AI is unavailable (labelled as such). */
export function ruleBasedFindings(criteria: Criterion[], industryLabel: string | undefined) {
  const problems = criteria
    .filter((c) => c.points > 0)
    .map((c) => ({ title: c.label, detail: c.reason, basis: c.basis, severity: c.points / c.weight > 0.6 ? "high" : c.points / c.weight > 0.3 ? "medium" : "low" }));
  const fix: Record<string, string> = {
    website_presence: "Launch a fast, mobile-first website with clear contact details.",
    mobile: "Rebuild layouts to be responsive so pages fit and read well on phones.",
    performance: "Reduce page weight and script count; serve over a CDN.",
    security: "Serve the whole site over HTTPS with modern TLS.",
    enquiry_booking: "Add a simple enquiry form and, where relevant, online booking.",
    contact_info: "Show tap-to-call and an email or contact page on every page.",
    outdated_tech: "Replace obsolete markup and plugins with modern, standards-based code.",
    seo: "Add descriptive titles, meta descriptions, headings and structured data.",
    accessibility: "Declare the page language and give every meaningful image alt text.",
    technical: "Fix or remove broken links.",
    ai_design: "Refresh the visual design and simplify navigation.",
  };
  const improvements = criteria.filter((c) => c.points > 0).map((c) => ({ title: c.label, detail: fix[c.id] ?? "" }));
  const recommendations = [
    { title: `Pages for a ${industryLabel ?? "local business"}`, detail: "Home, services, about, gallery and contact, with the main call to action visible on every screen." },
  ];
  return { problems, improvements, recommendations };
}

export interface AuditOutcome {
  auditId: string;
  score: ScoreResult;
  usedAi: boolean;
}

export async function auditBusiness(db: SupabaseClient, business: BusinessRow, opts: { threshold: number; actorId?: string | null }): Promise<AuditOutcome> {
  const org = business.organisation_id;
  const industry = industryById(business.industry_id ?? INDUSTRY_FROM_CATEGORY(business));
  const hasWebsite = Boolean(business.website_url);

  // Demo sites use reserved .example domains: never fetched, recorded as not reachable.
  const obs: Observations | null = hasWebsite
    ? business.is_demo
      ? emptyObservations({ error: "Demo record: reserved .example domain is not fetched." })
      : await observeWebsite(business.website_url!)
    : null;

  let judgement: AuditJudgement | null = null;
  let usedAi = false;
  if (obs?.fetched && aiAvailable()) {
    const r = await runAuditAgent({ db, organisationId: org, business, observations: obs });
    judgement = r.output;
    usedAi = true;
  }

  const publicEmail = business.email ?? obs?.publishedEmails.find((e) => sameSite(e, business.website_url)) ?? null;
  const score = scoreOpportunity(
    obs,
    {
      hasWebsite,
      bookingRelevant: industry?.bookingRelevant ?? false,
      publicEmail,
      contactPageUrl: business.contact_page_url ?? obs?.contactPageUrl ?? null,
      phone: business.phone,
      threshold: opts.threshold,
    },
    { visualQuality: judgement?.visual_quality ?? null, navigationClarity: judgement?.navigation_clarity ?? null },
  );

  const findings = judgement
    ? { problems: judgement.problems, improvements: judgement.improvements, recommendations: judgement.business_recommendations }
    : ruleBasedFindings(score.criteria, industry?.label);

  const { data: audit, error } = await db
    .from("website_audits")
    .insert({
      organisation_id: org,
      business_id: business.id,
      url: business.website_url,
      status: "completed",
      observed: obs ?? { noWebsite: true },
      judgements: judgement
        ? { source: "ai", visual_quality: judgement.visual_quality, visual_quality_rationale: judgement.visual_quality_rationale, navigation_clarity: judgement.navigation_clarity, navigation_rationale: judgement.navigation_rationale, cta_assessment: judgement.cta_assessment }
        : { source: "rule_based", note: aiAvailable() ? "No website content to judge." : "AI not configured: findings are rule-based from observed facts only." },
      audit_score: score.auditScore,
      problems: findings.problems,
      improvements: findings.improvements,
      recommendations: findings.recommendations,
      error: obs?.error ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: sErr } = await db.from("opportunity_scores").insert({
    organisation_id: org,
    business_id: business.id,
    audit_id: audit.id,
    score: score.score,
    qualified: score.qualified,
    threshold: score.threshold,
    breakdown: { criteria: score.criteria, reasons: score.reasons, contactable: score.contactable, opportunityType: score.opportunityType },
    weights_version: score.weightsVersion,
  });
  if (sErr) throw sErr;

  const patch: Record<string, unknown> = {
    lead_score: score.score,
    opportunity_type: score.opportunityType,
    status: score.qualified ? "qualified" : "not_qualified",
  };
  // Fill contact details only from the business's own website (published by them).
  if (!business.email && publicEmail) patch.email = publicEmail;
  if (!business.contact_page_url && obs?.contactPageUrl) patch.contact_page_url = obs.contactPageUrl;
  const est = industry?.typicalProjectValue;
  if (est && score.qualified) patch.estimated_value = est;

  const { error: uErr } = await db.from("businesses").update(patch).eq("id", business.id).eq("organisation_id", org).in("status", ["new", "researching", "qualified", "not_qualified"]);
  if (uErr) throw uErr;

  await db.from("crm_activities").insert({
    organisation_id: org,
    business_id: business.id,
    type: "audited",
    summary: `Audited: opportunity score ${score.score} (${score.qualified ? "qualified" : "not qualified"})`,
    data: { audit_id: audit.id, used_ai: usedAi },
    actor_id: opts.actorId ?? null,
  });

  return { auditId: audit.id, score, usedAi };
}

function sameSite(email: string, website: string | null): boolean {
  if (!website) return false;
  try {
    const host = new URL(website).hostname.replace(/^www\./, "");
    const domain = email.split("@")[1];
    return domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

function INDUSTRY_FROM_CATEGORY(b: BusinessRow): string | undefined {
  const c = `${b.category ?? ""}`.toLowerCase();
  const map: [RegExp, string][] = [
    [/restaurant/, "restaurant"], [/cafe|coffee/, "cafe"], [/hotel|guest|lodging/, "hotel"], [/beauty|nail|spa/, "beauty_salon"],
    [/barber|hair/, "barbershop"], [/dent/, "dentist"], [/construct|builder|contractor/, "construction"], [/plumb/, "plumber"],
    [/electric/, "electrician"], [/mechanic|car repair/, "mechanic"], [/estate|real estate/, "estate_agent"], [/gym|fitness/, "gym"],
    [/clean/, "cleaning"], [/account/, "accountant"], [/solicitor|lawyer|law/, "solicitor"], [/consult/, "consultant"],
  ];
  return map.find(([re]) => re.test(c))?.[1];
}
