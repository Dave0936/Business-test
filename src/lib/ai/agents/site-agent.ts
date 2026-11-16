import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAgent, untrusted } from "../client";
import { SectionSchema, SiteContentSchema, type SiteContent } from "@/lib/sites/spec";
import type { DesignBrief } from "@/lib/design/brief";

const SYSTEM = `You write the content and page structure for a website CONCEPT for a real small business.
The concept will be shown to the business owner as an example of what we could build.

Hard rules (the output is checked automatically and rejected if broken):
- Never invent facts. No testimonials, reviews, ratings, awards, certifications, accreditations, prices, staff names, years in business, client names, statistics or guarantees.
- Do not write phone numbers, email addresses, street addresses or opening hours: our code inserts verified contact details.
- Avoid superlatives that imply a claim ("best", "No.1", "award-winning", "leading", "trusted by thousands").
- Describe services generically for this type of business, e.g. "Emergency repairs" for a plumber. If the business's own pages listed services, you may use those names.
- Write in the requested language. Warm, plain, specific; no filler or clichés.
- Page "index" is required and comes first. Include "contact". Add "booking" only if online booking suits this business.
- Each call-to-action target must exist: "booking" only if a booking page or section exists.`;

export interface SiteGenInput {
  business: { name: string; category: string | null; city: string | null; country_code: string; industryLabel: string; bookingRelevant: boolean };
  language: string;
  brief: DesignBrief;
  existingSiteText?: string | null;
}

function context(input: SiteGenInput): string {
  const b = input.brief;
  return [
    `Business: ${input.business.name} — ${input.business.industryLabel}${input.business.category ? ` (${input.business.category})` : ""}, ${input.business.city ?? ""} ${input.business.country_code}.`,
    `Language: ${input.language}. Online booking relevant: ${input.business.bookingRelevant ? "yes" : "no"}.`,
    `Positioning: ${b.positioning}`,
    `Audience: ${b.audience}`,
    `Visual direction: ${b.visual_direction}`,
    `Planned pages: ${b.page_structure.map((p) => `${p.page} [${p.sections.join(", ")}]`).join("; ")}`,
    `Calls to action: ${b.ctas.map((c) => c.label).join(", ")}`,
    `Image style: ${b.image_style}`,
    input.existingSiteText ? `Text from the business's current website (use only to understand what they offer):\n${untrusted("current website", input.existingSiteText.slice(0, 3500))}` : "The business has no website text available.",
  ].join("\n");
}

export async function runSiteAgent(args: { db: SupabaseClient; organisationId: string; input: SiteGenInput }) {
  return runAgent({
    agent: "website_generation",
    organisationId: args.organisationId,
    db: args.db,
    system: SYSTEM,
    prompt: `${context(args.input)}\n\nWrite the full website content.`,
    schema: SiteContentSchema,
    effort: "high",
    maxTokens: 32000,
  });
}

export async function runSectionAgent(args: { db: SupabaseClient; organisationId: string; input: SiteGenInput; current: SiteContent; pageSlug: string; sectionIndex: number; instruction: string }) {
  const page = args.current.pages.find((p) => p.slug === args.pageSlug);
  const section = page?.sections[args.sectionIndex];
  if (!section) throw new Error("Section not found");
  return runAgent({
    agent: "website_section_regeneration",
    organisationId: args.organisationId,
    db: args.db,
    system: SYSTEM,
    prompt: [
      context(args.input),
      `Rewrite one "${section.type}" section on the "${args.pageSlug}" page. Keep the same section type.`,
      `Current section JSON:\n${JSON.stringify(section)}`,
      `Instruction from our designer: ${untrusted("designer instruction", args.instruction || "Improve it.")}`,
    ].join("\n\n"),
    schema: SectionSchema,
    effort: "medium",
  });
}
