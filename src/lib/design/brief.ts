import { z } from "zod";
import { industryById } from "@/lib/industries";

/** Fonts the renderer can load (Google Fonts, open licences). The brief may only choose from these. */
export const FONT_CHOICES = [
  "Inter", "DM Sans", "Manrope", "Outfit", "Plus Jakarta Sans", "Work Sans", "Source Sans 3", "Nunito Sans",
  "Playfair Display", "Fraunces", "Cormorant Garamond", "Libre Baskerville", "Lora", "DM Serif Display",
  "Space Grotesk", "Sora", "Archivo", "Barlow", "Oswald", "Bebas Neue", "Poppins", "Montserrat", "Raleway",
] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const DesignBriefSchema = z.object({
  positioning: z.string().describe("One or two sentences on how this business should come across"),
  audience: z.string(),
  visual_direction: z.string(),
  mood_words: z.array(z.string()).max(6),
  palette: z.object({
    primary: hex, secondary: hex, accent: hex, background: hex, surface: hex, text: hex, muted: hex,
    rationale: z.string(),
  }),
  typography: z.object({
    heading: z.enum(FONT_CHOICES),
    body: z.enum(FONT_CHOICES),
    rationale: z.string(),
  }),
  hero_layout: z.enum(["split", "centered", "full-bleed"]),
  hero_notes: z.string(),
  page_structure: z.array(z.object({ page: z.string(), sections: z.array(z.string()) })),
  image_style: z.string(),
  image_queries: z.array(z.string()).max(8).describe("Stock-photo search terms; generic, no brand names"),
  navigation: z.string(),
  ctas: z.array(z.object({ label: z.string(), purpose: z.string() })).max(4),
  mobile_recommendations: z.array(z.string()),
  functionality: z.array(z.string()),
  references_used: z.array(z.object({ reference_id: z.string(), takeaway: z.string() })).describe("Abstract qualities taken from each reference, never copied layouts or assets"),
  originality_note: z.string(),
});
export type DesignBrief = z.infer<typeof DesignBriefSchema>;

interface Preset {
  palette: DesignBrief["palette"];
  heading: DesignBrief["typography"]["heading"];
  body: DesignBrief["typography"]["body"];
  hero: DesignBrief["hero_layout"];
  mood: string[];
  images: string[];
  ctas: { label: string; purpose: string }[];
}

const PRESETS: Record<string, Preset> = {
  food: { palette: { primary: "#7a2e1f", secondary: "#2f3b2f", accent: "#d99a3d", background: "#fbf7f1", surface: "#ffffff", text: "#2a211c", muted: "#7a6e66", rationale: "Warm, appetising earth tones." }, heading: "Fraunces", body: "DM Sans", hero: "full-bleed", mood: ["warm", "inviting", "crafted"], images: ["restaurant interior warm light", "plated food close up", "chef cooking kitchen"], ctas: [{ label: "Book a table", purpose: "reservations" }, { label: "View menu", purpose: "browse" }] },
  hospitality: { palette: { primary: "#1f3a4d", secondary: "#c8a96a", accent: "#c8a96a", background: "#f7f5f0", surface: "#ffffff", text: "#1d2428", muted: "#6b7378", rationale: "Calm, trustworthy, quietly premium." }, heading: "Cormorant Garamond", body: "Manrope", hero: "full-bleed", mood: ["restful", "elegant", "welcoming"], images: ["hotel bedroom natural light", "hotel lounge", "coastal town view"], ctas: [{ label: "Check availability", purpose: "booking" }, { label: "See rooms", purpose: "browse" }] },
  beauty: { palette: { primary: "#6b3f5a", secondary: "#e8d5cf", accent: "#c98b7a", background: "#fdf9f7", surface: "#ffffff", text: "#2b2228", muted: "#857a80", rationale: "Soft, refined and calm." }, heading: "Playfair Display", body: "Nunito Sans", hero: "split", mood: ["refined", "calm", "personal"], images: ["beauty salon interior", "skincare treatment", "hair stylist at work"], ctas: [{ label: "Book an appointment", purpose: "booking" }, { label: "See treatments", purpose: "browse" }] },
  healthcare: { palette: { primary: "#0f5c6e", secondary: "#e6f2f3", accent: "#2a9d8f", background: "#f8fbfb", surface: "#ffffff", text: "#16282c", muted: "#5f7479", rationale: "Clean, clinical but friendly." }, heading: "Plus Jakarta Sans", body: "Source Sans 3", hero: "split", mood: ["reassuring", "clean", "professional"], images: ["modern dental clinic", "friendly dentist patient", "clinic reception"], ctas: [{ label: "Book a check-up", purpose: "booking" }, { label: "Call the practice", purpose: "call" }] },
  trades: { palette: { primary: "#1e3a5f", secondary: "#f2b134", accent: "#f2b134", background: "#f6f7f9", surface: "#ffffff", text: "#141b24", muted: "#5d6773", rationale: "Dependable navy with high-visibility accent." }, heading: "Archivo", body: "Inter", hero: "split", mood: ["dependable", "direct", "capable"], images: ["tradesperson at work", "modern home renovation", "tools on workbench"], ctas: [{ label: "Get a free quote", purpose: "enquiry" }, { label: "Call now", purpose: "call" }] },
  automotive: { palette: { primary: "#1b1f24", secondary: "#e63946", accent: "#e63946", background: "#f5f5f6", surface: "#ffffff", text: "#121417", muted: "#62666d", rationale: "Strong contrast, workshop energy." }, heading: "Barlow", body: "Inter", hero: "split", mood: ["capable", "honest", "fast"], images: ["mechanic working on car", "car workshop", "car service"], ctas: [{ label: "Book a service", purpose: "booking" }, { label: "Call the garage", purpose: "call" }] },
  property: { palette: { primary: "#22313f", secondary: "#a68a64", accent: "#a68a64", background: "#f8f7f4", surface: "#ffffff", text: "#1c232a", muted: "#6c7178", rationale: "Assured and local." }, heading: "DM Serif Display", body: "Manrope", hero: "full-bleed", mood: ["assured", "local", "polished"], images: ["bright modern living room", "street of houses", "keys handover"], ctas: [{ label: "Book a valuation", purpose: "enquiry" }, { label: "View properties", purpose: "browse" }] },
  fitness: { palette: { primary: "#111827", secondary: "#a3e635", accent: "#a3e635", background: "#f7f7f5", surface: "#ffffff", text: "#0f1115", muted: "#5d6168", rationale: "High energy with a bold accent." }, heading: "Oswald", body: "Inter", hero: "full-bleed", mood: ["energetic", "motivating", "bold"], images: ["gym training session", "people working out", "strength training"], ctas: [{ label: "Book a free session", purpose: "booking" }, { label: "See memberships", purpose: "browse" }] },
  professional: { palette: { primary: "#1f2a44", secondary: "#e9edf3", accent: "#3b82f6", background: "#f8fafc", surface: "#ffffff", text: "#111827", muted: "#64748b", rationale: "Credible, calm and clear." }, heading: "Manrope", body: "Inter", hero: "split", mood: ["credible", "clear", "approachable"], images: ["professional office meeting", "advisor with client", "modern office"], ctas: [{ label: "Book a consultation", purpose: "booking" }, { label: "Get in touch", purpose: "enquiry" }] },
  services: { palette: { primary: "#155e75", secondary: "#ecfeff", accent: "#22c55e", background: "#f8fafb", surface: "#ffffff", text: "#132026", muted: "#5b6b72", rationale: "Fresh and dependable." }, heading: "Outfit", body: "Inter", hero: "split", mood: ["fresh", "reliable", "friendly"], images: ["professional cleaner at work", "clean bright home", "team in uniform"], ctas: [{ label: "Get a quote", purpose: "enquiry" }, { label: "Book a clean", purpose: "booking" }] },
  retail: { palette: { primary: "#3d405b", secondary: "#f4f1de", accent: "#e07a5f", background: "#fbfaf6", surface: "#ffffff", text: "#24252f", muted: "#6f7080", rationale: "Characterful independent shop." }, heading: "Fraunces", body: "Work Sans", hero: "split", mood: ["characterful", "curated", "local"], images: ["independent shop interior", "products on shelves", "shop owner"], ctas: [{ label: "Visit the shop", purpose: "visit" }, { label: "Get in touch", purpose: "enquiry" }] },
};

/** Deterministic brief used when AI is not configured. Labelled generated_by=demo. */
export function presetBrief(industryId: string | null, businessName: string): DesignBrief {
  const industry = industryById(industryId);
  const p = PRESETS[industry?.sector ?? "professional"] ?? PRESETS.professional;
  const pages = industry?.bookingRelevant
    ? [{ page: "Home", sections: ["Hero", "Services", "About", "Gallery", "Booking", "Contact"] }, { page: "Services", sections: ["Intro", "Service list", "Call to action"] }, { page: "About", sections: ["Story", "Values"] }, { page: "Contact", sections: ["Enquiry form", "Details"] }]
    : [{ page: "Home", sections: ["Hero", "Services", "Why us", "Gallery", "Call to action"] }, { page: "Services", sections: ["Intro", "Service list"] }, { page: "About", sections: ["Story"] }, { page: "Contact", sections: ["Enquiry form", "Details"] }];
  return {
    positioning: `${businessName} as a trusted local ${industry?.label.toLowerCase().replace(/s$/, "") ?? "business"} that is easy to contact.`,
    audience: "Local customers searching on their phones.",
    visual_direction: `${p.mood.join(", ")}. Generous spacing, clear hierarchy, one strong call to action per screen.`,
    mood_words: p.mood,
    palette: p.palette,
    typography: { heading: p.heading, body: p.body, rationale: "Readable pairing with distinct headings." },
    hero_layout: p.hero,
    hero_notes: "Headline that states what they do and where; primary call to action above the fold on mobile.",
    page_structure: pages,
    image_style: "Natural light, real settings, no staged stock clichés.",
    image_queries: p.images,
    navigation: "Simple top bar: Home, Services, About, Contact, with the primary action as a button.",
    ctas: p.ctas,
    mobile_recommendations: ["Sticky call/book button on phones", "Tap-to-call phone number", "Single-column layout under 640px"],
    functionality: industry?.bookingRelevant ? ["Booking request form", "Enquiry form", "Click-to-call"] : ["Enquiry form", "Click-to-call"],
    references_used: [],
    originality_note: "Built from a sector preset (AI not configured). No external designs referenced.",
  };
}

/** WCAG relative luminance contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Darken a colour until white text on it passes WCAG AA. */
function darkenUntil(hex: string, against: string, min = 4.5): string {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < 40 && contrastRatio(`#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`, against) < min; i++) {
    [r, g, b] = [r, g, b].map((c) => Math.max(0, Math.round(c * 0.92)));
  }
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function ensureAccessiblePalette(brief: DesignBrief): { brief: DesignBrief; adjustments: string[] } {
  const p = { ...brief.palette };
  const adjustments: string[] = [];
  if (contrastRatio(p.text, p.background) < 4.5) {
    adjustments.push(`Text colour ${p.text} changed to #1a1a1a for contrast on ${p.background}.`);
    p.text = "#1a1a1a";
  }
  if (contrastRatio(p.text, p.surface) < 4.5) {
    adjustments.push(`Surface ${p.surface} changed to #ffffff for text contrast.`);
    p.surface = "#ffffff";
  }
  if (contrastRatio("#ffffff", p.primary) < 4.5) {
    const d = darkenUntil(p.primary, "#ffffff");
    adjustments.push(`Primary ${p.primary} darkened to ${d} so button text passes WCAG AA.`);
    p.primary = d;
  }
  if (contrastRatio(p.muted, p.background) < 4.5) {
    const d = darkenUntil(p.muted, p.background);
    adjustments.push(`Muted text ${p.muted} darkened to ${d} for readability.`);
    p.muted = d;
  }
  return { brief: { ...brief, palette: p }, adjustments };
}

