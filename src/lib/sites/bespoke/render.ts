import "server-only";
import type { Browser } from "playwright";
import type { SiteFiles } from "@/lib/sites/spec";
import { launchChromium } from "@/lib/qa/chromium";

/**
 * Screenshots of a draft page for the builder to look at its own work. The draft runs inside
 * Chromium from memory: the only outside requests allowed are images from images.unsplash.com
 * (the photo list the build was given). Nothing is written anywhere.
 */

export type Device = "desktop" | "phone";
const VIEWPORT: Record<Device, { width: number; height: number; mobile: boolean }> = {
  desktop: { width: 1280, height: 800, mobile: false },
  phone: { width: 390, height: 844, mobile: true },
};
const MAX_HEIGHT: Record<Device, number> = { desktop: 4800, phone: 6400 };
// Sent to Claude at this width: enough to judge design, small enough to keep builds cheap.
const OUT_WIDTH: Record<Device, number> = { desktop: 800, phone: 390 };
const ORIGIN = "https://draft.local";

const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", svg: "image/svg+xml", woff2: "font/woff2" };

export interface RenderResult {
  jpegBase64?: string;
  note: string;
  error?: string;
}

export class DraftRenderer {
  private browser: Browser | null = null;
  private failed: string | null = null;

  async render(files: SiteFiles, path: string, device: Device): Promise<RenderResult> {
    if (this.failed) return { note: "", error: this.failed };
    if (!this.browser) {
      const r = await launchChromium();
      if (!r.browser) {
        this.failed = `Page rendering is not available here (${r.error ?? "no browser"}). Continue without it.`;
        return { note: "", error: this.failed };
      }
      this.browser = r.browser;
    }
    const vp = VIEWPORT[device];
    const context = await this.browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1, reducedMotion: "reduce" });
    try {
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGIN) {
          const key = decodeURIComponent(url.pathname.replace(/^\//, "")) || "index.html";
          const f = files[key] ?? files[`${key}/index.html`];
          if (f === undefined) return route.fulfill({ status: 404, body: "not found" });
          const ext = key.split(".").pop() ?? "";
          return route.fulfill({ status: 200, contentType: typeof f === "string" ? TYPES[ext] ?? "text/plain" : f.contentType, body: typeof f === "string" ? f : Buffer.from(f.base64, "base64") });
        }
        if (url.hostname === "images.unsplash.com") return route.continue();
        return route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${ORIGIN}/${path}`, { waitUntil: "load", timeout: 20_000 });
      // Let fonts and late images settle; reveal-on-scroll content is shown (reduced motion).
      await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
      await page.waitForTimeout(400);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      const clipHeight = Math.min(height, MAX_HEIGHT[device]);
      const png = await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: vp.width, height: clipHeight }, type: "png" });
      const sharp = (await import("sharp")).default;
      const jpeg = await sharp(png).resize({ width: OUT_WIDTH[device] }).jpeg({ quality: 62, mozjpeg: true }).toBuffer();
      const notes = [
        `${path} on ${device} (${vp.width}px wide), full page${height > clipHeight ? ` (first ${clipHeight}px of ${height}px shown)` : ""}, scaled to ${OUT_WIDTH[device]}px wide. Motion is shown as for visitors who prefer reduced motion.`,
        overflow ? "Problem: the page scrolls sideways at this width." : "",
        errors.length ? `Script errors: ${errors.slice(0, 3).join(" | ")}` : "",
      ].filter(Boolean);
      return { jpegBase64: jpeg.toString("base64"), note: notes.join("\n") };
    } catch (e) {
      return { note: "", error: `Could not render ${path}: ${(e as Error).message.slice(0, 200)}` };
    } finally {
      await context.close();
    }
  }

  async close() {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
