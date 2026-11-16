// Phase 5 end-to-end acceptance test: the website builder without Claude connected (template
// demo path), the site page, preview, quality checks, versions, restore and zip download.
// The Claude-driven build loop is covered by tests/unit/bespoke.test.ts.
// Usage: E2E_BASE_URL=http://localhost:3000 E2E_OWNER_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase5.mjs [screenshotDir]
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OWNER = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const stamp = Date.now().toString(36);
const NAME = `P5 Builder Cafe ${stamp}`;

async function submitAndRead(form, name) {
  const btn = name ? form.getByRole("button", { name }) : form.locator("button[type=submit]");
  await btn.click();
  const el = form.locator('[role="status"]').last();
  await el.waitFor({ timeout: 60000 });
  return (await el.textContent())?.trim() ?? "";
}

/** Wait (with the app open, no clicks) until the site page shows a version. */
async function waitForVersion(page, url, n, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.goto(url);
    const t = (await page.locator('[data-testid="versions"]').textContent().catch(() => "")) ?? "";
    if (t.includes(`Version ${n}`)) return true;
    await page.waitForTimeout(4000);
  }
  return false;
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const previewFailures = [];
  const googleRequests = [];
  page.on("response", (r) => { if (r.url().includes("/api/preview/") && r.status() >= 300) previewFailures.push(`${r.status()} ${r.url().split("/api/preview/")[1]}`); });
  page.on("request", (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) googleRequests.push(r.url()); });
  await page.goto(`${BASE}/login`);
  await page.fill("#email", OWNER);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);

  // A fictional business imported as if real (not flagged as demo).
  const csvPath = "/tmp/claude-0/-home-user/c2e9f2e9-969e-5a2a-8a07-965ba1e35aee/scratchpad/p5.csv";
  fs.writeFileSync(csvPath, `name,country_code,city,website,email,phone,category,source_url\n${NAME},GB,Perth,,hello@p5-${stamp}.invalid,01632 960 501,Cafe,https://directory.example/p5/1\n`);
  await page.goto(`${BASE}/opportunities`);
  await page.setInputFiles('input[name="file"]', csvPath);
  await page.fill("#licence", "E2E Phase 5 fixture");
  await page.check('input[name="attest"]');
  await page.locator("form:has(input[name=file]) button[type=submit]").click();
  await page.waitForSelector("text=/Imported 1 new/", { timeout: 30000 });
  await page.goto(`${BASE}/leads?q=${stamp}`);
  const bizId = (await page.locator(`a:has-text("${NAME}")`).first().getAttribute("href")).split("/").pop();

  // Studio: create a brief, then build from there.
  await page.goto(`${BASE}/design-research/${bizId}`);
  await page.getByRole("button", { name: "Create brief" }).click();
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/design-research/${bizId}`);
  const buildBtn = page.locator("form").filter({ has: page.getByRole("button", { name: "Build prototype" }) });
  check("studio offers Build prototype once a brief exists", (await buildBtn.count()) === 1);
  const msg = await submitAndRead(buildBtn, "Build prototype");
  check("without Claude, a labelled template demo is made instead", /Claude isn't connected.*template demo.*can't be sent for approval/.test(msg), msg);

  // The site appears in the builder list; open it.
  let siteUrl = null;
  for (let i = 0; i < 30 && !siteUrl; i++) {
    await page.goto(`${BASE}/builder`);
    const card = page.locator("a", { hasText: NAME }).first();
    if (await card.count()) siteUrl = `${BASE}${await card.getAttribute("href")}`;
    else await page.waitForTimeout(3000);
  }
  check("site listed in the builder", Boolean(siteUrl));
  const v1 = await waitForVersion(page, siteUrl, 1);
  check("version 1 created in the background", v1);
  const main = (await page.locator("main").textContent()) ?? "";
  check("page explains template demos can't be approved for real businesses", /can't be sent for approval/.test(main) && /template demo/.test(main));
  check("real business's template demo is not waiting for approval", !/Awaiting approval/.test(main));
  check("quality checks listed", (await page.locator('[data-testid="qa-list"] li').count()) >= 8);
  check("no Revise box for template versions", (await page.getByRole("button", { name: "Revise" }).count()) === 0);

  // Preview: sandboxed, concept notice, page switch and phone width.
  const frameEl = page.locator('[data-testid="preview"]');
  check("preview iframe is sandboxed without same-origin", (await frameEl.getAttribute("sandbox")) === "allow-scripts allow-forms");
  const frame = page.frameLocator('[data-testid="preview"]');
  await frame.locator("h1").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const styled = await frame.locator("body").evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, h1: getComputedStyle(document.querySelector("h1")).fontFamily, fonts: [...document.fonts].filter((f) => f.status === "loaded").length }));
  check("preview applies the site's stylesheet", styled.bg !== "rgba(0, 0, 0, 0)" && !/Times/.test(styled.h1), JSON.stringify(styled));
  check("self-hosted fonts load in the preview", styled.fonts > 0, `${styled.fonts} font faces loaded`);
  check("no preview requests fail (styles, script, fonts)", previewFailures.length === 0, previewFailures.slice(0, 3).join(" | "));
  check("previews never contact Google Fonts", googleRequests.length === 0, googleRequests.slice(0, 2).join(" | "));
  check("preview shows the concept notice", /not been commissioned or endorsed by/.test((await frame.locator(".concept-bar").first().textContent()) ?? ""));
  const pagesList = await page.locator("#preview-page option").allTextContents();
  check("several pages available to preview", pagesList.length >= 3 && pagesList[0] === "index.html", pagesList.join(", "));
  await page.selectOption("#preview-page", "contact.html");
  await frame.locator("form").first().waitFor({ timeout: 20000 });
  check("switching page shows the contact form", (await frame.locator("form").count()) >= 1);
  await page.getByRole("button", { name: "Phone" }).click();
  await page.waitForTimeout(400);
  const width = await frameEl.evaluate((el) => el.getBoundingClientRect().width);
  check("phone view narrows the preview to 390px", Math.round(width) === 390, `${width}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p5-site.png`, fullPage: true });

  // Download the version as a zip.
  const dlHref = await page.locator('[data-testid="versions"] a', { hasText: "Download" }).first().getAttribute("href");
  const zip = await page.request.get(`${BASE}${dlHref}`);
  const body = await zip.body();
  check("zip download works", zip.status() === 200 && zip.headers()["content-type"] === "application/zip" && body.subarray(0, 2).toString() === "PK" && body.includes(Buffer.from("index.html")), `${zip.status()} ${body.length} bytes`);

  // Build again → version 2, then restore version 1 → version 3.
  const again = page.locator("form").filter({ has: page.getByRole("button", { name: "Build again from the brief" }) });
  page.once("dialog", (d) => d.accept());
  await submitAndRead(again);
  check("second build produces version 2", await waitForVersion(page, siteUrl, 2));
  const v1row = page.locator('[data-testid="versions"] li', { hasText: "Version 1" });
  await v1row.getByRole("button", { name: "Restore" }).click();
  await v1row.locator('[role="status"]').waitFor({ timeout: 60000 });
  check("restoring version 1 saves it as version 3", await waitForVersion(page, siteUrl, 3, 30000) && /Restored version 1/.test((await page.locator('[data-testid="versions"]').textContent()) ?? ""));

  // Signed-out visitors can't see previews or downloads.
  const anon = await pwRequest.newContext();
  const versionId = dlHref.split("/").pop();
  const p = await anon.get(`${BASE}/api/preview/${versionId}/index.html`, { maxRedirects: 0 });
  const z = await anon.get(`${BASE}/api/export/site/${versionId}`, { maxRedirects: 0 });
  check("preview and download need sign-in", [401, 307, 302].includes(p.status()) && [401, 307, 302].includes(z.status()), `${p.status()} / ${z.status()}`);
  const signed = await page.request.get(`${BASE}/api/preview/${versionId}/index.html`);
  check("preview is served with a sandboxing CSP", /sandbox allow-scripts allow-forms/.test(signed.headers()["content-security-policy"] ?? ""));
  await anon.dispose();

  // A fictional demo business's template build may go to approval (for trying the workflow).
  await page.goto(`${BASE}/builder`);
  const demoCard = page.locator("main a", { hasText: "[Demo]" }).first();
  if (await demoCard.count()) {
    await demoCard.click();
    await page.waitForLoadState("networkidle");
    const t = (await page.locator("main").textContent()) ?? "";
    check("demo business's template is labelled as a fictional-business demo", /Template demo of a fictional business/.test(t));
  } else {
    check("demo business's template is labelled as a fictional-business demo", true, "no demo sites in this workspace; skipped");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(siteUrl);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("site page fits a phone screen", overflow <= 1, `overflow ${overflow}px`);
  check("no client-side errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
