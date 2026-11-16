import * as cheerio from "cheerio";

/**
 * Observed design facts from a reference website's HTML: what it declares, not what we think
 * of it. Used as inspiration only (abstract qualities); nothing here is copied into a design.
 */
export interface SiteDesignFacts {
  title: string | null;
  description: string | null;
  previewImage: string | null;
  themeColour: string | null;
  fonts: string[];
  colours: string[];
  usesSerifHeadings: boolean | null;
}

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial", "unset", "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "helvetica neue", "helvetica", "arial", "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji", "var"]);
const SERIF_HINT = /(serif|garamond|baskerville|playfair|fraunces|lora|merriweather|caslon|bodoni|didot|georgia|times|cormorant|libre caslon|dm serif|crimson|spectral|prata|marcellus)/i;

function normaliseHex(h: string): string {
  const v = h.toLowerCase();
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

/** Near-white, near-black and grey are layout colours, not palette choices. */
function isChromatic(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min > 28 && max > 40 && min < 235;
}

export function extractSiteDesignFacts(html: string, pageUrl: string): SiteDesignFacts {
  const $ = cheerio.load(html);
  const abs = (u: string | undefined) => {
    if (!u) return null;
    try {
      const v = new URL(u, pageUrl);
      return v.protocol === "https:" || v.protocol === "http:" ? v.toString() : null;
    } catch {
      return null;
    }
  };

  // Fonts: Google Fonts / Bunny / Fontshare links, @font-face and font-family declarations.
  const fonts = new Set<string>();
  $("link[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/fonts\.googleapis\.com|fonts\.bunny\.net/i.test(href)) {
      for (const m of href.matchAll(/family=([^&:]+)/g)) fonts.add(decodeURIComponent(m[1]).replace(/\+/g, " ").trim());
    }
  });
  const css = $("style").text() + " " + $("[style]").toArray().map((el) => $(el).attr("style")).join(";");
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const part of m[1].split(",")) {
      const name = part.replace(/["']/g, "").replace(/!important/i, "").trim();
      if (name && !GENERIC_FONTS.has(name.toLowerCase()) && !name.startsWith("var(") && name.length < 40) fonts.add(name);
    }
  }

  // Colours: theme-color plus the most used chromatic hex values in inline CSS.
  const counts = new Map<string, number>();
  for (const m of css.match(HEX) ?? []) {
    const h = normaliseHex(m);
    if (isChromatic(h)) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const themeRaw = $('meta[name="theme-color"]').attr("content")?.trim() ?? null;
  const themeColour = themeRaw && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(themeRaw) ? normaliseHex(themeRaw) : null;
  const colours = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).filter((h) => h !== themeColour).slice(0, 6);

  const fontList = [...fonts].slice(0, 6);
  return {
    title: $('meta[property="og:title"]').attr("content")?.trim() || $("title").first().text().trim() || null,
    description: $('meta[property="og:description"]').attr("content")?.trim() || $('meta[name="description"]').attr("content")?.trim() || null,
    previewImage: abs($('meta[property="og:image"]').attr("content") ?? $('meta[name="twitter:image"]').attr("content")),
    themeColour,
    fonts: fontList,
    colours: themeColour ? [themeColour, ...colours].slice(0, 6) : colours,
    usesSerifHeadings: fontList.length ? SERIF_HINT.test(fontList[0]) : null,
  };
}
