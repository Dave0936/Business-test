import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAgent, untrusted } from "../client";
import { DesignBriefSchema } from "@/lib/design/brief";

const SYSTEM = `You are an art director producing an ORIGINAL website design brief for a small business concept.
You may be given design references (titles, notes and links collected from Pinterest, galleries or by staff).
- Take only abstract qualities from references (mood, spacing rhythm, colour temperature, type contrast). Never copy a layout, logo, illustration, photograph or wording.
- Choose colours with WCAG AA contrast: text on background >= 4.5:1, and white or text colour on primary >= 4.5:1.
- Pick fonts only from the allowed list in the schema.
- Image queries must be generic stock-photo searches (no brands, no people's names, no copyrighted characters).
- Base everything on the business type and the audit findings. Do not invent facts about the business.
- Plain British English.`;

export async function runDesignAgent(args: {
  db: SupabaseClient;
  organisationId: string;
  business: { name: string; category: string | null; city: string | null; country_code: string; opportunity_type: string };
  industryLabel: string;
  auditSummary: string;
  references: { id: string; source: string; title: string | null; url: string; notes?: string | null }[];
  /** From the design studio: our own staff's choices (trusted). */
  studio?: { idea: string | null; siteTypeLabel: string; picks: { reference_id: string; section: string; reason: string }[]; answers: { question: string; answer: string }[]; loved: string[]; rejected: string[] } | null;
}) {
  const refs = args.references.length
    ? args.references.map((r) => `- [${r.id}] (${r.source}) ${r.title ?? ""} ${r.url}${r.notes ? ` — notes: ${r.notes}` : ""}`).join("\n")
    : "(no references collected; work from the sector and audit)";
  const prompt = [
    `Business: ${args.business.name}. Sector: ${args.industryLabel}${args.business.category ? ` (${args.business.category})` : ""}. Location: ${args.business.city ?? "?"}, ${args.business.country_code}.`,
    `Opportunity: ${args.business.opportunity_type.replace(/_/g, " ")}.`,
    "Audit summary (from our crawler and analysis):",
    args.auditSummary || "(no audit available)",
    "Design references:",
    untrusted("design references", refs),
    ...(args.studio
      ? [
          "Design studio decisions by our designer (trusted; follow them):",
          `Site type: ${args.studio.siteTypeLabel}.${args.studio.idea ? ` Idea: ${args.studio.idea}` : ""}`,
          `Picks by section: ${args.studio.picks.map((p) => `${p.section} → ${p.reference_id} (${p.reason})`).join("; ") || "none"}`,
          `Loved: ${args.studio.loved.join(", ") || "none"}. Rejected (avoid their qualities): ${args.studio.rejected.join(", ") || "none"}.`,
          `Answers: ${args.studio.answers.map((a) => `${a.question} → ${a.answer}`).join("; ") || "none"}`,
        ]
      : []),
    "Produce the design brief.",
  ].join("\n");

  return runAgent({ agent: "design_research", organisationId: args.organisationId, db: args.db, system: SYSTEM, prompt, schema: DesignBriefSchema, effort: "medium" });
}
