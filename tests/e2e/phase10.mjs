// Phase 10 end-to-end acceptance test: the analytics page and its CSV exports, the app's security
// headers (and the separate, stricter policy on site previews), and that no page in the app
// breaks under the Content Security Policy.
// Usage: E2E_BASE_URL=... E2E_OWNER_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase10.mjs [screenshotDir]
import { chromium, request as pwRequest } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const PAGES = ["/overview", "/opportunities", "/leads", "/leads/bin", "/audits", "/design-research", "/builder", "/approvals", "/deployments", "/emails", "/crm", "/analytics", "/automation", "/integrations", "/settings"];

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const violations = [];
  const errors = [];
  page.on("console", (m) => { if (/Content.Security.Policy|Refused to/i.test(m.text())) violations.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 140)}`); });
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", process.env.E2E_OWNER_EMAIL);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);

  // Analytics
  await page.goto(`${BASE}/analytics`);
  check("pipeline lists every step", (await page.locator('[data-testid="funnel"] li').count()) === 8);
  for (const d of ["country_code", "industry_id", "opportunity_type"]) check(`breakdown by ${d} has rows`, (await page.locator(`[data-testid="breakdown-${d}"] tbody tr`).count()) >= 1);
  check("email and value summaries shown", (await page.locator('[data-testid="email-stats"]').count()) === 1 && (await page.locator('[data-testid="value"]').count()) === 1);
  check("costs table covers six months", (await page.locator('[data-testid="costs"] thead th').count()) === 7);
  const pct = ((await page.locator('[data-testid="funnel"]').textContent()) ?? "").match(/(\d+)%/g) ?? [];
  check("no step shows more than 100%", pct.every((p) => Number(p.replace("%", "")) <= 100), pct.join(" "));
  await page.goto(`${BASE}/analytics?country=GB`);
  check("filters apply (country)", (await page.locator('[data-testid="breakdown-country_code"] tbody tr').count()) === 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p10-analytics.png`, fullPage: true });

  const csv = await page.request.get(`${BASE}/api/export/breakdown?dimension=country_code`);
  const body = await csv.text();
  check("breakdown CSV downloads", csv.status() === 200 && /text\/csv/.test(csv.headers()["content-type"] ?? "") && body.includes("country_code,leads,qualified"), `${csv.status()}`);
  const bad = await page.request.get(`${BASE}/api/export/breakdown?dimension=password`);
  check("unknown breakdowns are refused", bad.status() === 400);
  const costs = await page.request.get(`${BASE}/api/export/costs`);
  check("costs CSV downloads", costs.status() === 200 && (await costs.text()).includes("month,provider,operation,cost_usd"));

  // Security headers
  const res = await page.request.get(`${BASE}/overview`);
  const h = res.headers();
  check("app pages send a Content Security Policy", /default-src 'self'/.test(h["content-security-policy"] ?? "") && /object-src 'none'/.test(h["content-security-policy"] ?? "") && /frame-ancestors 'self'/.test(h["content-security-policy"] ?? ""));
  check("standard security headers present", h["x-content-type-options"] === "nosniff" && h["x-frame-options"] === "SAMEORIGIN" && /max-age=/.test(h["strict-transport-security"] ?? "") && !h["x-powered-by"]);
  await page.goto(`${BASE}/builder`);
  const site = await page.locator("main a[href^='/builder/']").first().getAttribute("href");
  await page.goto(`${BASE}${site}`);
  const src = await page.locator('[data-testid="preview"]').getAttribute("src");
  const prev = await page.request.get(`${BASE}${src}`);
  const pcsp = prev.headers()["content-security-policy"] ?? "";
  check("previews keep their own sandboxing policy only", /sandbox allow-scripts allow-forms/.test(pcsp) && !/default-src 'self'; script-src 'self' 'unsafe-inline'/.test(pcsp));

  // Every page loads without policy violations or errors.
  for (const path of PAGES) {
    const r = await page.goto(`${BASE}${path}`);
    if (r.status() >= 400) errors.push(`${path}: HTTP ${r.status()}`);
  }
  await page.waitForTimeout(500);
  check("no Content Security Policy violations on any page", violations.length === 0, violations.slice(0, 3).join(" | "));
  check("no client-side errors on any page", errors.length === 0, errors.slice(0, 3).join(" | "));

  const anon = await pwRequest.newContext();
  const a = await anon.get(`${BASE}/api/export/breakdown?dimension=country_code`, { maxRedirects: 0 });
  check("exports need sign-in", [401, 302, 307].includes(a.status()), `${a.status()}`);
  await anon.dispose();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
