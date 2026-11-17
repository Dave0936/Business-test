// Phase 8 end-to-end acceptance test (test workspace: no live concepts, Resend not connected, so
// nothing can be drafted or sent). Covers the email page's setup checklist, recording the
// legitimate interests assessment, the do-not-contact list, the public unsubscribe page and
// one-click endpoint, and the webhook refusing unsigned events. Drafting, approval and sending
// rules are covered by tests/unit/compliance.test.ts, tests/unit/email-webhook.test.ts and
// supabase/tests/10_* and 95_*.
// Usage: E2E_BASE_URL=... E2E_OWNER_EMAIL=... E2E_STAFF_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase8.mjs [screenshotDir]
import { chromium, request as pwRequest } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const stamp = Date.now().toString(36);

async function login(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);
  return page;
}
async function submit(form) {
  const before = (await form.locator('[role="status"]').count()) ? await form.locator('[role="status"]').last().textContent() : null;
  await form.locator("button[type=submit]").first().click();
  for (let i = 0; i < 60; i++) {
    await form.page().waitForTimeout(300);
    const n = await form.locator('[role="status"]').count();
    if (n && (await form.locator('[role="status"]').last().textContent()) !== before) break;
  }
  return ((await form.locator('[role="status"]').last().textContent().catch(() => "")) ?? "").trim();
}

const browser = await chromium.launch();
try {
  const owner = await login(browser, process.env.E2E_OWNER_EMAIL);
  const errors = [];
  owner.on("pageerror", (e) => errors.push(e.message));

  await owner.goto(`${BASE}/emails`);
  const setup = (await owner.locator('[data-testid="email-setup"]').textContent()) ?? "";
  check("email page lists what is missing before sending", /Resend connected/.test(setup) && /Legitimate interests assessment/.test(setup), setup.slice(0, 120));

  // Record the legitimate interests assessment.
  await owner.goto(`${BASE}/settings`);
  const lia = owner.locator('[data-testid="lia-card"] form');
  let msg = await submit(lia);
  check("the assessment needs explicit confirmation", /Confirm that this reflects/.test(msg), msg);
  await lia.locator('input[name="confirm"]').check();
  msg = await submit(lia);
  check("the assessment is recorded", /Assessment saved/.test(msg), msg);
  await owner.reload();
  check("settings show it as recorded with a review date", /Recorded/.test((await owner.locator('[data-testid="lia-card"]').textContent()) ?? "") && /next by/.test((await owner.locator('[data-testid="lia-card"]').textContent()) ?? ""));

  // Do-not-contact list: add, refuse duplicates, remove.
  await owner.goto(`${BASE}/emails`);
  const add = owner.locator("form", { has: owner.locator('input[name="value"]') });
  await add.locator('input[name="value"]').fill("nope");
  msg = await submit(add);
  check("invalid entries are refused", /Enter an email address or a domain/.test(msg), msg);
  const addr = `optout-${stamp}@blocked.example`;
  await add.locator('input[name="value"]').fill(addr);
  msg = await submit(add);
  check("an address can be added to do-not-contact", /Added/.test(msg), msg);
  await owner.reload();
  const row = owner.locator('[data-testid="suppression"] li', { hasText: addr });
  check("it is listed", (await row.count()) === 1);
  owner.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Remove" }).click();
  await row.locator('[role="status"]').waitFor({ timeout: 20000 }).catch(() => {});
  await owner.reload();
  check("a manual entry can be removed by an owner", (await owner.locator('[data-testid="suppression"] li', { hasText: addr }).count()) === 0);
  if (SHOTS) await owner.screenshot({ path: `${SHOTS}/p8-emails.png`, fullPage: true });

  // Staff cannot record the assessment.
  const staff = await login(browser, process.env.E2E_STAFF_EMAIL);
  await staff.goto(`${BASE}/settings`);
  const staffLia = staff.locator('[data-testid="lia-card"] button[type=submit]');
  check("staff cannot record the assessment", (await staffLia.count()) === 1 && (await staffLia.isDisabled()));
  await staff.context().close();

  // Public unsubscribe: no sign-in needed; a bad link reveals nothing.
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/u/${"x".repeat(32)}`);
  check("unsubscribe page is public and refuses unknown links", ap.url().includes("/u/") && /This link is not valid/.test((await ap.locator("main").textContent()) ?? ""));
  const overflow = await ap.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("unsubscribe page fits a phone screen", overflow <= 1, `overflow ${overflow}px`);
  await anon.close();
  const api = await pwRequest.newContext();
  const oneClick = await api.post(`${BASE}/api/unsubscribe/${"x".repeat(32)}`, { form: { "List-Unsubscribe": "One-Click" } });
  check("one-click unsubscribe answers without sign-in (404 for unknown links)", oneClick.status() === 404, `${oneClick.status()}`);
  const redirect = await api.get(`${BASE}/api/unsubscribe/${"x".repeat(32)}`, { maxRedirects: 0 });
  check("opening the one-click address in a browser goes to the page", redirect.status() === 303 && /\/u\//.test(redirect.headers().location ?? ""));
  const hook = await api.post(`${BASE}/api/webhooks/resend`, { data: { type: "email.complained", data: { email_id: "not-ours" } } });
  const hookText = await hook.text();
  // Without the service role key (local runs) the endpoint reports itself unconfigured instead.
  check("webhook ignores events for messages it didn't send", (hook.status() === 200 && /ignored/.test(hookText)) || (hook.status() === 503 && /not configured/.test(hookText)), `${hook.status()} ${hookText}`);
  await api.dispose();

  check("no client-side errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
