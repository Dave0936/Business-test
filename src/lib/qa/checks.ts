import * as cheerio from "cheerio";
import { contrastRatio } from "@/lib/design/brief";
import type { SiteFiles, SiteSpec } from "@/lib/sites/spec";

export type CheckStatus = "pass" | "fail" | "warn" | "skipped";
export interface QaCheck {
  id: string;
  label: string;
  status: CheckStatus;
  details: string[];
}
export interface QaReport {
  passed: boolean;
  checks: QaCheck[];
  ranAt: string;
}

const ALLOWED_REMOTE = [/^https:\/\/images\.unsplash\.com\//, /^https:\/\/fonts\.googleapis\.com(\/|$)/, /^https:\/\/fonts\.gstatic\.com/];
const CLAIM_PATTERNS: [RegExp, string][] = [
  [/\btestimonial/i, "testimonial"], [/\b(customer|client|our|google|5-star|five-star|read (the )?)\s*reviews?\b/i, "review"], [/\b\d(\.\d)?\s*(\/\s*5|stars?|★)/i, "star rating"],
  [/award[- ]winning|\bawards?\b/i, "award"], [/\b(no\.?\s*1|number one|#1)\b/i, "ranking claim"],
  [/\b(best (in|of) (town|the (city|area|region|country))|the best [a-z]+ in|leading|top-rated|most trusted|highest[- ]rated)\b/i, "superlative"], [/\b\d+\+?\s*years?('|’)?\s*(of )?(experience|in business|serving)/i, "years-in-business claim"],
  [/\b(certified|accredited|licensed|qualified|registered with)\b/i, "qualification claim"],
  [/\b(guarantee[ds]?|100%)\b/i, "guarantee"], [/\btrusted by\b/i, "endorsement claim"],
  [/[£$€]\s?\d/, "price"],
];
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Resolve a link or asset path relative to the page that uses it (pages may sit in language folders). */
export function resolveSitePath(fromFile: string, ref: string): string | null {
  const clean = ref.split(/[?#]/)[0];
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/") + 1) : "";
  const joined = clean.startsWith("/") ? clean.slice(1) : dir + clean;
  const out: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  const resolved = out.join("/");
  return clean.endsWith("/") || resolved === "" ? `${resolved ? `${resolved}/` : ""}index.html` : resolved;
}

function asText(f: SiteFiles[string] | undefined): string | null {
  return typeof f === "string" ? f : null;
}

export interface QaContext {
  verified: { phone: string | null; email: string | null; name: string };
  agencyName: string;
  /** Optional results from a real browser run (see qa/browser.ts). */
  browser?: { ran: boolean; pages: { file: string; mobileOverflow: boolean; desktopOverflow: boolean; consoleErrors: string[] }[]; error?: string };
}

export function runQaChecks(files: SiteFiles, spec: SiteSpec, ctx: QaContext): QaReport {
  const checks: QaCheck[] = [];
  const add = (id: string, label: string, failures: string[], warnings: string[] = [], skipped = false) =>
    checks.push({ id, label, status: skipped ? "skipped" : failures.length ? "fail" : warnings.length ? "warn" : "pass", details: [...failures, ...warnings.map((w) => `Warning: ${w}`)] });

  const htmlFiles = Object.keys(files).filter((f) => f.endsWith(".html"));

  // 1. Build
  {
    const f: string[] = [];
    if (!files["index.html"]) f.push("index.html is missing.");
    for (const req of ["styles.css", "script.js", "_headers"]) if (!files[req]) f.push(`${req} is missing.`);
    for (const h of htmlFiles) {
      const t = asText(files[h]) ?? "";
      if (!/^<!doctype html>/i.test(t.trim())) f.push(`${h}: missing doctype.`);
      if (t.length > 400_000) f.push(`${h}: page is unexpectedly large (${Math.round(t.length / 1024)} KB).`);
      if (/undefined|\[object Object\]|NaN/.test(cheerio.load(t)("body").text())) f.push(`${h}: contains rendering artefacts (undefined/NaN).`);
    }
    const total = Object.values(files).reduce((s, v) => s + (typeof v === "string" ? v.length : v.base64.length * 0.75), 0);
    if (total > 20_000_000) f.push("Site exceeds 20 MB.");
    add("build", "Build", f);
  }

  const docs = htmlFiles.map((h) => ({ file: h, $: cheerio.load(asText(files[h]) ?? "") }));

  // 2. Broken links + missing assets
  {
    const broken: string[] = [];
    const missing: string[] = [];
    for (const { file, $ } of docs) {
      $("a[href]").each((_, el) => {
        const href = ($(el).attr("href") ?? "").trim();
        if (!href) return void broken.push(`${file}: empty link.`);
        if (/^javascript:/i.test(href)) return void broken.push(`${file}: javascript: link.`);
        if (/^(tel:|mailto:)/i.test(href)) return;
        if (/^https:\/\//i.test(href)) return;
        if (/^http:\/\//i.test(href)) return void broken.push(`${file}: insecure link ${href}.`);
        const [path, hash] = href.split("#");
        const target = path === "" ? file : resolveSitePath(file, path);
        if (!target || !files[target]) return void broken.push(`${file}: link to missing page ${href}.`);
        if (hash) {
          const t$ = docs.find((d) => d.file === target)?.$;
          if (t$ && t$(`#${hash.replace(/[^\w-]/g, "")}`).length === 0) broken.push(`${file}: anchor #${hash} not found on ${target}.`);
        }
      });
      $("img[src], link[href], script[src]").each((_, el) => {
        const ref = $(el).attr("src") ?? $(el).attr("href") ?? "";
        if (/^https:\/\//.test(ref)) {
          if (!ALLOWED_REMOTE.some((re) => re.test(ref))) missing.push(`${file}: remote asset from an unapproved host: ${ref}`);
          return;
        }
        if (/^data:/.test(ref)) return;
        const target = resolveSitePath(file, ref);
        if (!target || !files[target]) missing.push(`${file}: missing asset ${ref}`);
      });
    }
    add("links", "Broken links", broken);
    add("assets", "Missing assets", missing);
  }

  // 3. Responsive layout (static) + mobile rendering (browser if available)
  {
    const f: string[] = [];
    const w: string[] = [];
    for (const { file, $ } of docs) {
      const vp = $('meta[name="viewport"]').attr("content") ?? "";
      if (!/width=device-width/.test(vp)) f.push(`${file}: missing responsive viewport meta tag.`);
      if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(vp)) f.push(`${file}: zoom is disabled.`);
    }
    const cssText = asText(files["styles.css"]) ?? "";
    if ((cssText.match(/@media/g) ?? []).length < 2) f.push("Stylesheet has no responsive breakpoints.");
    if (/width:\s*(\d{4,})px/.test(cssText)) w.push("Stylesheet contains fixed widths over 1000px.");
    add("responsive", "Responsive layout", f, w);

    if (!ctx.browser?.ran) {
      add("mobile_render", "Mobile rendering", [], [], true);
      checks[checks.length - 1].details = [ctx.browser?.error ? `Browser check unavailable: ${ctx.browser.error}` : "Browser check not run (set QA_BROWSER=true where Chromium is available). Static responsive checks passed separately."];
    } else {
      const mf: string[] = [];
      const mw: string[] = [];
      for (const p of ctx.browser.pages) {
        if (p.mobileOverflow) mf.push(`${p.file}: content wider than a 375px phone screen.`);
        if (p.desktopOverflow) mf.push(`${p.file}: horizontal overflow at 1280px.`);
        for (const e of p.consoleErrors.slice(0, 3)) mw.push(`${p.file}: console error: ${e}`);
      }
      add("mobile_render", "Mobile rendering", mf, mw);
    }
  }

  // 4. Accessibility
  {
    const f: string[] = [];
    const w: string[] = [];
    for (const { file, $ } of docs) {
      if (!$("html").attr("lang")) f.push(`${file}: no lang attribute.`);
      const h1 = $("h1").length;
      if (h1 !== 1) f.push(`${file}: expected exactly one h1, found ${h1}.`);
      $("img").each((_, el) => { if ($(el).attr("alt") === undefined) f.push(`${file}: image without alt attribute.`); });
      $("input, textarea, select").each((_, el) => {
        const id = $(el).attr("id");
        if ($(el).attr("type") === "hidden") return;
        if (!id || $(`label[for="${id}"]`).length === 0) f.push(`${file}: form field ${$(el).attr("name") ?? ""} has no label.`);
      });
      $("a").each((_, el) => { if (!$(el).text().trim() && !$(el).attr("aria-label")) f.push(`${file}: link with no text.`); });
      if ($("a.skip").length === 0) w.push(`${file}: no skip link.`);
    }
    const c = spec.theme.colors;
    const pairs: [string, string, string][] = [["body text", c.text, c.background], ["muted text", c.muted, c.background], ["button text", "#ffffff", c.primary], ["card text", c.text, c.surface]];
    for (const [name, fg, bg] of pairs) {
      const r = contrastRatio(fg, bg);
      if (r < 4.5) f.push(`Colour contrast for ${name} is ${r.toFixed(2)}:1 (WCAG AA needs 4.5:1).`);
    }
    add("accessibility", "Accessibility", f, w);
  }

  // 5. Security
  {
    const f: string[] = [];
    for (const { file, $ } of docs) {
      $("script").each((_, el) => {
        const src = $(el).attr("src");
        const type = $(el).attr("type");
        if (src && resolveSitePath(file, src) !== "script.js") f.push(`${file}: unexpected script ${src}.`);
        if (!src && type !== "application/ld+json") f.push(`${file}: inline script.`);
      });
      $("*").each((_, el) => {
        for (const attr of Object.keys((el as { attribs?: Record<string, string> }).attribs ?? {})) {
          if (/^on/i.test(attr)) f.push(`${file}: inline event handler ${attr}.`);
        }
      });
      if ($("iframe, object, embed").length) f.push(`${file}: embedded frame or object.`);
      $("form").each((_, el) => { const a = $(el).attr("action"); if (a && !/^[\w./-]*$/.test(a)) f.push(`${file}: form posts to ${a}.`); });
    }
    const headers = asText(files["_headers"]) ?? "";
    if (!/Content-Security-Policy/.test(headers)) f.push("No Content-Security-Policy header.");
    if (!/X-Robots-Tag: noindex/.test(headers)) f.push("Concept is not marked noindex.");
    add("security", "Security", f);
  }

  // 6. Forms
  {
    const f: string[] = [];
    let forms = 0;
    for (const { file, $ } of docs) {
      $("form").each((_, el) => {
        forms++;
        const form = $(el);
        if (!form.is("[data-concept-form]") && !form.attr("action")) f.push(`${file}: form has no handler.`);
        if (form.find('button[type="submit"], input[type="submit"]').length === 0) f.push(`${file}: form has no submit button.`);
        if (form.find("[required]").length === 0) f.push(`${file}: form has no required fields.`);
        form.find('input[name="email"]').each((_, i) => { if ($(i).attr("type") !== "email") f.push(`${file}: email field is not type=email.`); });
        if (!form.find('[role="status"]').length) f.push(`${file}: form has no status message region.`);
      });
    }
    if (forms === 0) f.push("No enquiry or booking form on any page.");
    add("forms", "Form functionality", f);
  }

  // 7. SEO metadata
  {
    const f: string[] = [];
    const w: string[] = [];
    const titles = new Set<string>();
    for (const { file, $ } of docs) {
      const title = $("title").text().trim();
      const desc = $('meta[name="description"]').attr("content") ?? "";
      if (!title) f.push(`${file}: missing title.`);
      else if (titles.has(title)) w.push(`${file}: duplicate title "${title}".`);
      titles.add(title);
      if (title.length > 65) w.push(`${file}: title longer than 65 characters.`);
      if (!desc) f.push(`${file}: missing meta description.`);
      else if (desc.length > 160) w.push(`${file}: meta description longer than 160 characters.`);
      if (!$('meta[property="og:title"]').length) w.push(`${file}: no Open Graph title.`);
    }
    add("seo", "SEO metadata", f, w);
  }

  // 8. Honesty: concept disclosure, verified data only, no fabricated claims
  {
    const f: string[] = [];
    const verifiedPhones = new Set([ctx.verified.phone].filter(Boolean).map((p) => p!.replace(/[^\d+]/g, "")));
    const verifiedEmails = new Set([ctx.verified.email].filter(Boolean).map((e) => e!.toLowerCase()));
    for (const { file, $ } of docs) {
      if (!$(".concept-bar").text().includes("not been commissioned or endorsed")) f.push(`${file}: concept disclaimer missing.`);
      const $c = cheerio.load($.html().replace(/></g, "> <"));
      $c(".concept-bar, .footer-legal, script, style").remove();
      const text = $c("body").text().replace(/\s+/g, " ");
      for (const [re, label] of CLAIM_PATTERNS) {
        const m = text.match(re);
        if (m) f.push(`${file}: possible unverified ${label}: "${m[0]}".`);
      }
      for (const m of text.match(PHONE_RE) ?? []) {
        const digits = m.replace(/[^\d+]/g, "");
        if (digits.replace(/\D/g, "").length >= 8 && !verifiedPhones.has(digits)) f.push(`${file}: phone number "${m.trim()}" is not the verified number.`);
      }
      for (const m of text.match(EMAIL_RE) ?? []) if (!verifiedEmails.has(m.toLowerCase())) f.push(`${file}: email "${m}" is not the verified address.`);
    }
    add("honesty", "Verified information and concept disclosure", [...new Set(f)]);
  }

  return { passed: !checks.some((c) => c.status === "fail"), checks, ranAt: new Date().toISOString() };
}
