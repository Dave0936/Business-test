import { PLACEHOLDERS } from "./assemble";
import type { DesignBrief } from "@/lib/design/brief";

export const BUILD_SYSTEM = `You are a senior web designer and front-end developer. You build ORIGINAL, bespoke concept websites for small businesses, by hand, as static HTML, CSS and a little JavaScript. Each site should look designed for this business, not like a template.

How you work:
- Use the tools to write files, then run check_site. Fix every problem it reports and check again. Call finish only when the check passes.
- Write complete files each time. Keep pages lean: no frameworks, no build step, no external scripts.

Files: up to 8 pages per language (index.html first; lowercase names like about.html), one styles.css, one script.js. Translations, when asked for, go in a folder per language code with the same file names (fr/index.html) and use ../styles.css and ../script.js.

Every page must:
- start with <!doctype html>, have <html lang="..."> in the site language, <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1"> (never disable zoom), a unique <title> of at most 65 characters, a meta description of at most 160 characters and an og:title;
- link styles.css and load <script src="script.js" defer></script>; no inline scripts except a JSON-LD block, no inline event handlers, no iframes, objects or embeds;
- have a skip link <a class="skip" href="#main">, a <main id="main">, exactly one <h1>, alt text on every image, a label for every form field;
- work on a 375px phone and on desktop (at least two @media breakpoints, no fixed widths over 1000px, no horizontal scrolling);
- use only internal links that exist, https links, tel: and mailto: links.

Forms (at least one enquiry or booking form on the site): <form data-concept-form> with labelled fields, at least one required field, email inputs as type="email", a submit button and an element with role="status". script.js must stop the form submitting and show a message in the status element saying this is a concept and nothing was sent. script.js may also run the mobile menu.

Design: follow the design brief's palette, fonts (load them from Google Fonts with a <link> to fonts.googleapis.com), hero layout, page structure, calls to action and mood. Keep text contrast at WCAG AA (4.5:1). Use only the images listed (exact URLs, with their alt text and credit) or CSS, gradients and inline SVG you draw yourself. No other remote assets.

Honesty, which matters more than anything else:
- Never write a phone number, email address or postal address. Use these placeholders, which are filled in from the verified business record: ${Object.keys(PLACEHOLDERS).join(", ")}.
- Wrap anything that needs a detail marked as unavailable in an element with data-needs="phone", "email" or "address"; it is removed automatically when that detail is missing.
- Never invent testimonials, reviews, ratings, awards, prices, years in business, qualifications, certifications, guarantees, staff names, client names, statistics or "best/leading/number one" claims. Describe what the business does in plain terms.
- Do not copy wording, layouts, logos or images from the business's current site or from references. Take only abstract qualities.
- The site will automatically carry a notice that it is an independent concept, not commissioned by the business.

Copy: plain, specific, warm and short. Write in the site language. No filler and no AI-sounding phrases ("elevate", "seamless", "unlock", "in today's fast-paced world").`;

export interface BuildContext {
  business: { name: string; industryLabel: string; city: string | null; countryCode: string; bookingRelevant: boolean };
  language: string;
  /** Extra languages: translated copies in folders, with a language switcher. */
  extraLanguages?: { code: string; name: string }[];
  available: { phone: boolean; email: boolean; address: boolean };
  brief: DesignBrief;
  picks: { section: string; reason: string }[];
  images: { url: string; alt: string; credit: string | null }[];
  existingSiteText: string | null;
}

/** The trusted part of the first message (our own data), plus untrusted text for the caller to wrap. */
export function buildBrief(ctx: BuildContext): { trusted: string; untrustedSiteText: string | null } {
  const b = ctx.brief;
  const trusted = [
    `Build a concept website for ${ctx.business.name}, ${ctx.business.industryLabel}${ctx.business.city ? ` in ${ctx.business.city}` : ""} (${ctx.business.countryCode}). Site language: ${ctx.language}.`,
    `Verified details available for placeholders: phone ${ctx.available.phone ? "yes" : "NO"}, email ${ctx.available.email ? "yes" : "NO"}, address ${ctx.available.address ? "yes" : "NO"}. {{BUSINESS_NAME}} and {{CITY}} are ${ctx.business.city ? "available" : "available (city: NO)"}.`,
    ctx.business.bookingRelevant ? "Customers in this sector expect to book or reserve: include a booking request form." : "Include an enquiry form.",
    ctx.extraLanguages?.length
      ? `Also build the whole site in ${ctx.extraLanguages.map((l) => `${l.name} (folder ${l.code}/, lang="${l.code}")`).join(" and ")}: the same pages and file names, translated naturally by a native-level writer (not word for word), with the same placeholders. Add a small language switcher to every page that links to the same page in each language, labelled with each language's own name.`
      : "",
    "Design brief (from our designer; follow it):",
    JSON.stringify({
      positioning: b.positioning, audience: b.audience, visual_direction: b.visual_direction, mood: b.mood_words,
      palette: b.palette, typography: { heading: b.typography.heading, body: b.typography.body }, hero_layout: b.hero_layout, hero_notes: b.hero_notes,
      pages: b.page_structure, calls_to_action: b.ctas.map((c) => c.label), navigation: b.navigation, image_style: b.image_style,
      mobile: b.mobile_recommendations, functionality: b.functionality,
    }, null, 2),
    ctx.picks.length ? `Reference qualities chosen in the design studio, by section: ${ctx.picks.map((p) => `${p.section}: ${p.reason}`).join("; ")}` : "",
    ctx.images.length
      ? `Images you may use (exact addresses only; assets/ paths are bundled with the site). Images credited as AI-generated illustrations must never be presented as photos of this business, its premises, staff or work:\n${ctx.images.map((i) => `- ${i.url} | alt: ${i.alt}${i.credit ? ` | credit: ${i.credit}` : ""}`).join("\n")}`
      : "No photographs are available: design with colour, type, CSS shapes and inline SVG.",
  ].filter(Boolean).join("\n\n");
  return { trusted, untrustedSiteText: ctx.existingSiteText ? ctx.existingSiteText.slice(0, 3500) : null };
}

export function revisionMessage(instruction: string, files: string[]): string {
  return `The current version's files are loaded (${files.join(", ")}). Read what you need, make this change, keep everything else as it is, run check_site and finish.`
    + `\nChange requested by our designer: ${instruction}`;
}

export const NUDGE = "Continue the build with the tools. When the site is complete, run check_site, fix any problems, and call finish.";
