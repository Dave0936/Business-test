// Phase 1 end-to-end acceptance test against a running app and a real Supabase project.
// Usage: E2E_BASE_URL=http://localhost:3000 E2E_OWNER_EMAIL=... E2E_STAFF_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase1.mjs [screenshotDir]
// The two accounts must exist and be confirmed; the staff account must not belong to any organisation yet.
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OWNER = process.env.E2E_OWNER_EMAIL;
const STAFF = process.env.E2E_STAFF_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

const NAV = ["/overview", "/opportunities", "/leads", "/audits", "/design-research", "/builder", "/approvals", "/deployments", "/emails", "/crm", "/analytics", "/automation", "/integrations", "/settings"];

async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  // The server may redirect again (e.g. to onboarding); wait until navigation settles.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();
try {
  // 1. Unauthenticated access is redirected
  const anon = await browser.newPage();
  await anon.goto(`${BASE}/overview`);
  check("signed-out visitor is redirected to /login", new URL(anon.url()).pathname === "/login", anon.url());
  await anon.fill("#email", OWNER);
  await anon.fill("#password", "wrong-password-123");
  await anon.click("button[type=submit]");
  await anon.waitForSelector("text=Email or password is incorrect", { timeout: 15000 }).then(() => check("wrong password is rejected", true)).catch(() => check("wrong password is rejected", false));
  await anon.close();

  // 2. Owner signs in, creates workspace
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, OWNER);
  if (new URL(page.url()).pathname === "/onboarding") {
    check("first sign-in goes to onboarding", true);
    await page.fill("#name", "Northlight Test Studio");
    await Promise.all([page.waitForURL(/\/settings/, { timeout: 30000 }), page.click("button[type=submit]")]);
    check("workspace created, owner lands on settings", page.url().includes("/settings"));
  } else {
    check("owner already has a workspace", new URL(page.url()).pathname === "/overview", page.url());
  }

  // 3. Save agency settings
  await page.goto(`${BASE}/settings`);
  await page.fill("#agency_name", "Northlight Studio");
  await page.fill("#agency_postal_address", "1 Test Street, Edinburgh EH1 1AA");
  await page.click("text=Save settings");
  await page.waitForSelector("text=Settings saved.", { timeout: 20000 }).then(() => check("owner saves agency settings", true)).catch(async () => check("owner saves agency settings", false, await page.locator("[role=status]").allTextContents().then((t) => t.join(" "))));

  // 4. Load demo data through the real pipeline
  await page.goto(`${BASE}/overview`);
  const loadBtn = page.locator("button", { hasText: "Load demo data" });
  if (await loadBtn.count()) {
    await loadBtn.click();
    const ok = await page.waitForSelector("text=Demo data loaded", { timeout: 240000 }).then(() => true).catch(() => false);
    check("demo data loads through the pipeline and confirms", ok, ok ? "" : (await page.locator("[role=status]").allTextContents()).join(" "));
  }
  await page.goto(`${BASE}/overview`);
  const stat = async (label) => Number((await page.locator(`dt:text-is("${label}") + dd`).first().textContent())?.trim() || NaN);
  const discovered = await stat("Businesses discovered");
  const qualified = await stat("Qualified leads");
  const awaiting = await stat("Awaiting approval");
  check("dashboard shows discovered businesses", discovered > 0, `discovered=${discovered}`);
  check("dashboard shows qualified leads", qualified > 0, `qualified=${qualified}`);
  check("dashboard shows prototypes awaiting approval", awaiting > 0, `awaiting=${awaiting}`);
  check("deployments and sent emails stay at zero (nothing faked)", (await stat("Successful deployments")) === 0 && (await stat("Emails sent")) === 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/overview.png`, fullPage: true });

  // 5. Filters change the figures
  await page.goto(`${BASE}/overview?country=GB`);
  const gb = await stat("Businesses discovered");
  check("country filter narrows dashboard figures", gb > 0 && gb < discovered, `GB=${gb} of ${discovered}`);
  await page.goto(`${BASE}/overview?country=GB&minScore=101`);
  check("min-score filter applies", (await stat("Businesses discovered")) === 0);

  // 6. Every sidebar module loads
  for (const path of NAV) {
    const res = await page.goto(`${BASE}${path}`);
    const h1 = await page.locator("main h1").first().textContent().catch(() => null);
    check(`module ${path} loads`, res?.status() === 200 && Boolean(h1), `${res?.status()} "${h1}"`);
  }
  if (SHOTS) {
    await page.goto(`${BASE}/leads`);
    await page.screenshot({ path: `${SHOTS}/leads.png` });
    const firstLead = page.locator("table a[href^='/leads/']").first();
    await firstLead.click();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOTS}/lead.png`, fullPage: true });
  }
  check("no client-side errors on owner pages", errors.length === 0, errors.slice(0, 3).join(" | "));

  // 7. Mobile layout: sidebar collapses, no horizontal overflow
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/overview`);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check("overview has no horizontal overflow on a phone", !overflow);
  if (SHOTS) await mp.screenshot({ path: `${SHOTS}/overview-mobile.png` });
  await m.close();

  // 8. Sign out
  await page.goto(`${BASE}/overview`);
  await page.click("button[aria-label='Sign out']");
  await page.waitForURL(/\/login/, { timeout: 15000 });
  const after = await page.goto(`${BASE}/overview`);
  check("sign out ends the session", new URL(page.url()).pathname === "/login", `${after?.status()} ${page.url()}`);
  await ctx.close();

  // 9. Staff user (added to the org by the test harness) has restricted permissions
  if (STAFF) {
    const s = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const sp = await s.newPage();
    await signIn(sp, STAFF);
    await sp.goto(`${BASE}/settings`);
    const saveDisabled = await sp.locator("button", { hasText: "Save settings" }).isDisabled();
    check("staff cannot edit agency settings (button disabled)", saveDisabled);
    const inviteVisible = await sp.locator("text=Invite").count();
    check("staff cannot manage the team", inviteVisible === 0);
    await sp.goto(`${BASE}/overview`);
    check("staff sees the same organisation's data", (await sp.locator(`dt:text-is("Businesses discovered") + dd`).first().textContent())?.trim() === String(discovered));
    await s.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
