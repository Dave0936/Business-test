import "server-only";
import type { SiteFiles } from "@/lib/sites/spec";
import type { QaContext } from "./checks";

/**
 * Real-browser rendering check (QA_BROWSER=true). Runs the generated site from
 * memory inside Chromium with network access limited to the approved font/image
 * hosts, at 375px and 1280px widths. The generated code never runs on our server
 * outside this sandboxed browser.
 */
export async function browserQa(files: SiteFiles): Promise<NonNullable<QaContext["browser"]>> {
  if (process.env.QA_BROWSER !== "true") return { ran: false, pages: [] };
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    return { ran: false, pages: [], error: "Playwright is not installed" };
  }
  const browser = await playwright.chromium.launch();
  const origin = "https://prototype.local";
  try {
    const pages: NonNullable<QaContext["browser"]>["pages"] = [];
    for (const [width, isMobile] of [[375, true], [1280, false]] as const) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile, hasTouch: isMobile });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) {
          const key = decodeURIComponent(url.pathname.replace(/^\//, "")) || "index.html";
          const f = files[key];
          if (f === undefined) return route.fulfill({ status: 404, body: "not found" });
          const type = key.endsWith(".html") ? "text/html" : key.endsWith(".css") ? "text/css" : key.endsWith(".js") ? "text/javascript" : key.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
          return route.fulfill({ status: 200, contentType: typeof f === "string" ? type : f.contentType, body: typeof f === "string" ? f : Buffer.from(f.base64, "base64") });
        }
        if (/^(fonts\.googleapis\.com|fonts\.gstatic\.com|images\.unsplash\.com)$/.test(url.hostname)) return route.continue();
        return route.abort("blockedbyclient");
      });
      for (const file of Object.keys(files).filter((f) => f.endsWith(".html"))) {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
        await page.goto(`${origin}/${file}`, { waitUntil: "load", timeout: 20_000 }).catch((e) => errors.push(String(e)));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2).catch(() => false);
        const existing = pages.find((p) => p.file === file);
        if (existing) {
          if (isMobile) existing.mobileOverflow = overflow; else existing.desktopOverflow = overflow;
          existing.consoleErrors.push(...errors);
        } else {
          pages.push({ file, mobileOverflow: isMobile ? overflow : false, desktopOverflow: isMobile ? false : overflow, consoleErrors: errors });
        }
        await page.close();
      }
      await context.close();
    }
    return { ran: true, pages };
  } catch (e) {
    return { ran: false, pages: [], error: (e as Error).message };
  } finally {
    await browser.close();
  }
}
