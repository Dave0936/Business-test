import * as cheerio from "cheerio";
import type { SiteFiles } from "../spec";

/**
 * Turns the files Claude wrote into a publishable concept site. Claude never writes contact
 * details: it uses placeholders that are filled here from the verified business record.
 * Elements marked data-needs="phone|email|address" are removed when that fact is missing,
 * so nothing is ever invented to fill a gap. Every page gets the concept notice.
 */

export const MAX_PAGES = 8;
export const MAX_FILE_BYTES = 150_000;
const HTML_RE = /^[a-z0-9][a-z0-9-]{0,23}\.html$/;

export function isAllowedSourcePath(path: string): boolean {
  return HTML_RE.test(path) || path === "styles.css" || path === "script.js";
}

export interface VerifiedFacts {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  language: string;
}

export interface AssembleContext {
  facts: VerifiedFacts;
  agencyName: string;
  agencyWebsite: string | null;
  photoCredits?: string[];
}

export const PLACEHOLDERS = {
  "{{BUSINESS_NAME}}": "the business name",
  "{{PHONE}}": "the phone number as displayed",
  "{{PHONE_LINK}}": "a tel: link target, e.g. href=\"{{PHONE_LINK}}\"",
  "{{EMAIL}}": "the email address",
  "{{EMAIL_LINK}}": "a mailto: link target",
  "{{ADDRESS}}": "the postal address",
  "{{CITY}}": "the town or city",
  "{{YEAR}}": "the current year",
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function telHref(phone: string): string {
  const t = phone.trim();
  const digits = t.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
}

const CONCEPT_CSS = `/* Added by WebOpportunity AI: concept notice */
.concept-bar{background:#111;color:#fff;font:500 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:6px 16px}
.concept-legal{font:400 12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:16px;opacity:.75}
`;

export function headersFile(agencyWebsite: string | null): string {
  let ancestor = "";
  try {
    if (agencyWebsite) ancestor = ` ${new URL(agencyWebsite).origin}`;
  } catch {
    ancestor = "";
  }
  return `/*
  Content-Security-Policy: default-src 'self'; img-src 'self' https://images.unsplash.com data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'self'${ancestor}; base-uri 'self'; object-src 'none'
  X-Robots-Tag: noindex, nofollow
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;
}

export interface AssembleResult {
  files: SiteFiles;
  notes: string[];
}

export function assembleBespoke(source: Record<string, string>, ctx: AssembleContext, now = new Date()): AssembleResult {
  const files: SiteFiles = {};
  const notes: string[] = [];
  const f = ctx.facts;
  const values: Record<string, string | null> = {
    "{{BUSINESS_NAME}}": f.name,
    "{{PHONE}}": f.phone,
    "{{PHONE_LINK}}": f.phone ? telHref(f.phone) : null,
    "{{EMAIL}}": f.email,
    "{{EMAIL_LINK}}": f.email ? `mailto:${f.email}` : null,
    "{{ADDRESS}}": f.address,
    "{{CITY}}": f.city,
    "{{YEAR}}": String(now.getFullYear()),
  };
  const needs: Record<string, string | null> = { phone: f.phone, email: f.email, address: f.address, city: f.city };

  const pages = Object.keys(source).filter((p) => HTML_RE.test(p)).sort();
  if (pages.length > MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} pages were kept.`);
  for (const path of pages.slice(0, MAX_PAGES)) {
    const $ = cheerio.load(source[path]);
    // Remove anything that needs a fact we do not have, rather than inventing it.
    $("[data-needs]").each((_, el) => {
      const keys = ($(el).attr("data-needs") ?? "").split(/[\s,]+/).filter(Boolean);
      if (keys.some((k) => !needs[k])) $(el).remove();
      else $(el).removeAttr("data-needs");
    });
    if ($("html").attr("lang") === undefined) $("html").attr("lang", f.language);
    if ($('meta[name="robots"]').length === 0) $("head").append('<meta name="robots" content="noindex, nofollow">');
    $(".concept-bar, .concept-legal").remove(); // only ours, with the exact wording
    $("body").prepend(`<div class="concept-bar" role="note">Independent website concept created by ${esc(ctx.agencyName)}. It has not been commissioned or endorsed by ${esc(f.name)}.</div>`);
    const credits = ctx.photoCredits?.length ? ` Photos from Unsplash by ${esc(ctx.photoCredits.join(", "))}.` : "";
    $("body").append(`<div class="footer-legal concept-legal">Concept by ${esc(ctx.agencyName)}. Not commissioned or endorsed by ${esc(f.name)}. Business details are taken from public listings.${credits}</div>`);

    let html = $.html();
    if (!/^<!doctype html>/i.test(html.trim())) html = `<!doctype html>\n${html}`;
    for (const [token, value] of Object.entries(values)) {
      if (value === null) continue;
      html = html.split(token).join(esc(value));
    }
    const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
    if (leftover) {
      notes.push(`${path}: removed placeholders for missing details (${[...new Set(leftover)].join(", ")}).`);
      html = html.replace(/\{\{[A-Z_]+\}\}/g, "");
    }
    files[path] = html;
  }
  files["styles.css"] = CONCEPT_CSS + (source["styles.css"] ?? "");
  files["script.js"] = source["script.js"] ?? "";
  files["robots.txt"] = "User-agent: *\nDisallow: /\n";
  files["_headers"] = headersFile(ctx.agencyWebsite);
  return { files, notes };
}
