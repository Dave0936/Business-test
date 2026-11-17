import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { resolveSitePath } from "@/lib/qa/checks";
import type { SiteFiles } from "./spec";

/**
 * For the in-app preview only: put a page's own stylesheets, scripts and font files inside the
 * page, so the sandboxed preview frame has nothing to fetch for them. Browsers differ in how
 * they treat requests from a sandboxed (opaque-origin) frame; inlining avoids all of that.
 * Images up to 600 KB are inlined as well.
 * Published sites keep their separate files.
 */

const MIME: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", gif: "image/gif" };
const MAX_INLINE_ASSET = 600_000; // bytes; larger files stay as links

function asText(f: SiteFiles[string] | undefined): string | null {
  return typeof f === "string" ? f : null;
}

/** A local binary file (font or image) as a data: URL, or null if it is missing, unknown or too big. */
function dataUrl(fromPath: string, ref: string, files: SiteFiles): string | null {
  if (/^(data:|https?:|#|mailto:|tel:)/i.test(ref)) return null;
  const target = resolveSitePath(fromPath, ref);
  const f = target ? files[target] : undefined;
  if (!f || typeof f === "string") return null;
  const ext = target!.split(".").pop()!.toLowerCase();
  // The stored type wins: photos can be re-encoded (e.g. to WebP) under their original name.
  const mime = f.contentType || MIME[ext];
  if (!mime || !/^(image|font)\//.test(mime) || f.base64.length * 0.75 > MAX_INLINE_ASSET) return null;
  return `data:${mime};base64,${f.base64}`;
}

/** Turn url(...) references to small local files (fonts, images) into data: URLs, relative to fromPath. */
function inlineCssUrls(css: string, fromPath: string, files: SiteFiles): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q, ref: string) => {
    const d = dataUrl(fromPath, ref.trim(), files);
    return d ? `url("${d}")` : whole;
  });
}

export interface InlinedPage {
  html: string;
  /** CSP hashes for the scripts now inside the page. */
  scriptHashes: string[];
}

export function inlinePageAssets(pagePath: string, files: SiteFiles): InlinedPage {
  const html = asText(files[pagePath]) ?? "";
  const $ = cheerio.load(html);
  const scriptHashes: string[] = [];

  $('link[rel~="stylesheet"][href]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/^https?:/i.test(href)) return;
    const target = resolveSitePath(pagePath, href);
    const css = target ? asText(files[target]) : null;
    if (css === null) return;
    $(el).replaceWith(`<style>${inlineCssUrls(css, target!, files).replace(/<\/style/gi, "<\\/style")}</style>`);
  });

  $("script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (/^https?:/i.test(src)) return;
    const target = resolveSitePath(pagePath, src);
    const js = target ? asText(files[target]) : null;
    if (js === null) return;
    const body = js.replace(/<\/script/gi, "<\\/script");
    scriptHashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
    $(el).replaceWith(`<script>${body}</script>`);
  });

  // Images too: some browsers will not load a sandboxed frame's images from the app.
  $("img[src], source[src], link[rel~='icon'][href]").each((_, el) => {
    const attr = el.tagName === "link" ? "href" : "src";
    const d = dataUrl(pagePath, $(el).attr(attr) ?? "", files);
    if (d) $(el).attr(attr, d);
  });
  $("img[srcset], source[srcset]").each((_, el) => {
    const set = ($(el).attr("srcset") ?? "").split(",").map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      const d = u ? dataUrl(pagePath, u, files) : null;
      return d ? [d, ...rest].join(" ") : part.trim();
    });
    $(el).attr("srcset", set.join(", "));
  });
  $("[style*='url(']").each((_, el) => {
    $(el).attr("style", inlineCssUrls($(el).attr("style") ?? "", pagePath, files));
  });
  $("style").each((_, el) => {
    const css = $(el).html() ?? "";
    if (css.includes("url(")) $(el).text(inlineCssUrls(css, pagePath, files));
  });

  // "defer" has no effect on inline scripts, and in <head> they would run before the page
  // exists: move them to the end of <body>, where deferred scripts would have run.
  $("head > script:not([type='application/ld+json'])").each((_, el) => {
    if (!$(el).attr("src")) $("body").append($(el));
  });

  return { html: $.html(), scriptHashes };
}

/** Content Security Policy for an inlined preview page: only its own inline scripts may run. */
export function inlinePreviewCsp(origin: string, scriptHashes: string[]): string {
  const o = /^https?:\/\/[a-z0-9.:-]+$/i.test(origin) ? `${origin} 'self'` : "'self'";
  const scripts = scriptHashes.length ? scriptHashes.join(" ") : "'none'";
  return [
    "default-src 'none'",
    `img-src ${o} https://images.unsplash.com data:`,
    `style-src 'unsafe-inline' ${o} https://fonts.googleapis.com`,
    `font-src data: ${o} https://fonts.gstatic.com`,
    `script-src ${scripts}`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-forms",
  ].join("; ");
}
