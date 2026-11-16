import * as cheerio from "cheerio";
import type { SiteFiles } from "./spec";

/**
 * Self-hosted fonts for prototypes. Pages that load Google Fonts are rewritten to use font files
 * shipped with the site (from Fontsource, SIL Open Font Licence), so visitors' browsers never
 * contact Google. Only fonts in the approved list are hosted; others are left as they are.
 */

export interface FontManifest {
  [family: string]: { id: string; weights: number[]; subsets: Record<string, string> };
}

export type FontLoader = (id: string, file: string) => Uint8Array | null;

/** Families requested by Google Fonts links (css and css2 formats). */
export function googleFontFamilies(href: string): string[] {
  const out: string[] = [];
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return out;
  }
  if (url.hostname !== "fonts.googleapis.com") return out;
  for (const v of url.searchParams.getAll("family")) {
    for (const part of v.split("|")) {
      const name = part.split(":")[0].replace(/\+/g, " ").trim();
      if (name) out.push(name);
    }
  }
  return out;
}

export function fontFaceCss(manifest: FontManifest, families: string[]): { css: string; files: { path: string; id: string; file: string }[] } {
  const rules: string[] = [];
  const files: { path: string; id: string; file: string }[] = [];
  for (const family of families) {
    const m = manifest[family];
    if (!m) continue;
    for (const [subset, range] of Object.entries(m.subsets)) {
      for (const w of m.weights) {
        const file = `${subset}-${w}.woff2`;
        const path = `fonts/${m.id}-${file}`;
        files.push({ path, id: m.id, file });
        rules.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url("${m.id}-${file}") format("woff2");unicode-range:${range}}`);
      }
    }
  }
  return { css: rules.join("\n"), files };
}

export interface SelfHostResult {
  files: SiteFiles;
  hosted: string[];
  skipped: string[];
}

export function selfHostFonts(input: SiteFiles, manifest: FontManifest, load: FontLoader): SelfHostResult {
  const files: SiteFiles = { ...input };
  const requested = new Set<string>();
  const htmlFiles = Object.keys(files).filter((f) => f.endsWith(".html") && typeof files[f] === "string");
  for (const f of htmlFiles) {
    const $ = cheerio.load(files[f] as string);
    $('link[href*="fonts.googleapis.com"]').each((_, el) => googleFontFamilies($(el).attr("href") ?? "").forEach((x) => requested.add(x)));
  }
  const hosted = [...requested].filter((x) => manifest[x]);
  const skipped = [...requested].filter((x) => !manifest[x]);
  if (!hosted.length || skipped.length) return { files, hosted: [], skipped: [...requested] };

  const { css, files: fontFiles } = fontFaceCss(manifest, hosted);
  for (const ff of fontFiles) {
    const bytes = load(ff.id, ff.file);
    if (!bytes) return { files: input, hosted: [], skipped: [...requested] };
    files[ff.path] = { base64: Buffer.from(bytes).toString("base64"), contentType: "font/woff2" };
  }
  files["fonts/fonts.css"] = `/* Self-hosted fonts (SIL Open Font Licence, via Fontsource) */\n${css}\n`;
  for (const f of htmlFiles) {
    const $ = cheerio.load(files[f] as string);
    $('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]').remove();
    // Pages in language folders (fr/index.html) need a path back to the site root.
    const href = `${"../".repeat(f.split("/").length - 1)}fonts/fonts.css`;
    const first = $('link[rel="stylesheet"]').first();
    if (first.length) first.before(`<link rel="stylesheet" href="${href}">`);
    else $("head").append(`<link rel="stylesheet" href="${href}">`);
    files[f] = $.html();
  }
  // Fonts are now local: tighten the policy so the site never contacts Google.
  if (typeof files["_headers"] === "string") {
    files["_headers"] = (files["_headers"] as string).replace(" https://fonts.googleapis.com", "").replace("font-src https://fonts.gstatic.com", "font-src 'self'");
  }
  return { files, hosted, skipped };
}
