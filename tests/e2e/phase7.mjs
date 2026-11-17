// Phase 7 end-to-end acceptance test: the deployments page in a workspace without Cloudflare
// connected (the test workspace never publishes anything). The upload itself is covered by
// tests/unit/cloudflare.test.ts against a stand-in Cloudflare API, and the database rules by
// supabase/tests/10_rls_and_approvals.sql. Run tests/e2e/phase6.mjs first so a [Demo] site is approved.
// Usage: E2E_BASE_URL=http://localhost:3000 E2E_OWNER_EMAIL=... E2E_STAFF_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase7.mjs [screenshotDir]
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  return page;
}

const browser = await chromium.launch();
try {
  const owner = await login(browser, process.env.E2E_OWNER_EMAIL);
  const errors = [];
  owner.on("pageerror", (e) => errors.push(e.message));
  await owner.goto(`${BASE}/deployments`);
  const main = (await owner.locator("main").textContent()) ?? "";
  check("page says Cloudflare isn't connected and nothing can be deployed", /Cloudflare isn.t connected, so nothing can be deployed/.test(main));
  const ready = owner.locator('[data-testid="ready"] li');
  check("approved sites are listed as ready to deploy", (await ready.count()) >= 1, `${await ready.count()}`);
  const deployBtn = ready.first().getByRole("button", { name: "Deploy" });
  check("Deploy is disabled while Cloudflare isn't connected", (await deployBtn.count()) === 1 && (await deployBtn.isDisabled()));
  check("nothing is shown as live", /Nothing is live/.test(main));
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/p7-deployments.png`, fullPage: true });

  // An approved site's review page points to Deployments; the builder too.
  const reviewHref = await ready.first().locator("a", { hasText: "review" }).getAttribute("href");
  await owner.goto(`${BASE}${reviewHref}`);
  check("review page of an approved site links to Deployments", (await owner.locator('[data-testid="not-waiting"] a[href="/deployments"]').count()) === 1);
  await owner.goto(`${BASE}/builder/${reviewHref.split("/").pop()}`);
  check("builder page offers Deploy for an approved site", (await owner.locator('[data-testid="approval-card"] a[href="/deployments"]').count()) === 1);

  // Integrations explains what the Cloudflare token needs.
  await owner.goto(`${BASE}/integrations`);
  check("integrations asks for a token that can edit Workers scripts", /Workers Scripts/.test((await owner.locator("main").textContent()) ?? ""));

  // Staff can see deployments but not deploy.
  const staff = await login(browser, process.env.E2E_STAFF_EMAIL);
  await staff.goto(`${BASE}/deployments`);
  check("staff see no Deploy buttons", (await staff.getByRole("button", { name: "Deploy" }).count()) === 0 && /Only owners and administrators can deploy/.test((await staff.locator("main").textContent()) ?? ""));
  await staff.context().close();

  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/deployments`);
  const overflow = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("deployments page fits a phone screen", overflow <= 1, `overflow ${overflow}px`);
  check("no client-side errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
