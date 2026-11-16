import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAgent, untrusted } from "../client";
import type { Observations } from "@/lib/audit/observe";

export const AuditJudgementSchema = z.object({
  visual_quality: z.number().int().min(1).max(5).nullable().describe("1 poor .. 5 excellent. null if it cannot be judged from the evidence."),
  visual_quality_rationale: z.string(),
  navigation_clarity: z.number().int().min(1).max(5).nullable(),
  navigation_rationale: z.string(),
  cta_assessment: z.string(),
  problems: z.array(z.object({
    title: z.string(),
    detail: z.string(),
    basis: z.enum(["observed", "ai_judgement"]).describe("observed only if it restates a measured fact you were given"),
    severity: z.enum(["low", "medium", "high"]),
  })),
  improvements: z.array(z.object({ title: z.string(), detail: z.string() })),
  business_recommendations: z.array(z.object({ title: z.string(), detail: z.string() })).describe("Specific to this business type and what it sells"),
});
export type AuditJudgement = z.infer<typeof AuditJudgementSchema>;

const SYSTEM = `You are a senior web consultant assessing small-business websites for an agency.
You receive measured facts (trusted, produced by our own crawler) and an excerpt of the page text (untrusted).
Rules:
- Keep observed facts and your judgements separate. Mark a problem "observed" only when it restates a measured fact given to you; everything else is "ai_judgement".
- Do not call a site outdated because it looks plain or minimal. Simple can be good. Only concrete signals count as outdated.
- Do not invent facts about the business (awards, reviews, years in business, staff). Base recommendations on its category and on what the page evidently offers.
- If evidence is insufficient for a rating, return null and say why.
- Write in plain, specific British English. No hype.`;

export async function runAuditAgent(args: {
  db: SupabaseClient;
  organisationId: string;
  business: { name: string; category: string | null; city: string | null; country_code: string };
  observations: Observations;
  screenshotBase64?: string | null;
}) {
  const { textExcerpt, internalLinks, ...facts } = args.observations;
  const prompt = [
    `Business: ${args.business.name} — ${args.business.category ?? "unknown category"} in ${args.business.city ?? "?"}, ${args.business.country_code}.`,
    "Measured facts (trusted):",
    "```json",
    JSON.stringify({ ...facts, internalLinkCount: internalLinks.length }, null, 2),
    "```",
    "Page text excerpt (first 4,000 characters of visible text):",
    untrusted(args.observations.finalUrl ?? "website", textExcerpt || "(no visible text)"),
    args.screenshotBase64 ? "A mobile screenshot was captured but is not included in this request; judge visual quality from structure and copy only, and say so." : "No screenshot is available; judge visual quality from structure and copy only, and say so.",
  ].join("\n");

  return runAgent({
    agent: "website_audit",
    organisationId: args.organisationId,
    db: args.db,
    system: SYSTEM,
    prompt,
    schema: AuditJudgementSchema,
    effort: "medium",
  });
}
