// Phase 3 end-to-end acceptance test: website audits, transparent scoring, qualification,
// "no contact route" explanation, and queued work finishing while the app is open.
// Usage: E2E_BASE_URL=http://localhost:3000 E2E_OWNER_EMAIL=... E2E_PASSWORD=... \
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... node tests/e2e/phase3.mjs [screenshotDir]
// Uses fictional businesses only (.invalid domains and reserved 01632 9xx xxx numbers).
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OWNER = process.env.E2E_OWNER_EMAIL;
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

const stamp = Date.now().toString(36);
const NAMES = {
  phone: `P3 No Website With Phone ${stamp}`,
  none: `P3 No Contact Route ${stamp}`,
  dead: `P3 Unreachable Site ${stamp}`,
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, OWNER);

  // 1. Import three fictional businesses.
  const csv = [
    "name,country_code,city,website,email,phone,category,source_url",
    `${NAMES.phone},GB,Perth,,,01632 960 101,Bakery,https://directory.example/p3/1`,
    `${NAMES.none},GB,Perth,,,,Bakery,https://directory.example/p3/2`,
    `${NAMES.dead},GB,Perth,https://p3-${stamp}.invalid,,01632 960 103,Bakery,https://directory.example/p3/3`,
  ].join("\n");
  const csvPath = "/tmp/claude-0/-home-user/c2e9f2e9-969e-5a2a-8a07-965ba1e35aee/scratchpad/p3.csv";
  fs.writeFileSync(csvPath, csv + "\n");
  await page.goto(`${BASE}/opportunities`);
  await page.setInputFiles('input[name="file"]', csvPath);
  await page.fill("#licence", "E2E Phase 3 fixtures");
  await page.check('input[name="attest"]');
  await page.locator("form:has(input[name=file]) button[type=submit]").click();
  const importMsg = await page.waitForSelector("text=/Imported \\d+ new/", { timeout: 30000 }).then((e) => e.textContent()).catch(() => "");
  check("imported the three test businesses", /Imported 3 new/.test(importMsg ?? ""), importMsg ?? "");

  // 2. Bulk audit from the leads table.
  await page.goto(`${BASE}/leads?q=${encodeURIComponent(stamp)}`);
  const boxes = page.locator('input[name="businessId"]');
  check("leads table lists them", (await boxes.count()) === 3);
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await page.click("button:has-text('Audit & score')");
  const queuedMsg = await page.waitForSelector("text=/Queued audit for 3 businesses/", { timeout: 20000 }).then(() => true).catch(() => false);
  check("bulk audit queued", queuedMsg);

  // 3. Results appear (background slice after the action, then the in-app worker).
  const deadline = Date.now() + 120_000;
  let rowsText = "";
  while (Date.now() < deadline) {
    await page.goto(`${BASE}/leads?q=${encodeURIComponent(stamp)}`);
    rowsText = (await page.locator("tbody").textContent()) ?? "";
    if (!/New/.test(rowsText)) break;
    await page.waitForTimeout(3000);
  }
  const row = (name) => page.locator("tbody tr", { hasText: name });
  const rowText = async (name) => (await row(name).textContent()) ?? "";
  const phoneRow = await rowText(NAMES.phone);
  const noneRow = await rowText(NAMES.none);
  const deadRow = await rowText(NAMES.dead);
  check("no website + phone: score 91, qualified", /91/.test(phoneRow) && /Qualified/.test(phoneRow) && !/Not qualified/.test(phoneRow), phoneRow.replace(/\s+/g, " ").slice(0, 160));
  check("no website, no contact: high score but not qualified", /91/.test(noneRow) && /Not qualified/.test(noneRow), noneRow.replace(/\s+/g, " ").slice(0, 160));
  check("leads table explains why", /No contact route found/.test(noneRow) && !/No contact route found/.test(phoneRow));
  check("unreachable website scored as no working website", /No website/.test(deadRow) && /Qualified/.test(deadRow), deadRow.replace(/\s+/g, " ").slice(0, 160));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-leads.png`, fullPage: true });

  // 4. Lead detail shows the explained breakdown and the callout.
  await row(NAMES.none).locator("a").first().click();
  await page.waitForLoadState("networkidle");
  const detail = (await page.locator("main").textContent()) ?? "";
  check("lead detail shows the no-contact callout", /Not qualified: no contact route found\./.test(detail) && /The score is high enough, but/.test(detail));
  check("every criterion is labelled observed", (await page.locator("main >> text=Observed").count()) >= 2);
  check("weights version shown", /Weights version 2026-11-v2/.test(detail));

  // 5. Audit page for the unreachable site records the error as an observed fact.
  await page.goto(`${BASE}/audits`);
  await page.locator("a", { hasText: NAMES.dead }).first().click();
  await page.waitForLoadState("networkidle");
  const audit = (await page.locator("main").textContent()) ?? "";
  check("audit page shows the fetch failure", /Reachable/.test(audit) && /(ENOTFOUND|EAI_AGAIN|resolve|fetch failed|not public)/i.test(audit), audit.match(/Reachable.{0,80}/)?.[0] ?? "");
  check("audit says findings are rule-based when AI is not connected", /rule-based|AI not configured/i.test(audit));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-audit.png`, fullPage: true });

  // 6. Work queued outside a page action finishes while the app is open (no clicks).
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: authErr } = await sb.auth.signInWithPassword({ email: OWNER, password: PASSWORD });
  if (authErr) throw authErr;
  const { data: m } = await sb.from("organisation_members").select("organisation_id").limit(1).single();
  const { data: biz } = await sb.from("businesses").select("id").eq("organisation_id", m.organisation_id).ilike("name", `%${stamp}%`);
  for (const b of biz) {
    const { error } = await sb.rpc("enqueue_job", { p_org: m.organisation_id, p_run: null, p_type: "audit", p_payload: { businessId: b.id }, p_key: `audit:${b.id}:pulse:${stamp}` });
    if (error) throw error;
  }
  const { count: before } = await sb.from("website_audits").select("id", { count: "exact", head: true }).in("business_id", biz.map((b) => b.id));
  await page.goto(`${BASE}/overview`);
  const sawIndicator = await page.waitForSelector("text=/\\d+ tasks? in progress/", { timeout: 10000 }).then(() => true).catch(() => false);
  check("progress indicator shows queued work", sawIndicator);
  const gone = await page.waitForSelector("text=/\\d+ tasks? in progress/", { state: "detached", timeout: 120000 }).then(() => true).catch(() => false);
  const { count: after } = await sb.from("website_audits").select("id", { count: "exact", head: true }).in("business_id", biz.map((b) => b.id));
  check("queued audits finished with the page open and no clicks", gone && after === before + 3, `audits ${before} → ${after}`);

  check("no client-side errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
