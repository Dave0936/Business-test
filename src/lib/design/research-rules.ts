import { assertSafeUrl } from "@/lib/security/safe-fetch";

/** Places that are not a business's own website, so never useful as design references. */
export const RESEARCH_BLOCKED_DOMAINS = [
  "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "linkedin.com", "youtube.com", "pinterest.com",
  "tripadvisor.com", "tripadvisor.co.uk", "yelp.com", "yell.com", "google.com", "maps.apple.com", "booking.com",
  "opentable.com", "opentable.co.uk", "thefork.com", "deliveroo.co.uk", "ubereats.com", "just-eat.co.uk", "treatwell.co.uk",
  "fresha.com", "checkatrade.com", "trustpilot.com", "bark.com", "wikipedia.org", "amazon.com", "amazon.co.uk", "etsy.com",
  "themeforest.net", "envato.com", "wix.com", "squarespace.com", "webflow.com", "wordpress.com", "shopify.com",
];

function blocked(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return RESEARCH_BLOCKED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Turn raw search hits into candidates: public https addresses only, no blocked domains, one
 * per site (home page preferred), none already in the studio. At most 20.
 */
export function chooseResearchHits(hits: { url: string; title: string }[], existing: Set<string>): { url: string; title: string }[] {
  const byHost = new Map<string, { url: string; title: string }>();
  for (const h of hits) {
    let u: URL;
    try {
      u = assertSafeUrl(h.url);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || blocked(u.hostname)) continue;
    const host = u.hostname.replace(/^www\./, "");
    const clean = `${u.origin}${u.pathname}`.replace(/\/$/, "");
    if (existing.has(clean) || existing.has(u.origin) || existing.has(`${u.origin}/`)) continue;
    const prev = byHost.get(host);
    const isHome = u.pathname === "/" || u.pathname === "";
    if (!prev || (isHome && new URL(prev.url).pathname !== "/")) byHost.set(host, { url: isHome ? `${u.origin}/` : clean, title: h.title.slice(0, 200) });
  }
  return [...byHost.values()].slice(0, 20);
}
