import { z } from "zod";
import { FONT_CHOICES } from "@/lib/design/brief";

/**
 * What the AI writes: words and structure only.
 * Deliberately absent: testimonials, reviews, ratings, awards, prices, staff names,
 * years in business, phone numbers, emails and addresses. Contact details are added
 * by code from the verified business record; claims cannot be expressed at all.
 */
const Cta = z.object({ label: z.string().max(40), target: z.enum(["contact", "booking", "call", "services", "email"]) });

export const SectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), heading: z.string().max(90), subheading: z.string().max(220), primary_cta: Cta, secondary_cta: Cta.nullable(), image_query: z.string().max(80) }),
  z.object({ type: z.literal("text"), heading: z.string().max(90), paragraphs: z.array(z.string().max(700)).min(1).max(4) }),
  z.object({ type: z.literal("services"), heading: z.string().max(90), intro: z.string().max(300), items: z.array(z.object({ name: z.string().max(60), description: z.string().max(260) })).min(2).max(9) }),
  z.object({ type: z.literal("features"), heading: z.string().max(90), items: z.array(z.object({ title: z.string().max(60), text: z.string().max(220) })).min(2).max(6) }),
  z.object({ type: z.literal("gallery"), heading: z.string().max(90), image_queries: z.array(z.string().max(80)).min(3).max(8) }),
  z.object({ type: z.literal("cta"), heading: z.string().max(90), text: z.string().max(240), cta: Cta }),
  z.object({ type: z.literal("contact"), heading: z.string().max(90), text: z.string().max(300) }),
  z.object({ type: z.literal("booking"), heading: z.string().max(90), text: z.string().max(300), fields: z.array(z.enum(["date", "time", "party_size", "service", "notes"])).max(5) }),
  z.object({ type: z.literal("faq"), heading: z.string().max(90), items: z.array(z.object({ question: z.string().max(140), answer: z.string().max(500) })).min(2).max(8) }),
]);
export type Section = z.infer<typeof SectionSchema>;

export const PAGE_SLUGS = ["index", "about", "services", "gallery", "contact", "booking"] as const;

export const SiteContentSchema = z.object({
  tagline: z.string().max(120),
  seo_title: z.string().max(65),
  seo_description: z.string().max(160),
  pages: z.array(z.object({
    slug: z.enum(PAGE_SLUGS),
    nav_label: z.string().max(24),
    title: z.string().max(65),
    meta_description: z.string().max(160),
    sections: z.array(SectionSchema).min(1).max(8),
  })).min(2).max(6),
});
export type SiteContent = z.infer<typeof SiteContentSchema>;

export const ThemeSchema = z.object({
  colors: z.object({ primary: z.string(), secondary: z.string(), accent: z.string(), background: z.string(), surface: z.string(), text: z.string(), muted: z.string() }),
  fonts: z.object({ heading: z.enum(FONT_CHOICES), body: z.enum(FONT_CHOICES) }),
  radius: z.enum(["none", "small", "medium", "large"]),
  heroLayout: z.enum(["split", "centered", "full-bleed"]),
  density: z.enum(["compact", "comfortable", "airy"]),
});
export type Theme = z.infer<typeof ThemeSchema>;

export interface ResolvedImage {
  src: string; // absolute https URL or local path under /assets/
  alt: string;
  credit?: { name: string; url: string; source: "unsplash" } | null;
  kind: "photo" | "art" | "upload";
}

/** The complete, renderable prototype. Stored immutably per version. */
export interface SiteSpec {
  version: 1;
  content: SiteContent;
  theme: Theme;
  /** Verified facts only, copied from the business record by code. */
  business: {
    name: string;
    city: string | null;
    region: string | null;
    countryCode: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    language: string;
  };
  agency: { name: string; website: string | null; email: string | null };
  images: Record<string, ResolvedImage>; // keyed by image query
  slug: string;
  generatedBy: "ai" | "demo" | "manual";
}

/** Assets that are not plain text (uploaded images) are stored base64-encoded. */
export type SiteFile = string | { base64: string; contentType: string };
export type SiteFiles = Record<string, SiteFile>;
