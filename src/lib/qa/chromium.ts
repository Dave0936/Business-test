import "server-only";
import type { Browser } from "playwright";

/**
 * Launch headless Chromium. On Vercel (no bundled browser) this uses @sparticuz/chromium's
 * serverless build; elsewhere Playwright's own browser. Returns null when no browser can start,
 * so callers can carry on without rendering.
 */
export async function launchChromium(): Promise<{ browser: Browser | null; error?: string }> {
  try {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      const [{ chromium }, sparticuz] = await Promise.all([import("playwright-core"), import("@sparticuz/chromium")]);
      const browser = await chromium.launch({ executablePath: await sparticuz.default.executablePath(), args: sparticuz.default.args, headless: true });
      return { browser: browser as unknown as Browser };
    }
    const { chromium } = await import("playwright");
    return { browser: await chromium.launch() };
  } catch (e) {
    return { browser: null, error: (e as Error).message };
  }
}
