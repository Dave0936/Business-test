import type { Observations } from "./observe";

/**
 * Transparent, weighted opportunity scoring.
 *
 * Each criterion has a fixed weight and awards 0..weight points of *opportunity*
 * (more points = bigger improvement opportunity). Every criterion records whether
 * it is based on an observed fact or an AI judgement, plus the reason.
 *
 * Simple-looking sites are never penalised for looking simple: "outdated" signals
 * are concrete (no responsive viewport, legacy markup, plugins, insecure transport,
 * old generator versions), not visual style.
 */
export const WEIGHTS_VERSION = "2026-11-v1";

export interface Criterion {
  id: string;
  label: string;
  weight: number;
  points: number;
  basis: "observed" | "ai_judgement";
  reason: string;
}

export interface AiJudgementInput {
  visualQuality?: number | null; // 1 (poor) .. 5 (excellent)
  navigationClarity?: number | null; // 1..5
}

export interface ScoreResult {
  score: number;
  auditScore: number | null;
  qualified: boolean;
  contactable: boolean;
  threshold: number;
  opportunityType: "no_website" | "outdated_website" | "poor_mobile" | "weak_functionality" | "poor_enquiry_booking" | "unknown";
  criteria: Criterion[];
  reasons: string[];
  weightsVersion: string;
}

export interface ScoreContext {
  hasWebsite: boolean;
  bookingRelevant: boolean;
  publicEmail: string | null;
  contactPageUrl: string | null;
  phone: string | null;
  threshold: number;
  currentYear?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function scoreOpportunity(obs: Observations | null, ctx: ScoreContext, ai: AiJudgementInput = {}): ScoreResult {
  const criteria: Criterion[] = [];
  const add = (c: Criterion) => criteria.push({ ...c, points: Math.round(clamp(c.points, 0, c.weight) * 10) / 10 });
  const year = ctx.currentYear ?? new Date().getFullYear();

  const reachable = Boolean(obs?.fetched && obs.httpStatus && obs.httpStatus < 400);

  if (!ctx.hasWebsite || !reachable) {
    add({
      id: "website_presence", label: "Website presence", weight: 40, basis: "observed",
      points: 40,
      reason: !ctx.hasWebsite
        ? "No website of its own found in any source (social or listing pages do not count)."
        : `Listed website could not be loaded (${obs?.error ?? `HTTP ${obs?.httpStatus ?? "no response"}`}).`,
    });
    add({
      id: "enquiry_booking", label: "Online enquiry or booking", weight: 15, basis: "observed",
      points: ctx.bookingRelevant ? 15 : 10,
      reason: ctx.bookingRelevant ? "Customers in this sector expect to book online; there is no site to do it on." : "No online way to send an enquiry.",
    });
  } else {
    const o = obs!;
    add({ id: "website_presence", label: "Website presence", weight: 40, basis: "observed", points: 0, reason: `Website loads (HTTP ${o.httpStatus}).` });

    // Mobile
    let mobile = 0;
    const mobileReasons: string[] = [];
    if (!o.hasResponsiveViewport) { mobile += 10; mobileReasons.push("no responsive viewport meta tag"); }
    if (o.mobileRender?.checked && o.mobileRender.horizontalOverflow) { mobile += 5; mobileReasons.push(`content overflows a ${o.mobileRender.viewportWidth}px phone screen`); }
    else if (o.hasResponsiveViewport && o.mediaQueryCount === 0 && o.stylesheetCount === 0) { mobile += 2; mobileReasons.push("no responsive CSS detected"); }
    add({ id: "mobile", label: "Mobile experience", weight: 15, basis: "observed", points: mobile, reason: mobileReasons.length ? `Observed: ${mobileReasons.join("; ")}.` : "Responsive viewport present." });

    // Performance
    let perf = 0;
    const perfReasons: string[] = [];
    if ((o.timeToFirstByteMs ?? 0) > 1500) { perf += 4; perfReasons.push(`slow server response (${o.timeToFirstByteMs} ms to first byte)`); }
    if ((o.totalTimeMs ?? 0) > 4000) { perf += 3; perfReasons.push(`HTML took ${o.totalTimeMs} ms to download`); }
    if ((o.pageBytes ?? 0) > 1_500_000) { perf += 2; perfReasons.push(`large HTML (${Math.round((o.pageBytes ?? 0) / 1024)} KB)`); }
    if (o.scriptCount > 25) { perf += 1; perfReasons.push(`${o.scriptCount} external scripts`); }
    add({ id: "performance", label: "Loading performance", weight: 8, basis: "observed", points: perf, reason: perfReasons.length ? `Observed: ${perfReasons.join("; ")}.` : "No performance problems measured on the HTML request." });

    // Security
    let sec = 0;
    const secReasons: string[] = [];
    if (!o.https) { sec += 6; secReasons.push("served without HTTPS"); }
    if (o.mixedContentCount > 0) { sec += 2; secReasons.push(`${o.mixedContentCount} insecure http:// resources on an https page`); }
    add({ id: "security", label: "Security basics", weight: 8, basis: "observed", points: sec, reason: secReasons.length ? `Observed: ${secReasons.join("; ")}.` : "Served over HTTPS." });

    // Enquiry & booking
    let eb = 0;
    const ebReasons: string[] = [];
    const hasBooking = o.bookingPlatforms.length > 0 || o.bookingLinks.length > 0;
    if (ctx.bookingRelevant && !hasBooking) { eb += 7; ebReasons.push("no booking link or booking system found"); }
    if (o.formCount === 0) { eb += 4; ebReasons.push("no enquiry form on the home page"); }
    if (o.ctaCount === 0) { eb += 4; ebReasons.push("no clear call-to-action buttons or links"); }
    add({ id: "enquiry_booking", label: "Online enquiry or booking", weight: 15, basis: "observed", points: eb, reason: ebReasons.length ? `Observed: ${ebReasons.join("; ")}.` : "Enquiry routes and calls to action present." });

    // Contact info
    let ci = 0;
    if (o.telLinks.length === 0) ci += 1.5;
    if (o.publishedEmails.length === 0 && !o.contactPageUrl) ci += 2.5;
    add({ id: "contact_info", label: "Contact information", weight: 4, basis: "observed", points: ci, reason: ci ? `Observed: ${[o.telLinks.length === 0 && "no tap-to-call link", o.publishedEmails.length === 0 && !o.contactPageUrl && "no email address or contact page link"].filter(Boolean).join("; ")}.` : "Phone and email/contact page are present." });

    // Outdated technology (concrete signals only)
    let od = 0;
    const odReasons: string[] = [];
    if (o.usesFlashOrApplets) { od += 4; odReasons.push("uses Flash or Java applets"); }
    if (o.deprecatedTags.length) { od += 2; odReasons.push(`obsolete HTML tags (${o.deprecatedTags.join(", ")})`); }
    if (o.tableLayoutSignals > 0) { od += 1; odReasons.push("table-based page layout"); }
    if (o.jqueryVersion && Number(o.jqueryVersion.split(".")[0]) < 3) { od += 1; odReasons.push(`jQuery ${o.jqueryVersion}`); }
    if (o.latestYearMentioned && year - o.latestYearMentioned >= 4) { od += 1; odReasons.push(`latest copyright year shown is ${o.latestYearMentioned}`); }
    add({ id: "outdated_tech", label: "Outdated technology", weight: 6, basis: "observed", points: od, reason: odReasons.length ? `Observed: ${odReasons.join("; ")}.` : "No outdated technology signals found. Visual simplicity alone is not counted." });

    // SEO basics
    let seo = 0;
    if (!o.title) seo += 1.5;
    if (!o.metaDescription) seo += 1;
    if (o.h1Count === 0) seo += 1;
    if (!o.structuredData) seo += 0.5;
    add({ id: "seo", label: "SEO basics", weight: 4, basis: "observed", points: seo, reason: seo ? `Observed: ${[!o.title && "missing title", !o.metaDescription && "missing meta description", o.h1Count === 0 && "no H1 heading", !o.structuredData && "no structured data"].filter(Boolean).join("; ")}.` : "Title, description, H1 and structured data present." });

    // Accessibility
    let acc = 0;
    if (!o.lang) acc += 1.5;
    if (o.imageCount > 0) acc += 2.5 * (o.imagesMissingAlt / o.imageCount);
    add({ id: "accessibility", label: "Accessibility basics", weight: 4, basis: "observed", points: acc, reason: acc ? `Observed: ${[!o.lang && "no page language declared", o.imagesMissingAlt && `${o.imagesMissingAlt} of ${o.imageCount} images without alt text`].filter(Boolean).join("; ")}.` : "Language declared and images have alt text." });

    // Technical issues
    const broken = o.brokenLinks.length;
    add({ id: "technical", label: "Broken links and errors", weight: 4, basis: "observed", points: broken ? Math.min(4, 1 + broken) : 0, reason: broken ? `Observed: ${broken} broken link(s) out of ${o.linksChecked} checked.` : `No broken links among ${o.linksChecked} checked.` });

    // AI judgement (only if available) — clearly labelled
    if (ai.visualQuality != null || ai.navigationClarity != null) {
      const vq = ai.visualQuality != null ? (5 - clamp(ai.visualQuality, 1, 5)) / 4 : 0;
      const nav = ai.navigationClarity != null ? (5 - clamp(ai.navigationClarity, 1, 5)) / 4 : 0;
      const n = (ai.visualQuality != null ? 1 : 0) + (ai.navigationClarity != null ? 1 : 0);
      add({
        id: "ai_design", label: "Design and navigation (AI judgement)", weight: 6, basis: "ai_judgement",
        points: (6 * (vq + nav)) / n,
        reason: `AI rated visual quality ${ai.visualQuality ?? "n/a"}/5 and navigation ${ai.navigationClarity ?? "n/a"}/5. This is an opinion, not a measurement.`,
      });
    }
  }

  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  const totalPoints = criteria.reduce((s, c) => s + c.points, 0);
  // Without a reachable site only presence + enquiry apply; score against the full model.
  const denominator = !ctx.hasWebsite || !reachable ? 55 : totalWeight;
  const score = Math.round((100 * totalPoints) / denominator);

  // Audit score = how good the *current* site is (inverse of opportunity), null if no site.
  const auditScore = ctx.hasWebsite && reachable ? 100 - score : null;

  const contactable = Boolean(ctx.publicEmail || ctx.contactPageUrl || ctx.phone);
  const byShare = (id: string) => {
    const c = criteria.find((x) => x.id === id);
    return c ? c.points / c.weight : 0;
  };
  let opportunityType: ScoreResult["opportunityType"] = "unknown";
  if (!ctx.hasWebsite || !reachable) opportunityType = "no_website";
  else {
    const ranked = [
      { t: "poor_mobile" as const, v: byShare("mobile") },
      { t: "outdated_website" as const, v: Math.max(byShare("outdated_tech"), byShare("security") * 0.8) },
      { t: "poor_enquiry_booking" as const, v: byShare("enquiry_booking") },
      { t: "weak_functionality" as const, v: (byShare("technical") + byShare("performance") + byShare("seo")) / 3 },
    ].sort((a, b) => b.v - a.v);
    opportunityType = ranked[0].v >= 0.34 ? ranked[0].t : "unknown";
  }

  const reasons = criteria.filter((c) => c.points > 0).sort((a, b) => b.points - a.points).map((c) => `${c.label} (+${c.points}/${c.weight}): ${c.reason}`);

  return {
    score: clamp(score, 0, 100),
    auditScore,
    qualified: score >= ctx.threshold && contactable,
    contactable,
    threshold: ctx.threshold,
    opportunityType,
    criteria,
    reasons,
    weightsVersion: WEIGHTS_VERSION,
  };
}
