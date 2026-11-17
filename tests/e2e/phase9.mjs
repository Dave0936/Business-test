// Phase 9 end-to-end acceptance test: the Automation Centre (pause all, repeating searches),
// the recycle bin (bin, restore, delete permanently) and the cron endpoint's protection.
// Usage: E2E_BASE_URL=... E2E_OWNER_EMAIL=... E2E_STAFF_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase9.mjs [screenshotDir]
import { chromium, request as pwRequest } from "playwright";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const stamp = Date.now().toString(36);
const NAME = `P9 Bin Bakery ${stamp}`;

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  return page;
}
async function clickAction(scope, label, { dialog = false } = {}) {
  const form = scope.locator("form").filter({ has: scope.page().getByRole("button", { name: label, exact: true }) }).first();
  if (dialog) scope.page().once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: label, exact: true }).click();
  await scope.page().waitForTimeout(500);
  await form.locator('[role="status"]').waitFor({ timeout: 30000 }).catch(() => {});
  return ((await form.locator('[role="status"]').textContent().catch(() => "")) ?? "").trim();
}

const browser = await chromium.launch();
try {
  const owner = await login(browser, process.env.E2E_OWNER_EMAIL);
  const errors = [];
  owner.on("pageerror", (e) => errors.push(e.message));

  // Pause all automation, then resume.
  await owner.goto(`${BASE}/automation`);
  check("automation centre shows spend, runs and activity", (await owner.locator('[data-testid="spend"]').count()) === 1 && /Recent runs/.test((await owner.locator("main").textContent()) ?? ""));
  await clickAction(owner.locator("main"), "Pause all automation", { dialog: true });
  await owner.reload();
  check("pausing shows a clear banner", (await owner.locator('[data-testid="paused-banner"]').count()) === 1);
  await clickAction(owner.locator("main"), "Resume automation");
  await owner.reload();
  check("resuming removes it", (await owner.locator('[data-testid="paused-banner"]').count()) === 0);
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/p9-automation.png`, fullPage: true });

  // Staff can't pause everything.
  const staff = await login(browser, process.env.E2E_STAFF_EMAIL);
  await staff.goto(`${BASE}/automation`);
  check("staff cannot pause all automation", (await staff.getByRole("button", { name: "Pause all automation" }).count()) === 0);

  // Recycle bin: a fictional lead imported for the test.
  const csvPath = `${process.env.TMPDIR ?? "/tmp"}/p9-${stamp}.csv`;
  fs.writeFileSync(csvPath, `name,country_code,city,website,email,phone,category,source_url\n${NAME},GB,Perth,,,01632 960 777,Bakery,https://directory.example/p9/1\n`);
  await owner.goto(`${BASE}/opportunities`);
  await owner.setInputFiles('input[name="file"]', csvPath);
  await owner.fill("#licence", "E2E Phase 9 fixture");
  await owner.check('input[name="attest"]');
  await owner.locator("form:has(input[name=file]) button[type=submit]").click();
  await owner.waitForSelector("text=/Imported 1 new/", { timeout: 30000 });
  await owner.goto(`${BASE}/leads?q=${stamp}`);
  const leadHref = await owner.locator(`a:has-text("${NAME}")`).first().getAttribute("href");
  const bizId = leadHref.split("/").pop();

  await owner.goto(`${BASE}/leads/${bizId}`);
  owner.once("dialog", (d) => d.accept());
  await owner.getByRole("button", { name: "Move to bin" }).click();
  await owner.waitForURL(/\/leads\?binned=1/, { timeout: 30000 });
  check("binning confirms and returns to the leads list", /recycle bin/.test((await owner.locator("main").textContent()) ?? ""));
  await owner.goto(`${BASE}/leads?q=${stamp}`);
  check("a binned lead is hidden from leads", (await owner.locator(`a:has-text("${NAME}")`).count()) === 0);
  const direct = await owner.goto(`${BASE}/leads/${bizId}`);
  check("its page is not found while binned", direct.status() === 404);

  await staff.goto(`${BASE}/leads/bin`);
  const staffRow = staff.locator('[data-testid="bin"] li', { hasText: NAME });
  check("staff see it in the bin, without Delete now", (await staffRow.count()) === 1 && (await staffRow.getByRole("button", { name: "Delete now" }).count()) === 0);
  // The row leaves the bin once restored, so check the outcome rather than the message.
  await clickAction(staffRow, "Restore");
  await owner.goto(`${BASE}/leads?q=${stamp}`);
  check("staff can restore it: the lead is back", (await owner.locator(`a:has-text("${NAME}")`).count()) === 1);
  await staff.context().close();

  await owner.goto(`${BASE}/leads/${bizId}`);
  owner.once("dialog", (d) => d.accept());
  await owner.getByRole("button", { name: "Move to bin" }).click();
  await owner.waitForURL(/\/leads\?binned=1/, { timeout: 30000 });
  await owner.goto(`${BASE}/leads/bin`);
  const row = owner.locator('[data-testid="bin"] li', { hasText: NAME });
  check("bin shows when it will be deleted for good", /deleted for good on/.test((await row.textContent()) ?? ""));
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/p9-bin.png`, fullPage: true });
  await clickAction(row, "Delete now", { dialog: true });
  await owner.reload();
  check("an owner can delete it permanently: gone from the bin", (await owner.locator('[data-testid="bin"] li', { hasText: NAME }).count()) === 0);
  const after = await owner.goto(`${BASE}/leads/${bizId}`);
  check("and its page no longer exists", after.status() === 404);

  // The cron endpoint refuses callers without the secret.
  const api = await pwRequest.newContext();
  const cron = await api.get(`${BASE}/api/cron/tick`);
  check("cron endpoint needs its secret", cron.status() === 401, `${cron.status()}`);
  await api.dispose();

  await owner.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/automation", "/leads/bin"]) {
    await owner.goto(`${BASE}${path}`);
    const overflow = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${path} fits a phone screen`, overflow <= 1, `overflow ${overflow}px`);
  }
  check("no client-side errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
