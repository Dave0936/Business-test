import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiAvailable, runToolTurn, untrusted, type ToolTurnResult } from "@/lib/ai/client";
import { COUNTRIES, industryFor } from "@/lib/industries";
import { produceBrief } from "@/lib/design/research";
import type { DesignBrief } from "@/lib/design/brief";
import { enqueue } from "@/lib/jobs/queue";
import { loadContext, resolveImages, saveVersion, slugify, themeFromBrief } from "../builder";
import { generatedImagesFor } from "../generated-images";
import type { ResolvedImage, SiteSpec } from "../spec";
import { MAX_PAGES, assembleBespoke, type AssembleContext } from "./assemble";
import { SITE_LANGUAGES, type SiteLanguage } from "@/lib/design/studio-rules";
import { makeChecker } from "./check";
import { BUILD_TOOLS, type CheckOutcome, type DraftState } from "./tools";
import { applyTurn } from "./loop";
import { BUILD_SYSTEM, buildBrief, revisionMessage } from "./prompt";

export const MAX_TURNS = 40;

type Msg = Anthropic.Beta.BetaMessageParam;
export type CallModel = (args: { organisationId: string; db: SupabaseClient; messages: Msg[] }) => Promise<ToolTurnResult>;

const defaultCall: CallModel = ({ organisationId, db, messages }) =>
  runToolTurn({ agent: "site_builder", organisationId, db, system: BUILD_SYSTEM, tools: BUILD_TOOLS, messages, effort: "high" });

interface BuildRow {
  id: string;
  organisation_id: string;
  business_id: string;
  website_id: string;
  kind: "new" | "revision";
  status: string;
  stop_requested: boolean;
  turns: number;
  messages: Msg[];
  source: Record<string, string>;
  activity: { at: string; text: string }[];
  last_check: { outcome: CheckOutcome; dirty: boolean } | null;
  cost_usd: number;
  created_by: string | null;
  /** Set when the builder called finish (saved before the version is saved). */
  summary: string | null;
  suggestions: string[] | null;
}

async function latestBrief(db: SupabaseClient, org: string, businessId: string, actorId: string | null) {
  let { data } = await db.from("design_briefs").select("id, brief").eq("business_id", businessId).eq("organisation_id", org).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) {
    const r = await produceBrief(db, org, businessId, actorId);
    ({ data } = await db.from("design_briefs").select("id, brief").eq("id", r.briefId).single());
  }
  return data as { id: string; brief: DesignBrief };
}

async function ensureWebsite(db: SupabaseClient, org: string, business: { id: string; name: string }, briefId: string) {
  const { data: site } = await db.from("generated_websites").select("id, slug, current_version_id").eq("business_id", business.id).eq("organisation_id", org).maybeSingle();
  if (site) return site;
  const slug = `${slugify(business.name)}-${business.id.slice(0, 6)}`;
  const { data, error } = await db.from("generated_websites").insert({ organisation_id: org, business_id: business.id, brief_id: briefId, slug, status: "draft" }).select("id, slug, current_version_id").single();
  if (error) throw error;
  return data;
}

/** Everything the builder and its checks need about this business, all from our own records. */
async function buildContext(db: SupabaseClient, org: string, businessId: string, actorId: string | null) {
  const { business, org: o } = await loadContext(db, org, businessId);
  const industry = industryFor(business);
  const briefRow = await latestBrief(db, org, businessId, actorId);
  const brief = briefRow.brief;
  const language = business.language ?? COUNTRIES.find((c) => c.code === business.country_code)?.language ?? "en";
  const images = { ...(await resolveImages(db, org, brief.image_queries ?? [])), ...(await generatedImagesFor(db, org, businessId)) };
  const { data: studio } = await db.from("design_studios").select("picks, languages").eq("business_id", businessId).eq("organisation_id", org).maybeSingle();
  const { data: audit } = await db.from("website_audits").select("observed").eq("business_id", businessId).eq("organisation_id", org).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const assemble: AssembleContext = {
    facts: { name: business.name, phone: business.phone, email: business.email, address: business.address, city: business.city, language },
    agencyName: o.agency_name || o.name,
    agencyWebsite: o.agency_website,
    photoCredits: [...new Set(Object.values(images).map((i) => i.credit?.name).filter(Boolean) as string[])],
    aiImages: Object.values(images).some((i) => i.aiGenerated),
  };
  const spec: SiteSpec = {
    version: 1, kind: "bespoke", theme: themeFromBrief(brief),
    business: { name: business.name, city: business.city, region: business.region, countryCode: business.country_code, phone: business.phone, email: business.email, address: business.address, language },
    agency: { name: assemble.agencyName, website: o.agency_website, email: o.agency_reply_email },
    images, slug: "", generatedBy: "ai",
  };
  const extraLanguages = ((studio?.languages ?? []) as string[]).filter((l) => l !== language.slice(0, 2) && l in SITE_LANGUAGES).map((code) => ({ code, name: SITE_LANGUAGES[code as SiteLanguage] }));
  return { business, industry, briefRow, brief, language, images, extraLanguages, picks: ((studio?.picks ?? []) as { section: string; reason: string }[]), siteText: (audit?.observed as { textExcerpt?: string } | null)?.textExcerpt ?? null, assemble, spec };
}

function imageList(images: Record<string, ResolvedImage>) {
  return Object.values(images)
    .filter((i) => /^https:\/\//.test(i.src) || /^assets\/[a-z0-9/._-]+$/i.test(i.src))
    .map((i) => ({ url: i.src, alt: i.alt, credit: i.aiGenerated ? "AI-generated illustration" : i.credit?.name ?? null }));
}

function localAssets(images: Record<string, ResolvedImage>): string[] {
  return Object.values(images).filter((i) => i.kind === "upload" && i.storagePath).map((i) => i.src);
}

/**
 * Create a build (new site, or a revision of the current Claude-written version) and queue it.
 * Throws if Claude is not connected: callers fall back to the labelled template demo.
 */
export async function startBuild(db: SupabaseClient, org: string, businessId: string, actorId: string | null, opts: { instruction?: string; runId?: string | null; queue?: boolean } = {}): Promise<{ buildId: string; websiteId: string }> {
  if (!aiAvailable()) throw new Error("The builder needs Claude. Add your Anthropic key under Integrations.");
  const ctx = await buildContext(db, org, businessId, actorId);
  const site = await ensureWebsite(db, org, ctx.business, ctx.briefRow.id);

  let messages: Msg[];
  let source: Record<string, string> = {};
  let baseVersionId: string | null = null;
  const { trusted, untrustedSiteText } = buildBrief({
    business: { name: ctx.business.name, industryLabel: ctx.industry?.label ?? ctx.business.category ?? "local business", city: ctx.business.city, countryCode: ctx.business.country_code, bookingRelevant: ctx.industry?.bookingRelevant ?? false },
    language: ctx.language,
    extraLanguages: ctx.extraLanguages,
    available: { phone: Boolean(ctx.business.phone), email: Boolean(ctx.business.email), address: Boolean(ctx.business.address) },
    brief: ctx.brief, picks: ctx.picks, images: imageList(ctx.images), existingSiteText: ctx.siteText,
  });
  if (opts.instruction) {
    const { data: v } = site.current_version_id ? await db.from("website_versions").select("id, spec").eq("id", site.current_version_id).single() : { data: null };
    const base = (v?.spec as SiteSpec | undefined)?.source;
    if (!v || !base) throw new Error("Revisions work on versions written by the builder. Build the site with Claude first.");
    source = { ...base };
    baseVersionId = v.id;
    messages = [{ role: "user", content: `${trusted}\n\n${revisionMessage(opts.instruction.slice(0, 2000), Object.keys(source))}` }];
  } else {
    const parts: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: trusted }];
    if (untrustedSiteText) parts.push({ type: "text", text: `Text from the business's current website, to understand what it offers (do not copy it):\n${untrusted("current website", untrustedSiteText)}` });
    parts.push({ type: "text", text: "Build the site now." });
    messages = [{ role: "user", content: parts }];
  }

  const { data: build, error } = await db.from("site_builds").insert({
    organisation_id: org, business_id: businessId, website_id: site.id, kind: opts.instruction ? "revision" : "new",
    instruction: opts.instruction ?? null, base_version_id: baseVersionId, status: "queued", messages, source,
    activity: [{ at: new Date().toISOString(), text: opts.instruction ? `Revision requested: ${opts.instruction.slice(0, 200)}` : "Build started" }],
    created_by: actorId,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") throw new Error("A build is already running for this site. Wait for it, or stop it first.");
    throw error;
  }
  if (opts.queue !== false) {
    await enqueue(db, { organisationId: org, runId: opts.runId ?? null, type: "generate", payload: { buildId: build.id, actorId }, idempotencyKey: `build:${build.id}:0` });
  }
  return { buildId: build.id, websiteId: site.id };
}

/**
 * Run build turns until the time budget is spent. Returns "continue" when more turns are
 * needed (the caller queues a continuation), or the final status.
 */
export async function runBuildSlice(db: SupabaseClient, buildId: string, opts: { deadlineMs?: number; callModel?: CallModel; runId?: string | null } = {}): Promise<{ status: "continue" | "succeeded" | "failed" | "stopped"; versionId?: string }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);
  const call = opts.callModel ?? defaultCall;
  const { data, error } = await db.from("site_builds").select("*").eq("id", buildId).single();
  if (error) throw error;
  const build = data as BuildRow;
  if (!["queued", "running"].includes(build.status)) return { status: build.status as "succeeded" | "failed" | "stopped" };
  const org = build.organisation_id;
  const ctx = await buildContext(db, org, build.business_id, build.created_by);
  const check = makeChecker(ctx.assemble, ctx.spec, localAssets(ctx.images));

  const state: DraftState = { maxPages: MAX_PAGES * (1 + ctx.extraLanguages.length), source: { ...build.source }, lastCheck: build.last_check?.outcome ?? null, dirtySinceCheck: build.last_check?.dirty ?? true, finished: null };
  const messages = [...build.messages];
  const activity = [...build.activity];
  let turns = build.turns;
  let cost = Number(build.cost_usd);
  const log = (text: string) => activity.push({ at: new Date().toISOString(), text });
  const persist = async (patch: Record<string, unknown> = {}) => {
    const { error: e } = await db.from("site_builds").update({
      messages, source: state.source, activity: activity.slice(-200), turns, cost_usd: cost,
      last_check: state.lastCheck ? { outcome: state.lastCheck, dirty: state.dirtySinceCheck } : null, ...patch,
    }).eq("id", buildId).eq("organisation_id", org);
    if (e) throw e;
  };
  if (build.status === "queued") await db.from("site_builds").update({ status: "running" }).eq("id", buildId).eq("organisation_id", org);
  // The builder already finished but saving failed (e.g. a timeout): save again, no new model turns.
  if (build.summary != null) {
    state.finished = { summary: build.summary, suggestions: build.suggestions ?? [] };
    return finalise(db, build, ctx, state, activity);
  }

  while (Date.now() < deadline) {
    const { data: flag } = await db.from("site_builds").select("stop_requested").eq("id", buildId).single();
    if (flag?.stop_requested) {
      log("Stopped by a team member");
      await persist({ status: "stopped", finished_at: new Date().toISOString() });
      return { status: "stopped" };
    }
    if (turns >= MAX_TURNS) {
      log(`Did not finish within ${MAX_TURNS} turns`);
      await persist({ status: "failed", error: `The builder did not finish within ${MAX_TURNS} turns. The draft is kept; try a revision or build again.`, finished_at: new Date().toISOString() });
      return { status: "failed" };
    }

    let result: ToolTurnResult;
    try {
      result = await call({ organisationId: org, db, messages });
    } catch (e) {
      log(`Stopped: ${(e as Error).message}`);
      await persist({ status: "failed", error: (e as Error).message, finished_at: new Date().toISOString() });
      return { status: "failed" };
    }
    turns++;
    cost += result.costUsd;
    for (const line of applyTurn(state, messages, result.message, check)) log(line);

    if (state.finished) {
      await persist({ summary: state.finished.summary, suggestions: state.finished.suggestions });
      return finalise(db, build, ctx, state, activity);
    }
    await persist();
  }
  return { status: "continue" };
}

async function finalise(db: SupabaseClient, build: BuildRow, ctx: Awaited<ReturnType<typeof buildContext>>, state: DraftState, log: { at: string; text: string }[]): Promise<{ status: "succeeded"; versionId: string }> {
  const { files, notes } = assembleBespoke(state.source, ctx.assemble);
  const { data: site } = await db.from("generated_websites").select("slug").eq("id", build.website_id).single();
  const spec: SiteSpec = {
    ...ctx.spec, slug: site?.slug ?? "", source: state.source,
    pages: Object.keys(state.source).filter((p) => p.endsWith(".html")).sort(),
    summary: state.finished?.summary, suggestions: state.finished?.suggestions,
  };
  const note = build.kind === "revision" ? "Revised by the builder" : "Built by the builder";
  const r = await saveVersion(db, { organisationId: build.organisation_id, websiteId: build.website_id, businessId: build.business_id, spec, files, note, actorId: build.created_by });
  const activity = [...log, ...notes.map((n) => ({ at: new Date().toISOString(), text: n })), { at: new Date().toISOString(), text: r.report.passed ? "Saved as a new version; final checks passed" : "Saved as a new version; final checks found problems" }];
  await db.from("site_builds").update({ status: "succeeded", result_version_id: r.versionId, finished_at: new Date().toISOString(), activity: activity.slice(-200) }).eq("id", build.id).eq("organisation_id", build.organisation_id);
  return { status: "succeeded", versionId: r.versionId };
}
