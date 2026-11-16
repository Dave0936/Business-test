import { describe, expect, it } from "vitest";
import { renderSite, esc } from "@/lib/sites/render";
import { runQaChecks } from "@/lib/qa/checks";
import { INDUSTRIES } from "@/lib/industries";
import { demoSpec } from "./fixtures";

const ctx = (spec: ReturnType<typeof demoSpec>) => ({ verified: { phone: spec.business.phone, email: spec.business.email, name: spec.business.name }, agencyName: spec.agency.name });

describe("site renderer + QA", () => {
  it("renders a demo restaurant site that passes every QA check", () => {
    const spec = demoSpec();
    const files = renderSite(spec);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["index.html", "contact.html", "booking.html", "styles.css", "script.js", "_headers", "robots.txt"]));
    const report = runQaChecks(files, spec, ctx(spec));
    const failing = report.checks.filter((c) => c.status === "fail");
    expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it.each(INDUSTRIES.map((i) => i.id))("demo content for %s passes QA", (id) => {
    const spec = demoSpec({}, id);
    const report = runQaChecks(renderSite(spec), spec, ctx(spec));
    expect(report.checks.filter((c) => c.status === "fail").flatMap((c) => c.details)).toEqual([]);
  });

  it("escapes hostile text from the business record", () => {
    const spec = demoSpec({ name: `<script>alert(1)</script>"onmouseover="x` });
    const html = renderSite(spec)["index.html"] as string;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(esc("<script>alert(1)</script>"));
    const report = runQaChecks(renderSite(spec), spec, ctx(spec));
    expect(report.checks.find((c) => c.id === "security")?.status).toBe("pass");
  });

  it("fails QA when content invents a testimonial, award or unverified phone", () => {
    const spec = demoSpec();
    const hero = spec.content!.pages[0].sections[0];
    if (hero.type !== "hero") throw new Error("expected hero");
    hero.subheading = "Award-winning food. Call 0131 555 0199. Read our customer reviews.";
    const report = runQaChecks(renderSite(spec), spec, ctx(spec));
    const honesty = report.checks.find((c) => c.id === "honesty")!;
    expect(honesty.status).toBe("fail");
    expect(honesty.details.join(" ")).toMatch(/award/);
    expect(honesty.details.join(" ")).toMatch(/not the verified number/);
    expect(honesty.details.join(" ")).toMatch(/review/);
    expect(report.passed).toBe(false);
  });

  it("fails QA on poor colour contrast", () => {
    const spec = demoSpec();
    spec.theme.colors.primary = "#f5f5f5";
    const report = runQaChecks(renderSite(spec), spec, ctx(spec));
    expect(report.checks.find((c) => c.id === "accessibility")?.status).toBe("fail");
  });

  it("omits contact details the business has not verified", () => {
    const spec = demoSpec({ phone: null, email: null, address: null });
    const files = renderSite(spec);
    expect(files["contact.html"]).not.toMatch(/tel:|mailto:/);
    expect(renderSite(demoSpec({ phone: null, email: null, address: null, city: null }))["contact.html"]).toContain("Contact details would be confirmed");
    expect(runQaChecks(files, spec, ctx(spec)).passed).toBe(true);
  });
});
