import { z } from "zod";
import { FONT_CHOICES, type DesignBrief } from "./brief";

/**
 * Pure design-studio logic: site types, the rule-based reference picker, preset questions and
 * how answers shape a brief. Used directly when Claude is not connected (and labelled so), and
 * as the safety net that validates and completes Claude's picks when it is.
 */

export const SITE_TYPES = {
  brochure: { label: "Brochure site", sections: ["Hero", "Services", "About", "Gallery", "Contact"] },
  one_page: { label: "One-page site", sections: ["Hero", "What we do", "Story", "Gallery", "Contact"] },
  booking: { label: "Booking-led site", sections: ["Hero", "Treatments or services", "Booking", "Team", "Contact"] },
  menu: { label: "Menu-led site (food and drink)", sections: ["Hero", "Menu", "Story", "Gallery", "Visit us"] },
  portfolio: { label: "Portfolio of work", sections: ["Hero", "Projects", "Process", "About", "Contact"] },
  shop: { label: "Shop window", sections: ["Hero", "Products", "Story", "Delivery and collection", "Contact"] },
} as const;
export type SiteType = keyof typeof SITE_TYPES;

/** Languages a site can be built in (extra languages become translated copies in folders). */
export const SITE_LANGUAGES = { en: "English", fr: "French", de: "German", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese", pl: "Polish", cy: "Welsh", ga: "Irish" } as const;
export type SiteLanguage = keyof typeof SITE_LANGUAGES;
export const MAX_EXTRA_LANGUAGES = 2;
export const SITE_TYPE_IDS = Object.keys(SITE_TYPES) as SiteType[];

/** Default type from the industry, its sector group, or failing those the free-text category. */
export function defaultSiteType(industryId: string | null, sector: string | null, category?: string | null): SiteType {
  const text = `${industryId ?? ""} ${category ?? ""}`.toLowerCase();
  if (sector === "food" || /restaurant|cafe|café|bakery|\bbar\b|\bpub\b|takeaway|bistro|coffee/.test(text)) return "menu";
  if (sector === "beauty" || sector === "healthcare" || sector === "fitness" || /salon|barber|dentist|dental|\bgym\b|\bspa\b|beauty|clinic|physio/.test(text)) return "booking";
  if (sector === "trades" || /construction|builder|joiner|landscap|plumb|electric|roofer/.test(text)) return "portfolio";
  if (sector === "retail" || /\bshop\b|boutique|florist/.test(text)) return "shop";
  return "brochure";
}

export function pageStructureFor(type: SiteType, bookingRelevant: boolean): DesignBrief["page_structure"] {
  const home = { page: "Home", sections: [...SITE_TYPES[type].sections] };
  if (type === "one_page") return [home];
  const pages: DesignBrief["page_structure"] = [home];
  if (type === "menu") pages.push({ page: "Menu", sections: ["Intro", "Menu sections", "Dietary notes"] });
  if (type === "portfolio") pages.push({ page: "Projects", sections: ["Intro", "Project list", "Call to action"] });
  if (type === "shop") pages.push({ page: "Products", sections: ["Intro", "Product groups", "How to buy"] });
  if (type === "booking" || bookingRelevant) pages.push({ page: "Book", sections: ["Booking request form", "What to expect"] });
  if (type === "brochure" || type === "booking") pages.push({ page: "Services", sections: ["Intro", "Service list", "Call to action"] });
  pages.push({ page: "About", sections: ["Story", "Values"] }, { page: "Contact", sections: ["Enquiry form", "Details", "Map link"] });
  return pages;
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

export interface RefForPick {
  id: string;
  kind: string;
  verdict: string | null;
  created_at: string;
}
export interface Pick {
  reference_id: string;
  section: string;
  reason: string;
}

const KIND_RANK: Record<string, number> = { upload: 0, site: 1, pin: 2, link: 3 };

/**
 * Rule-based picker: never a rejected reference; loved first, then the team's own uploads and
 * sites, then pins; newest first. On later rounds, references shown last round (unless loved)
 * go to the back so each round offers something new. One pick per section, up to five.
 */
export function rulePicks(refs: RefForPick[], sections: readonly string[], previous: Pick[] = []): Pick[] {
  const shownBefore = new Set(previous.map((p) => p.reference_id));
  const candidates = refs
    .filter((r) => r.verdict !== "rejected")
    .sort((a, b) => {
      const loved = Number(b.verdict === "loved") - Number(a.verdict === "loved");
      if (loved) return loved;
      const fresh = Number(shownBefore.has(a.id)) - Number(shownBefore.has(b.id));
      if (fresh) return fresh;
      const kind = (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
      if (kind) return kind;
      return b.created_at.localeCompare(a.created_at);
    });
  return candidates.slice(0, Math.min(5, sections.length)).map((r, i) => ({
    reference_id: r.id,
    section: sections[i],
    reason: r.verdict === "loved" ? "You loved this one." : r.kind === "upload" ? "Your own picture." : r.kind === "site" ? "A site your team added." : "Newest unrejected reference.",
  }));
}

/** Keep only valid AI picks (known, not rejected, no duplicates, known sections) and top up with rules. */
export function reconcilePicks(aiPicks: Pick[], refs: RefForPick[], sections: readonly string[], previous: Pick[] = []): { picks: Pick[]; dropped: number } {
  const valid = new Map(refs.filter((r) => r.verdict !== "rejected").map((r) => [r.id, r]));
  const used = new Set<string>();
  const sectionsUsed = new Set<string>();
  const kept: Pick[] = [];
  for (const p of aiPicks) {
    if (!valid.has(p.reference_id) || used.has(p.reference_id) || !sections.includes(p.section) || sectionsUsed.has(p.section)) continue;
    kept.push({ reference_id: p.reference_id, section: p.section, reason: p.reason.slice(0, 300) });
    used.add(p.reference_id);
    sectionsUsed.add(p.section);
    if (kept.length === 5) break;
  }
  const dropped = aiPicks.length - kept.length;
  const restSections = sections.filter((s) => !sectionsUsed.has(s));
  const rest = rulePicks(refs.filter((r) => !used.has(r.id)), restSections, previous).slice(0, Math.max(0, 5 - kept.length));
  return { picks: [...kept, ...rest], dropped };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const QUESTION_TARGETS = ["mood", "hero_layout", "colour_temperature", "primary_cta", "typography", "density", "other"] as const;

export const StudioQuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  question: z.string().min(5).max(240),
  options: z.array(z.string().min(1).max(120)).min(2).max(5),
  maps_to: z.enum(QUESTION_TARGETS),
});
export type StudioQuestion = z.infer<typeof StudioQuestionSchema> & { answer?: string | null };

export function presetQuestions(ctaLabels: string[]): StudioQuestion[] {
  return [
    { id: "mood", question: "Which overall feel suits this business best?", options: ["Warm and personal", "Clean and modern", "Bold and energetic", "Quietly premium"], maps_to: "mood" },
    { id: "hero", question: "How should the top of the home page work?", options: ["A large photo across the whole screen", "Photo beside the headline", "Headline centred with no large photo"], maps_to: "hero_layout" },
    { id: "colour", question: "Which colour temperature?", options: ["Warm", "Cool", "Neutral", "Take it from the references I loved"], maps_to: "colour_temperature" },
    { id: "cta", question: "What should a visitor do first?", options: [...new Set([...ctaLabels, "Call", "Send an enquiry"])].slice(0, 5), maps_to: "primary_cta" },
    { id: "type", question: "Which type style?", options: ["Classic serif headings", "Modern sans-serif throughout", "Strong condensed headings"], maps_to: "typography" },
  ];
}

// ---------------------------------------------------------------------------
// Applying answers to a brief (used for the preset brief and to enforce answers on AI briefs)
// ---------------------------------------------------------------------------

const PALETTES: Record<"warm" | "cool" | "neutral", DesignBrief["palette"]> = {
  warm: { primary: "#7a2e1f", secondary: "#f3e7d9", accent: "#d99a3d", background: "#fbf7f1", surface: "#ffffff", text: "#2a211c", muted: "#6f625a", rationale: "Warm earth tones, as chosen in the studio." },
  cool: { primary: "#1f3a4d", secondary: "#e6eef2", accent: "#2a9d8f", background: "#f7f9fa", surface: "#ffffff", text: "#16232b", muted: "#5b6a72", rationale: "Cool blues and teal, as chosen in the studio." },
  neutral: { primary: "#2b2b2b", secondary: "#efece6", accent: "#b0846a", background: "#faf9f7", surface: "#ffffff", text: "#1c1c1c", muted: "#66625d", rationale: "Neutral stone tones, as chosen in the studio." },
};

const TYPE_PAIRS: Record<string, [DesignBrief["typography"]["heading"], DesignBrief["typography"]["body"]]> = {
  serif: ["Fraunces", "DM Sans"],
  sans: ["Manrope", "Inter"],
  condensed: ["Oswald", "Inter"],
};

const MOODS: Record<string, string[]> = {
  "Warm and personal": ["warm", "personal", "welcoming"],
  "Clean and modern": ["clean", "modern", "clear"],
  "Bold and energetic": ["bold", "energetic", "confident"],
  "Quietly premium": ["refined", "calm", "premium"],
};

/** First chromatic colour from loved references dark enough to carry white text, if any. */
function lovedPrimary(lovedColours: string[]): string | null {
  for (const c of lovedColours) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l < 0.35) return c;
  }
  return null;
}

export function applyAnswers(brief: DesignBrief, questions: StudioQuestion[], ctx: { siteType: SiteType; bookingRelevant: boolean; lovedColours?: string[]; setStructure?: boolean }): { brief: DesignBrief; applied: string[] } {
  const b: DesignBrief = structuredClone(brief);
  const applied: string[] = [];
  for (const q of questions) {
    const a = q.answer?.trim();
    if (!a) continue;
    switch (q.maps_to) {
      case "mood":
        if (MOODS[a]) { b.mood_words = MOODS[a]; applied.push(`Mood: ${a}.`); }
        break;
      case "hero_layout": {
        const layout = /whole screen|full/i.test(a) ? "full-bleed" : /beside|split/i.test(a) ? "split" : /centred|centered/i.test(a) ? "centered" : null;
        if (layout) { b.hero_layout = layout; applied.push(`Hero: ${layout}.`); }
        break;
      }
      case "colour_temperature": {
        if (/loved/i.test(a)) {
          const p = lovedPrimary(ctx.lovedColours ?? []);
          if (p) { b.palette = { ...b.palette, primary: p, rationale: `Primary colour taken from a reference you loved (${p}).` }; applied.push(`Primary colour ${p} from a loved reference.`); }
        } else {
          const key = /warm/i.test(a) ? "warm" : /cool/i.test(a) ? "cool" : /neutral/i.test(a) ? "neutral" : null;
          if (key) { b.palette = PALETTES[key]; applied.push(`${a} palette.`); }
        }
        break;
      }
      case "primary_cta": {
        const rest = b.ctas.filter((c) => c.label.toLowerCase() !== a.toLowerCase());
        b.ctas = [{ label: a, purpose: "primary action chosen in the studio" }, ...rest].slice(0, 4);
        applied.push(`First call to action: ${a}.`);
        break;
      }
      case "typography": {
        const key = /serif/i.test(a) && !/sans/i.test(a) ? "serif" : /condensed/i.test(a) ? "condensed" : /sans/i.test(a) ? "sans" : null;
        if (key) { const [h, body] = TYPE_PAIRS[key]; b.typography = { heading: h, body, rationale: `${a}, as chosen in the studio.` }; applied.push(`Type: ${h} / ${body}.`); }
        break;
      }
      default:
        break;
    }
  }
  if (ctx.setStructure !== false) b.page_structure = pageStructureFor(ctx.siteType, ctx.bookingRelevant);
  return { brief: b, applied };
}

export function isFontChoice(f: string): f is (typeof FONT_CHOICES)[number] {
  return (FONT_CHOICES as readonly string[]).includes(f);
}
