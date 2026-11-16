import type { ResolvedImage } from "./spec";

/**
 * Image sourcing for prototypes.
 *  - Unsplash (licensed under the Unsplash License) when an access key is configured.
 *    We hotlink images.unsplash.com as Unsplash requires, credit the photographer,
 *    and ping the download endpoint when a photo is used.
 *  - Otherwise original abstract artwork generated here (no third-party rights).
 */
export async function unsplashSearch(accessKey: string, query: string): Promise<ResolvedImage | null> {
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");
  const res = await fetch(url, { headers: { authorization: `Client-ID ${accessKey}`, "accept-version": "v1" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { results: { urls: { raw: string }; alt_description: string | null; user: { name: string; links: { html: string } }; links: { download_location: string } }[] };
  const p = json.results[0];
  if (!p) return null;
  // Required by the Unsplash API guidelines when a photo is used.
  void fetch(p.links.download_location, { headers: { authorization: `Client-ID ${accessKey}` } }).catch(() => undefined);
  const src = `${p.urls.raw}${p.urls.raw.includes("?") ? "&" : "?"}w=1600&q=75&auto=format&fit=crop`;
  return {
    src,
    alt: p.alt_description ?? query,
    credit: { name: p.user.name, url: `${p.user.links.html}?utm_source=webopportunity_ai&utm_medium=referral`, source: "unsplash" },
    kind: "photo",
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Original abstract artwork (SVG) in the site's palette. */
export function artSvg(seed: string, colors: { primary: string; accent: string; secondary: string; background: string }): string {
  const h = hash(seed);
  const r = (n: number) => ((h >> (n * 3)) & 0xff) / 255;
  const shapes = [
    `<circle cx="${(200 + r(1) * 1000).toFixed(0)}" cy="${(150 + r(2) * 500).toFixed(0)}" r="${(180 + r(3) * 220).toFixed(0)}" fill="${colors.accent}" opacity="0.55"/>`,
    `<rect x="${(r(4) * 700).toFixed(0)}" y="${(r(5) * 400).toFixed(0)}" width="${(400 + r(6) * 500).toFixed(0)}" height="${(300 + r(7) * 300).toFixed(0)}" rx="40" fill="${colors.secondary}" opacity="0.5" transform="rotate(${(r(8) * 30 - 15).toFixed(1)} 800 450)"/>`,
    `<circle cx="${(900 + r(9) * 600).toFixed(0)}" cy="${(500 + r(10) * 300).toFixed(0)}" r="${(120 + r(11) * 160).toFixed(0)}" fill="${colors.background}" opacity="0.35"/>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" role="img"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors.primary}"/><stop offset="1" stop-color="${colors.secondary}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/>${shapes.join("")}</svg>`;
}

export function artFileName(query: string): string {
  return `assets/art-${hash(query).toString(36)}.svg`;
}
