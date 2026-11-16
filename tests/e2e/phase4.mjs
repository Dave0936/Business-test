// Phase 4 end-to-end acceptance test: the design studio (idea and type, references from sites
// and uploads, love/reject, picks, new round, questions, brief, editing with contrast checks).
// Usage: E2E_BASE_URL=http://localhost:3000 E2E_OWNER_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase4.mjs [screenshotDir]
// Uses a fictional business and reserved .invalid domains only.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OWNER = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

// 1×1 PNG and a fake "PNG" that is really SVG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const FAKE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

const stamp = Date.now().toString(36);
const NAME = `P4 Studio Bistro ${stamp}`;

/** Submit a form and return the message it shows for this submission (not an earlier one). */
async function submit(form, buttonName) {
  const btn = buttonName ? form.getByRole("button", { name: buttonName }) : form.locator("button[type=submit]");
  await btn.click();
  const submitBtn = form.locator("button[type=submit]").first();
  await submitBtn.waitFor({ state: "visible" });
  await form.page().waitForFunction((el) => el.disabled, await submitBtn.elementHandle(), { timeout: 3000 }).catch(() => undefined);
  await form.page().waitForFunction((el) => !el.disabled, await submitBtn.elementHandle(), { timeout: 60000 });
  await form.page().waitForTimeout(150);
  const el = form.locator('[role="status"]').last();
  await el.waitFor({ timeout: 30000 });
  return (await el.textContent())?.trim() ?? "";
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/login`);
  await page.fill("#email", OWNER);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }), page.click("button[type=submit]")]);

  // Fictional business via CSV import.
  const csvPath = "/tmp/claude-0/-home-user/c2e9f2e9-969e-5a2a-8a07-965ba1e35aee/scratchpad/p4.csv";
  fs.writeFileSync(csvPath, `name,country_code,city,website,email,phone,category,source_url\n${NAME},GB,Leith,,,01632 960 401,Restaurant,https://directory.example/p4/1\n`);
  await page.goto(`${BASE}/opportunities`);
  await page.setInputFiles('input[name="file"]', csvPath);
  await page.fill("#licence", "E2E Phase 4 fixture");
  await page.check('input[name="attest"]');
  await page.locator("form:has(input[name=file]) button[type=submit]").click();
  await page.waitForSelector("text=/Imported 1 new/", { timeout: 30000 });
  await page.goto(`${BASE}/leads?q=${stamp}`);
  const href = await page.locator(`a:has-text("${NAME}")`).first().getAttribute("href");
  const id = href.split("/").pop();
  const studioUrl = `${BASE}/design-research/${id}`;

  // Setup: idea and type.
  await page.goto(studioUrl);
  check("studio opens with a default site type for a restaurant", (await page.locator("#siteType").inputValue()) === "menu");
  const setup = page.locator("form:has(#siteType)");
  await page.fill("#idea", "Warm neighbourhood bistro, candlelit evenings, simple menu");
  for (const code of ["fr", "cy", "de"]) await page.check(`input[name="languages"][value="${code}"]`);
  check("more than two extra languages is refused", /up to 2 extra languages/.test(await submit(setup)));
  await page.uncheck('input[name="languages"][value="de"]');
  check("idea saved", /Saved/.test(await submit(setup)));
  await page.goto(studioUrl);
  const langs = await page.locator('input[name="languages"]:checked').evaluateAll((els) => els.map((e) => e.value));
  check("extra languages saved", JSON.stringify(langs) === JSON.stringify(["fr", "cy"]), langs.join(","));

  // References: three sites (unreachable .invalid, saved as links) and two pictures.
  const siteForm = page.locator("form:has(input[name=url])");
  for (const n of [1, 2, 3]) {
    await siteForm.locator("input[name=url]").fill(`https://p4-${stamp}-${n}.invalid/`);
    await siteForm.locator("input[name=notes]").fill(`Reference ${n}`);
    const msg = await submit(siteForm);
    if (n === 1) check("unreachable site saved as a link with a plain reason", /as a link.*could not be read.*does not exist/i.test(msg), msg);
  }
  await siteForm.locator("input[name=url]").fill(`https://p4-${stamp}-1.invalid/`);
  const dup = await submit(siteForm);
  check("duplicate site refused", /already in this studio/.test(dup), dup);

  const upForm = page.locator("form:has(input[name=file])");
  await upForm.locator("input[name=file]").setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: FAKE });
  await upForm.locator("input[name=rights]").check();
  check("disguised SVG upload rejected", /Only PNG, JPEG and WebP/.test(await submit(upForm)));
  for (const n of [1, 2]) {
    await upForm.locator("input[name=file]").setInputFiles({ name: `sketch-${n}.png`, mimeType: "image/png", buffer: PNG });
    await upForm.locator("input[name=notes]").fill(`Sketch ${n}`);
    await upForm.locator("input[name=rights]").check();
    const msg = await submit(upForm);
    check(`picture ${n} uploaded to private storage`, /Picture added/.test(msg), msg);
  }
  await page.goto(studioUrl);
  const cards = page.locator('[data-testid="reference-card"]');
  check("five references listed", (await cards.count()) === 5, `${await cards.count()}`);
  const uploadedImg = await page.locator('[data-testid="reference-card"] img[src*="/storage/v1/object/sign/"]').count();
  check("uploaded pictures shown through short-lived signed links", uploadedImg === 2, `${uploadedImg}`);

  // Love the newest site, reject sketch 1.
  const card = (text) => page.locator('[data-testid="reference-card"]', { hasText: text });
  await card("Reference 3").getByRole("button", { name: "Love" }).click();
  await page.waitForTimeout(1200);
  await card("Sketch 1").getByRole("button", { name: "Reject" }).click();
  await page.waitForTimeout(1200);
  await page.goto(studioUrl);
  check("verdicts saved", (await card("Reference 3").getAttribute("data-verdict")) === "loved" && (await card("Sketch 1").getAttribute("data-verdict")) === "rejected");

  // Picks.
  await page.getByRole("button", { name: "Pick references" }).click();
  await page.waitForTimeout(1500);
  await page.goto(studioUrl);
  const picks = page.locator('[data-testid="pick"]');
  const pickText = (await picks.allTextContents()).join(" | ");
  check("four picks (rejected one excluded), loved first, by rules", (await picks.count()) === 4 && /^Hero.*p4-.*-3/i.test((await picks.first().textContent()) ?? "") && !/Sketch 1/.test(pickText) && (await page.locator("text=picked by simple rules").count()) > 0, pickText.slice(0, 200));
  check("each pick covers a menu-site section", /Hero/.test(pickText) && /Menu/.test(pickText) && /Story/.test(pickText) && /Gallery/.test(pickText));
  await page.getByRole("button", { name: "New round" }).click();
  await page.waitForTimeout(1500);
  await page.goto(studioUrl);
  check("new round increments", (await page.locator("text=/Round 2/").count()) > 0);

  // Questions.
  await page.getByRole("button", { name: "Prepare questions" }).click();
  await page.waitForTimeout(1500);
  await page.goto(studioUrl);
  const qs = page.locator('fieldset:has(input[name^="q_"]) > legend');
  check("five standard questions", (await qs.count()) === 5);
  await page.getByLabel("Photo beside the headline").check();
  await page.getByLabel("Cool", { exact: true }).check();
  await page.getByLabel("Modern sans-serif throughout").check();
  await page.locator('input[name="q_mood"][value="__other"]').check();
  await page.fill('input[name="q_mood_other"]', "Relaxed and candlelit");
  const ansForm = page.locator("form:has(input[name=q_hero])");
  check("answers saved", /Answers saved/.test(await submit(ansForm, "Save answers")));

  // Brief.
  await page.getByRole("button", { name: "Create brief" }).click();
  await page.waitForTimeout(2500);
  await page.goto(studioUrl);
  const main = (await page.locator("main").textContent()) ?? "";
  check("brief created from preset and choices", /Sector preset \+ your choices/.test(main));
  check("answers applied: split hero, Manrope, cool palette", /Hero:\s*split/.test(main) && /Headings:\s*Manrope/.test(main) && /#1f3a4d/i.test(main));
  check("brief says what it takes from each pick", /What it takes from the references/.test(main));

  // Edit with a failing contrast colour; the editor warns live and the save adjusts it.
  await page.locator('[data-testid="brief-editor"] summary').click();
  await page.fill('input[name="c_text"]', "#cccccc");
  check("editor warns about contrast while typing", (await page.locator("text=/fails WCAG AA/").count()) > 0);
  await page.fill('input[name="positioning"], textarea[name="positioning"]', `${NAME} as the relaxed local bistro for evenings out.`);
  const edForm = page.locator('[data-testid="brief-editor"] form');
  const edMsg = await submit(edForm, "Save as new version");
  check("edited brief saved as a new version with contrast fixed", /new version.*Adjusted for contrast/i.test(edMsg), edMsg.slice(0, 160));
  await page.goto(studioUrl);
  check("photo panel shows, and says Higgsfield is not connected", (await page.locator('[data-testid="image-panel"]').count()) === 1 && /Connect Higgsfield under Integrations/.test((await page.locator('[data-testid="image-panel"]').textContent()) ?? ""));
  check("version history kept", (await page.locator("text=Earlier versions").count()) > 0 && /Edited by your team/.test((await page.locator("main").textContent()) ?? ""));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p4-studio.png`, fullPage: true });

  // Changing the type clears picks that no longer fit.
  await page.selectOption("#siteType", "one_page");
  check("changing type resets picks", /pick references again/.test(await submit(page.locator("form:has(#siteType)"))));

  // Index page.
  await page.goto(`${BASE}/design-research`);
  const idx = (await page.locator("main").textContent()) ?? "";
  check("design research lists the edited brief", idx.includes(NAME) && /Edited/.test(idx));
  check("Pinterest card explains it is not connected", /Pinterest boards/.test(idx) && /Not connected/.test(idx));

  // Mobile layout of the studio.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(studioUrl);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("studio fits a phone screen", overflow <= 1, `overflow ${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p4-mobile.png`, fullPage: false });

  check("no client-side errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
