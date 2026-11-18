import type { SiteFiles } from "./spec";

/**
 * Animation libraries a prototype may use (MIT licensed, bundled with the site so pages never
 * load scripts from elsewhere). The builder links them; they are added only when referenced.
 */
export const VENDOR_FILES: Record<string, string> = {
  "vendor/motion.js": "text/javascript; charset=utf-8",
  "vendor/lenis.min.js": "text/javascript; charset=utf-8",
  "vendor/lenis.css": "text/css; charset=utf-8",
};

/** Vendor files that any page links (src or href, including from a language folder). */
export function referencedVendor(files: SiteFiles): string[] {
  const html = Object.entries(files).filter(([p, c]) => p.endsWith(".html") && typeof c === "string").map(([, c]) => c as string).join("\n");
  return Object.keys(VENDOR_FILES).filter((v) => new RegExp(`(?:src|href)=["'](?:\\.\\./)*${v.replace(/[.]/g, "\\.")}["']`).test(html));
}
