// Phase 6 end-to-end acceptance test: the approval centre. Uses the fictional [Demo] businesses
// whose template builds may go to approval (load demo data in the test workspace first).
// Usage: E2E_BASE_URL=http://localhost:3000 E2E_OWNER_EMAIL=... E2E_STAFF_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase6.mjs [screenshotDir]
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OWNER = process.env.E2E_OWNER_EMAIL;
const STAFF = process.env.E2E_STAFF_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const stamp = Date.now().toString(36);

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  return page;
}

async function decide(page, button) {
  const form = page.locator('[data-testid="review-form"]');
  const el = form.locator('[role="status"]').last();
  const before = (await el.count()) ? await el.textContent() : null;
  await form.getByRole("button", { name: button }).click();
  // Either an error appears in the form, or the decision is saved and the page shows the outcome.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(300);
    const outcome = page.locator('[data-testid="not-waiting"]');
    if (await outcome.count()) return (await outcome.textContent())?.trim() ?? "";
    if ((await el.count()) && !(await form.getByRole("button", { name: "Working…" }).count())) {
      const t = await el.textContent();
      if (t !== before || Date.now() > deadline - 20000) return t?.trim() ?? "";
    }
  }
  return "";
}

async function currentVersion(page, siteUrl) {
  await page.goto(siteUrl);
  const t = (await page.locator('[data-testid="versions"] li').first().textContent()) ?? "";
  return Number(t.match(/Version (\d+)/)?.[1] ?? 0);
}

const browser = await chromium.launch();
try {
  const owner = await login(browser, OWNER);
  const errors = [];
  owner.on("pageerror", (e) => errors.push(e.message));

  await owner.goto(`${BASE}/approvals`);
  const queue = owner.locator('[data-testid="queue"] li');
  const queued = await queue.count();
  check("queue lists prototypes waiting for review", queued >= 2, `${queued} waiting`);
  // Fictional [Demo] businesses: their template rebuilds may go back to approval without Claude.
  // Top up the queue by rebuilding [Demo] sites that need work (earlier runs decide on two).
  const demoQueued = async () => owner.locator('[data-testid="queue"] li', { hasText: "[Demo]" }).count();
  for (let round = 0; round < 3; round++) {
    await owner.goto(`${BASE}/approvals`);
    if ((await demoQueued()) >= 2) break;
    // Any [Demo] site not already waiting (needs work, approved or deployed) can be rebuilt.
    await owner.goto(`${BASE}/builder`);
    const work = await owner.locator("main a", { hasText: "[Demo]" }).filter({ hasNotText: "Awaiting approval" }).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    if (!work.length) break;
    const id = work[round % work.length].split("/").pop();
    await owner.goto(`${BASE}/builder/${id}`);
    owner.once("dialog", (d) => d.accept());
    await owner.locator("form").filter({ has: owner.getByRole("button", { name: "Whole site from the brief" }) }).locator("button[type=submit]").click();
    for (let i = 0; i < 40; i++) {
      await owner.waitForTimeout(4000);
      await owner.goto(`${BASE}/approvals`);
      if ((await owner.locator(`[data-testid="queue"] a[href="/approvals/${id}"]`).count()) === 1) break;
    }
  }
  await owner.goto(`${BASE}/approvals`);
  const hrefs = await owner.locator('[data-testid="queue"] li', { hasText: "[Demo]" }).locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  check("at least two [Demo] prototypes are waiting", hrefs.length >= 2, `${hrefs.length}`);
  const [siteA, siteB] = hrefs;

  // Staff can look but not decide.
  const staff = await login(browser, STAFF);
  await staff.goto(`${BASE}${siteB}`);
  check("staff see the review page without a decision form", (await staff.locator('[data-testid="decision-card"]').count()) === 0 && /Waiting for an owner or administrator/.test((await staff.locator("main").textContent()) ?? ""));
  await staff.context().close();

  // Owner reviews site A.
  await owner.goto(`${BASE}${siteA}`);
  check("review page shows the verified details", /Name/.test((await owner.locator('[data-testid="verified-facts"]').textContent()) ?? ""));
  check("review page shows the quality checks", (await owner.locator('[data-testid="qa-list"] li').count()) >= 8);
  check("preview is sandboxed", (await owner.locator('[data-testid="preview"]').getAttribute("sandbox")) === "allow-scripts allow-forms");
  await owner.frameLocator('[data-testid="preview"]').locator("h1").first().waitFor({ timeout: 20000 });
  const approve = owner.locator('[data-testid="review-form"]').getByRole("button", { name: "Approve" });
  check("Approve is disabled until the checklist is complete", await approve.isDisabled());
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/p6-review.png`, fullPage: true });

  let msg = await decide(owner, "Request changes");
  check("requesting changes needs a reason", /Say what needs to change/.test(msg), msg);
  const ask = `E2E ${stamp}: make the opening section calmer`;
  await owner.fill("#comment", ask);
  msg = await decide(owner, "Request changes");
  check("changes can be requested with a reason; the site leaves the queue", /Changes were requested/.test(msg), msg);
  check("decision history shows the reason", ((await owner.locator('[data-testid="decision-history"]').textContent()) ?? "").includes(ask));

  await owner.goto(`${BASE}/approvals`);
  check("'Needs work' lists it", ((await owner.locator('[data-testid="needs-work"]').textContent()) ?? "").length > 0 && (await owner.locator(`[data-testid="needs-work"] a[href="${siteA}"]`).count()) === 1);
  check("recent decisions list the reason", ((await owner.locator('[data-testid="recent-decisions"]').textContent()) ?? "").includes(ask));

  // The builder page shows the feedback; a new version goes back to review.
  const siteUrl = `${BASE}/builder/${siteA.split("/").pop()}`;
  const before = await currentVersion(owner, siteUrl);
  check("builder page shows the reviewer's feedback", ((await owner.locator('[data-testid="approval-card"]').textContent()) ?? "").includes(ask));
  const again = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Whole site from the brief" }) });
  owner.once("dialog", (d) => d.accept());
  await again.locator("button[type=submit]").click();
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) { await owner.waitForTimeout(4000); after = await currentVersion(owner, siteUrl); }
  check("a new version is built", after === before + 1, `${before} → ${after}`);
  let card = "";
  for (let i = 0; i < 20; i++) {
    card = (await owner.locator('[data-testid="approval-card"]').textContent()) ?? "";
    if (/waiting for an owner or administrator/i.test(card)) break;
    await owner.waitForTimeout(3000);
    await owner.reload();
  }
  check("the new version goes back to review", /waiting for an owner or administrator/i.test(card) && /earlier version/.test(card), card.slice(0, 160));

  const recheck = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Run checks again" }) }).first();
  await recheck.locator("button[type=submit]").click();
  const rmsg = (await recheck.locator('[role="status"]').last().textContent({ timeout: 90000 }).catch(() => "")) ?? "";
  check("quality checks can be run again", /Checked again: all required checks passed/.test(rmsg), rmsg);

  await owner.goto(`${BASE}${siteA}`);
  check("reviewer sees what was asked last time", ((await owner.locator('[data-testid="decision-card"]').textContent()) ?? "").includes(ask));
  const boxes = owner.locator('[data-testid="review-form"] input[name="check"]');
  const n = await boxes.count();
  for (let i = 0; i < n - 1; i++) await boxes.nth(i).check();
  check("Approve stays disabled with one item unticked", await approve.isDisabled());
  await boxes.nth(n - 1).check();
  check("Approve is enabled once every item is ticked", await approve.isEnabled());
  msg = await decide(owner, "Approve");
  check("approving works and says nothing is published yet", /Approved\. Nothing is published until someone deploys it/.test(msg), msg);
  await owner.reload();
  const hist = (await owner.locator('[data-testid="decision-history"]').textContent()) ?? "";
  check("history records both decisions with their versions", /Approved/.test(hist) && /Changes requested/.test(hist) && hist.includes(`version ${after}`) && hist.includes(`version ${before}`), hist.slice(0, 200));

  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}${siteA}`);
  const overflow = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("review page fits a phone screen", overflow <= 1, `overflow ${overflow}px`);
  await owner.goto(`${BASE}/approvals`);
  const overflow2 = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("approvals page fits a phone screen", overflow2 <= 1, `overflow ${overflow2}px`);
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/p6-approvals-phone.png`, fullPage: true });
  check("no client-side errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
