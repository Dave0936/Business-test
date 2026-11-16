import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runAgent, untrusted } from "../client";
import { StudioQuestionSchema } from "@/lib/design/studio-rules";

export interface RefSummary {
  id: string;
  kind: string;
  source: string;
  verdict: string | null;
  title: string | null;
  url: string;
  notes: string | null;
  facts: { fonts?: string[]; colours?: string[]; usesSerifHeadings?: boolean | null; description?: string | null } | null;
}

/** Everything a reference says about itself is untrusted; our own kind/verdict labels are not. */
export function describeRefs(refs: RefSummary[]) {
  const trusted = refs.map((r) => `- ${r.id}: ${r.kind} from ${r.source}${r.verdict ? `, the designer ${r.verdict} it` : ""}`).join("\n");
  const authored = JSON.stringify(refs.map((r) => ({ id: r.id, title: r.title, url: r.url, team_notes: r.notes, observed_design: r.facts })), null, 2);
  return { trusted, authored };
}

const JUDGE_SYSTEM = `You are an art director choosing design references for a small-business website concept.
Pick up to five references that together cover the page: one per section listed, each for a reason a designer would agree with (mood, spacing, type contrast, photography style, layout rhythm).
Rules:
- Never pick a reference the designer rejected. Prefer references the designer loved.
- Use only reference ids from the list and only section names from the list; each section at most once.
- Reasons are one short sentence about an abstract quality to take, never "copy this layout/logo/photo".
- Plain British English.`;

export const JudgeOutputSchema = z.object({
  picks: z.array(z.object({ reference_id: z.string(), section: z.string(), reason: z.string() })).max(5),
});

export async function runJudgeAgent(args: {
  db: SupabaseClient; organisationId: string;
  business: { name: string; industryLabel: string; city: string | null };
  idea: string | null; siteTypeLabel: string; sections: readonly string[]; refs: RefSummary[];
}) {
  const { trusted, authored } = describeRefs(args.refs);
  const prompt = [
    `Business: ${args.business.name}, ${args.business.industryLabel}${args.business.city ? ` in ${args.business.city}` : ""}.`,
    `Site type: ${args.siteTypeLabel}. Sections to cover: ${args.sections.join(", ")}.`,
    args.idea ? `The designer's idea (from our own staff): ${args.idea}` : "No idea given.",
    "References (ids and our labels):",
    trusted,
    "What each reference says about itself, plus our crawler's observed fonts and colours:",
    untrusted("design references", authored),
  ].join("\n");
  return runAgent({ agent: "design_judge", organisationId: args.organisationId, db: args.db, system: JUDGE_SYSTEM, prompt, schema: JudgeOutputSchema, effort: "low", maxTokens: 4000 });
}

const QUESTIONS_SYSTEM = `You help a web designer decide the creative direction for a small-business website concept.
Write three to five short multiple-choice questions about the chosen references and the business, each with two to five plain options.
Each question must say which part of the brief it shapes (maps_to). Ask about real choices visible in the picks (for example full-bleed photography versus a split hero), not generic filler.
Use lowercase ids with underscores. Plain British English.`;

export const QuestionsOutputSchema = z.object({ questions: z.array(StudioQuestionSchema).min(3).max(5) });

export async function runQuestionsAgent(args: {
  db: SupabaseClient; organisationId: string;
  business: { name: string; industryLabel: string };
  siteTypeLabel: string; picks: { section: string; reason: string; ref: RefSummary }[];
}) {
  const { trusted, authored } = describeRefs(args.picks.map((p) => p.ref));
  const prompt = [
    `Business: ${args.business.name}, ${args.business.industryLabel}. Site type: ${args.siteTypeLabel}.`,
    "Chosen references, by section:",
    args.picks.map((p) => `- ${p.section}: ${p.ref.id} (${p.reason})`).join("\n"),
    trusted,
    untrusted("design references", authored),
  ].join("\n");
  return runAgent({ agent: "design_questions", organisationId: args.organisationId, db: args.db, system: QUESTIONS_SYSTEM, prompt, schema: QuestionsOutputSchema, effort: "low", maxTokens: 4000 });
}

// ---------------------------------------------------------------------------
// Research: find example sites with web search, then choose from what came back.
// ---------------------------------------------------------------------------

export const RESEARCH_SEARCH_SYSTEM = `You research website design inspiration for a web designer.
Search the web for websites of independent businesses of the given kind that are well designed: clear, modern, mobile-friendly, with good photography and type.
Prefer the businesses' own websites. Avoid directories, review sites, marketplaces, social media, template shops, website builders' showcase pages and large chains.
Finish with a short list: each site's address and one line on what is good about its design. Plain British English.`;

export const ResearchPickSchema = z.object({
  picks: z.array(z.object({ index: z.number().int().min(0), reason: z.string() })).max(6),
});

const RESEARCH_PICK_SYSTEM = `You choose design references for a web designer from a numbered list of search results.
Choose up to six that are most likely to be well-designed websites of independent businesses of the given kind.
Never choose directories, review sites, marketplaces, social media, template or builder showcase pages, or big chains.
Answer only with indexes from the list and a one-line reason about design quality for each. Plain British English.`;

export async function runResearchPickAgent(args: {
  db: SupabaseClient; organisationId: string; industryLabel: string; idea: string | null;
  hits: { url: string; title: string }[]; searchNotes: string;
}) {
  const list = args.hits.map((h, i) => ({ index: i, url: h.url, title: h.title }));
  const prompt = [
    `Kind of business: ${args.industryLabel}.`,
    args.idea ? `The designer's idea (our own staff): ${args.idea}` : "",
    "Numbered search results:",
    untrusted("web search results", JSON.stringify(list, null, 2)),
    "Notes written during the search (shaped by the pages it read):",
    untrusted("web search notes", args.searchNotes.slice(0, 6000)),
  ].filter(Boolean).join("\n");
  return runAgent({ agent: "design_research_pick", organisationId: args.organisationId, db: args.db, system: RESEARCH_PICK_SYSTEM, prompt, schema: ResearchPickSchema, effort: "low", maxTokens: 4000 });
}
