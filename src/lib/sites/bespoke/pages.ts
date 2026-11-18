import * as cheerio from "cheerio";
import type { DesignBrief } from "@/lib/design/brief";

/**
 * Homepage first: the builder makes index.html (and the stylesheet and script) first. The other
 * planned pages appear as simple placeholders, written by our code with the homepage's own
 * header and footer, so the preview clicks through. "Build the rest" replaces them.
 */

export interface PlannedPage {
  file: string;
  label: string;
}

export const STUB_MARKER = "data-placeholder-page";

const HOME = /^(home|homepage|home page|index|start|welcome)$/i;

export function pageFile(label: string): string {
  const slug = label.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug || "page"}.html`;
}

/** Pages from the brief's structure: index.html first, the rest named from their labels. */
export function plannedPagesFromBrief(brief: Pick<DesignBrief, "page_structure">, maxPages: number): PlannedPage[] {
  const out: PlannedPage[] = [{ file: "index.html", label: "Home" }];
  for (const p of brief.page_structure ?? []) {
    const label = p.page.trim();
    if (!label || HOME.test(label)) continue;
    const file = pageFile(label);
    if (file === "index.html" || out.some((o) => o.file === file)) continue;
    out.push({ file, label });
    if (out.length >= maxPages) break;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A placeholder page in the homepage's frame. */
export function stubPage(indexHtml: string, page: PlannedPage): string {
  const $ = cheerio.load(indexHtml);
  // The page's own h1 is the page name: demote any heading the header or footer carries.
  $("header h1, footer h1").each((_, el) => { el.tagName = "p"; });
  const lang = $("html").attr("lang") || "en";
  const header = $("header").first().length ? $.html($("header").first()) : `<header><a href="index.html">{{BUSINESS_NAME}}</a></header>`;
  const footer = $("footer").first().length ? $.html($("footer").first()) : "";
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.label)} · {{BUSINESS_NAME}}</title>
<meta name="description" content="${esc(page.label)} for {{BUSINESS_NAME}}. This page is built once the homepage is agreed.">
<meta property="og:title" content="${esc(page.label)} · {{BUSINESS_NAME}}">
<link rel="stylesheet" href="styles.css">
</head>
<body ${STUB_MARKER}>
<a class="skip" href="#main">Skip to content</a>
${header}
<main id="main">
<section class="placeholder-page">
<h1>${esc(page.label)}</h1>
<p>This page is built once the homepage is agreed. <a href="index.html">Back to the homepage</a>.</p>
</section>
</main>
${footer}
<script src="script.js" defer></script>
</body>
</html>
`;
}

/** The draft plus placeholders for any planned page not written yet. */
export function withPlaceholders(source: Record<string, string>, planned: PlannedPage[]): Record<string, string> {
  const index = source["index.html"];
  if (!index) return source;
  const out = { ...source };
  for (const p of planned) {
    if (p.file === "index.html" || out[p.file]) continue;
    out[p.file] = stubPage(index, p);
  }
  return out;
}

export function isPlaceholder(html: string): boolean {
  return html.includes(STUB_MARKER);
}
