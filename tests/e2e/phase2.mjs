// Phase 2 end-to-end acceptance test: discovery, de-duplication, CRM, export, integrations, roles.
// Usage: E2E_BASE_URL=http://localhost:3000 E2E_OWNER_EMAIL=... E2E_STAFF_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase2.mjs [screenshotDir]
// The owner must already have a workspace (run phase1.mjs first); the staff account must be staff in it.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OWNER = process.env.E2E_OWNER_EMAIL;
const STAFF = process.env.E2E_STAFF_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  await page.waitForLoadState("networkidle");
}

async function leadCount(page, qs = "") {
  await page.goto(`${BASE}/leads${qs}`);
  const text = await page.locator("main p").first().textContent();
  return Number(text?.match(/(\d+) businesses/)?.[1] ?? NaN);
}

async function waitForRun(page, url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.goto(url);
    // The run's own status badge sits in the page description, not the jobs table.
    const status = (await page.locator("main h1 + p").first().textContent()) ?? "";
    if (/Succeeded|Failed/.test(status)) return status;
    if (Date.now() > deadline) return status;
    await page.waitForTimeout(3000);
  }
}

const stat = async (page, label) => Number((await page.locator(`dt:text-is("${label}") + dd`).first().textContent().catch(() => "NaN"))?.trim());

async function runSearch(page, town) {
  await page.goto(`${BASE}/opportunities`);
  await page.selectOption("#provider", "demo");
  await page.selectOption("#countryCode", "GB");
  await page.fill("#town", town.slice(0, 5));
  await page.waitForSelector(`#town-list button:has-text("${town}")`, { timeout: 10000 });
  await page.click(`#town-list button:has-text("${town}")`);
  await page.uncheck('input[name="generate"]').catch(() => undefined);
  await Promise.all([page.waitForURL(/\/automation\/runs\//, { timeout: 30000 }), page.click("button:has-text('Start search')")]);
  return page.url();
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, OWNER);

  // Town search (GeoNames)
  const towns = await (await page.request.get(`${BASE}/api/places/towns?country=GB&q=Inverness`)).json();
  check("GeoNames town search finds Inverness", towns.towns?.[0]?.name === "Inverness", JSON.stringify(towns.towns?.[0] ?? {}));

  // A town not used by earlier runs, so this search finds new businesses.
  const pool = (await (await page.request.get(`${BASE}/api/places/towns?country=GB&q=&limit=50`)).json()).towns.map((t) => t.name).filter((n) => !/^(London|Edinburgh|Manchester|Inverness)$/.test(n));
  const town = pool[Math.floor(Date.now() / 1000) % pool.length];
  const before = await leadCount(page);

  // 1. Search through the UI; jobs run under the owner's own session
  const runUrl = await runSearch(page, town);
  check("search starts and opens its run page", /\/automation\/runs\//.test(runUrl));
  const status1 = await waitForRun(page, runUrl);
  const created = await stat(page, "New businesses");
  const audited = await stat(page, "Audited");
  check("run finishes", /Succeeded/.test(status1), status1.slice(0, 80));
  check("run discovered new businesses", created > 0, `new=${created}`);
  check("run audited and scored them", audited > 0, `audited=${audited}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/run.png`, fullPage: true });
  const after1 = await leadCount(page);
  check("leads list grew by the new businesses", after1 - before === created, `${before} → ${after1}`);

  // 2. Re-run the same search: no duplicates
  const runUrl2 = await runSearch(page, town);
  await waitForRun(page, runUrl2);
  const created2 = await stat(page, "New businesses");
  const merged2 = await stat(page, "Duplicates merged");
  check("re-running the same search creates no duplicates", created2 === 0 && merged2 > 0, `new=${created2} merged=${merged2}`);
  check("lead count unchanged after re-run", (await leadCount(page)) === after1);

  // 3. Manual add of an existing business merges instead of duplicating
  // The demo provider's first restaurant in any town is "[Demo] Olive & Ash Kitchen".
  const existingName = "[Demo] Olive & Ash Kitchen";
  await page.goto(`${BASE}/opportunities`);
  await page.fill("#m-name", existingName);
  await page.selectOption("#m-country", "GB");
  await page.fill("#m-city", town);
  await page.fill("#m-src", "https://example.com/listing");
  await page.locator("form:has(#m-name) button[type=submit]").click();
  const merged = await page.waitForSelector("text=already exists", { timeout: 20000 }).then(() => true).catch(() => false);
  // (merges with the demo restaurant created in Inverness by an earlier run, or in this run's town)
  check("manually adding an existing business merges it", merged);

  // 4. CSV import of a licensed list (one new, one duplicate, one invalid)
  const stamp = Date.now().toString(36);
  const bakery = `Phase Two Test Bakery ${stamp}`;
  const csv = `name,country_code,city,website,email,phone,category,source_url\n${bakery},GB,Perth,https://bakery-${stamp}.co.uk,hello@bakery-${stamp}.co.uk,,Bakery,https://example.com/dir/1\n${existingName},GB,${town},,,,,https://example.com/dir/2\nBad Row,XYZ,,,,,,\n`;
  const csvPath = "/tmp/claude-0/-home-user/c2e9f2e9-969e-5a2a-8a07-965ba1e35aee/scratchpad/import.csv";
  fs.writeFileSync(csvPath, csv);
  await page.goto(`${BASE}/opportunities`);
  await page.setInputFiles('input[name="file"]', csvPath);
  await page.fill("#licence", "E2E test list");
  await page.check('input[name="attest"]');
  await page.locator("form:has(input[name=file]) button[type=submit]").click();
  const importMsg = await page.waitForSelector("text=/Imported \\d+ new/", { timeout: 30000 }).then((e) => e.textContent()).catch(() => "");
  check("CSV import adds new rows, merges duplicates, rejects invalid rows", /Imported 1 new, merged 1 duplicates, 1 rows rejected/.test(importMsg ?? ""), importMsg ?? "");

  // 5. CSV export (as the user, RLS-scoped, formula-safe)
  const exp = await page.request.get(`${BASE}/api/export/leads`);
  const body = await exp.text();
  check("CSV export downloads every lead with attribution", exp.ok() && body.split("\r\n").length - 1 === (await leadCount(page)) && body.includes("attribution"), `${body.split("\r\n").length - 1} rows`);

  // 6. CRM: follow-up reminder and pipeline move
  await page.goto(`${BASE}/leads?q=${encodeURIComponent(bakery)}`);
  await page.locator("table a[href^='/leads/']").first().click();
  await page.waitForLoadState("networkidle");
  const leadUrl = page.url();
  const today = new Date().toISOString().slice(0, 10);
  await page.fill("#follow_up_at", today);
  await page.selectOption("#status", "qualified");
  await page.locator("form:has(#status) button[type=submit]").click();
  await page.waitForSelector("text=Saved.", { timeout: 20000 });
  await page.goto(`${BASE}/crm`);
  check("follow-up shows as due in the CRM", await page.locator(`text=${bakery}`).first().isVisible());
  await page.locator(`li:has-text('${bakery}') button:has-text('Done, again in 7 days')`).first().click();
  // Rescheduled 7 days out, the lead leaves the "due" list.
  await page.locator(`div.rounded-xl:has(h3:has-text('Follow-ups due')) >> text=${bakery}`).waitFor({ state: "detached", timeout: 20000 });
  await page.locator(`section:has(h2:has-text('Qualified')) li:has-text('${bakery}') button:has-text('Move to')`).click();
  // The card moves to the Prototype column.
  await page.locator(`section:has(h2:has-text('Prototype')) li:has-text('${bakery}')`).waitFor({ timeout: 20000 });
  await page.goto(leadUrl);
  const history = (await page.locator("ol").textContent()) ?? "";
  check("CRM moves and follow-ups appear in the lead's history", /Status changed from qualified to prototype generated/.test(history) && /Follow-up done/.test(history));
  if (SHOTS) { await page.goto(`${BASE}/crm`); await page.screenshot({ path: `${SHOTS}/crm.png` }); }

  // 7. Integrations: an unverifiable key is never saved; paid source stays unavailable
  await page.goto(`${BASE}/integrations`);
  const card = page.locator("div.rounded-xl:has(h3:has-text('SerpAPI'))");
  await card.locator("summary").click();
  await card.locator('input[name="apiKey"]').fill("not-a-real-key");
  await card.locator("button:has-text('Check and connect')").click();
  const refused = await card.locator("text=/Not saved:/").waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  check("an unverified SerpAPI key is refused and not stored", refused);
  await page.goto(`${BASE}/opportunities`);
  const serpDisabled = await page.locator('#provider option[value="serpapi"]').isDisabled();
  check("SerpAPI is offered only once connected", serpDisabled);
  check("no client-side errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();

  // 8. Staff: can search, cannot manage integrations
  const s = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await s.newPage();
  await signIn(sp, STAFF);
  await sp.goto(`${BASE}/integrations`);
  check("staff cannot connect integrations", (await sp.locator("text=Connect with your own key").count()) === 0);
  await sp.goto(`${BASE}/opportunities`);
  check("staff can start searches", await sp.locator("button:has-text('Start search')").count() === 1);
  await s.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
