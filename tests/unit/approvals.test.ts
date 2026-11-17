import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checklistFrom, decisionProblems, notReadyReason, WEBSITE_REVIEW_ITEMS } from "@/lib/approvals/review";

describe("website review checklist", () => {
  it("matches the list the database enforces", () => {
    const sql = readFileSync("supabase/migrations/20261117000023_approval_review.sql", "utf8");
    const m = sql.match(/select array\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const dbKeys = m![1].split(",").map((k) => k.trim().replace(/'/g, ""));
    expect(WEBSITE_REVIEW_ITEMS.map((i) => i.key)).toEqual(dbKeys);
  });

  it("builds the checklist from ticked boxes, ignoring unknown values", () => {
    const c = checklistFrom(["facts_checked", "images_ok", "made_up"]);
    expect(c).toEqual({ facts_checked: true, no_invented_claims: false, concept_notice: false, images_ok: true, pages_checked: false });
    expect(Object.keys(c)).not.toContain("made_up");
  });

  it("needs every item to approve, and a reason to reject or ask for changes", () => {
    const all = checklistFrom(WEBSITE_REVIEW_ITEMS.map((i) => i.key));
    expect(decisionProblems("approved", all, "")).toEqual([]);
    expect(decisionProblems("approved", checklistFrom(["facts_checked"]), "")[0]).toMatch(/nothing is invented/);
    expect(decisionProblems("rejected", {}, "  ")[0]).toMatch(/why/);
    expect(decisionProblems("changes_requested", {}, "ok")[0]).toMatch(/what needs to change/);
    expect(decisionProblems("changes_requested", {}, "Use the real menu headings")).toEqual([]);
  });

  it("explains why a site is not in the queue", () => {
    const base = { qaPassed: true, generatedBy: "ai", isDemoBusiness: false };
    expect(notReadyReason({ ...base, status: "awaiting_approval" })).toBeNull();
    expect(notReadyReason({ ...base, status: "generated", qaPassed: false })).toMatch(/checks failed/);
    expect(notReadyReason({ ...base, status: "generated", generatedBy: "demo" })).toMatch(/template demo/);
    expect(notReadyReason({ ...base, status: "changes_requested" })).toMatch(/Revise/);
  });
});
