import "server-only";
import { promises as dns } from "node:dns";
import { assertSafeUrl, isPublicAddress } from "@/lib/security/safe-fetch";

/**
 * Optional real-browser mobile check (AUDIT_BROWSER=true, needs Playwright + Chromium).
 * Every request the page makes is intercepted and blocked unless it targets a public
 * address, so a hostile page cannot use the browser to reach internal services.
 * JavaScript runs in Chromium's sandbox with no cookies or stored state.
 */
export async function mobileRenderCheck(url: string): Promise<{ checked: boolean; horizontalOverflow?: boolean; viewportWidth?: number; contentWidth?: number; screenshotBase64?: string; error?: string }> {
  if (process.env.AUDIT_BROWSER !== "true") return { checked: false };
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    return { checked: false, error: "Playwright not installed" };
  }
  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, javaScriptEnabled: true });
    await context.route("**/*", async (route) => {
      try {
        const u = assertSafeUrl(route.request().url());
        const addrs = await dns.lookup(u.hostname, { all: true });
        if (addrs.length === 0 || addrs.some((a) => !isPublicAddress(a.address))) return route.abort("blockedbyclient");
        return route.continue();
      } catch {
        return route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 20_000 });
    const dims = await page.evaluate(() => ({ vw: window.innerWidth, sw: document.documentElement.scrollWidth }));
    const shot = await page.screenshot({ type: "jpeg", quality: 60 });
    return { checked: true, viewportWidth: dims.vw, contentWidth: dims.sw, horizontalOverflow: dims.sw > dims.vw + 4, screenshotBase64: shot.toString("base64") };
  } catch (e) {
    return { checked: false, error: (e as Error).message };
  } finally {
    await browser.close();
  }
}
