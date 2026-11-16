import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAgent } from "../client";

export const EmailPartsSchema = z.object({
  subject: z.string().max(80),
  greeting_name: z.string().max(60).describe("e.g. 'there' or the business name. Never guess a person's name."),
  observation: z.string().max(400).describe("One specific, verifiable observation from the audit facts. Polite, not critical."),
  reason: z.string().max(300).describe("Why we are getting in touch, honestly: we build websites and made an unsolicited concept."),
  improvements: z.string().max(500).describe("Two or three concrete improvements the concept shows, as short sentences."),
});
export type EmailParts = z.infer<typeof EmailPartsSchema>;

const SYSTEM = `You draft a short, respectful first email from a small web agency to a local business.
- Be honest: it is unsolicited, the concept was made independently, and there is no obligation.
- Use only the facts provided. Do not invent names, praise, statistics, reviews, or results ("increase bookings by 30%").
- One specific observation, framed kindly. No pressure, no fake urgency, no flattery.
- Plain text, short sentences, in the recipient's language.
- Never guess a recipient's personal name; use the business name or "there".`;

export async function runEmailAgent(args: {
  db: SupabaseClient;
  organisationId: string;
  language: string;
  business: { name: string; category: string | null; city: string | null };
  facts: string[];
  conceptUrl: string;
  agencyName: string;
}) {
  const prompt = [
    `Language: ${args.language}`,
    `Business: ${args.business.name} (${args.business.category ?? "local business"}, ${args.business.city ?? ""}).`,
    `Agency: ${args.agencyName}`,
    `Concept URL (will be inserted for you): ${args.conceptUrl}`,
    "Observed facts from our audit (verified by our crawler):",
    ...args.facts.map((f) => `- ${f}`),
  ].join("\n");
  return runAgent({ agent: "email_drafting", organisationId: args.organisationId, db: args.db, system: SYSTEM, prompt, schema: EmailPartsSchema, effort: "low", maxTokens: 4000 });
}
