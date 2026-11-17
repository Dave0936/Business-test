/**
 * What a reviewer confirms before approving a website. The keys must match
 * public.website_review_items() in the database, which enforces them.
 */
export const WEBSITE_REVIEW_ITEMS = [
  { key: "facts_checked", label: "Business details are right", hint: "Name, phone, email and address match the verified record shown here. Nothing else is stated as fact about the business." },
  { key: "no_invented_claims", label: "Nothing is invented", hint: "No reviews, testimonials, awards, prices, opening hours, qualifications or history that we cannot show came from the business." },
  { key: "concept_notice", label: "It is clearly a concept", hint: "The concept notice is on every page and nothing suggests the business commissioned or endorsed it." },
  { key: "images_ok", label: "Images are suitable", hint: "Photos fit the business, credits are shown, and AI-generated images are labelled as illustrations." },
  { key: "pages_checked", label: "I have looked at every page", hint: "Including the phone-sized view. Links, buttons and forms go where they should." },
] as const;

export type ReviewItemKey = (typeof WEBSITE_REVIEW_ITEMS)[number]["key"];

export type Decision = "approved" | "changes_requested" | "rejected";

export const DECISION_LABEL: Record<Decision, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

/** Turn submitted checkbox values into the checklist the database expects. */
export function checklistFrom(values: Iterable<string>): Record<ReviewItemKey, boolean> {
  const ticked = new Set(values);
  return Object.fromEntries(WEBSITE_REVIEW_ITEMS.map((i) => [i.key, ticked.has(i.key)])) as Record<ReviewItemKey, boolean>;
}

/** Problems that must be solved in the app before a reviewer can approve (the database checks again). */
export function decisionProblems(decision: Decision, checklist: Record<string, boolean>, comment: string): string[] {
  const problems: string[] = [];
  if (decision === "approved") {
    const missing = WEBSITE_REVIEW_ITEMS.filter((i) => !checklist[i.key]).map((i) => i.label.toLowerCase());
    if (missing.length) problems.push(`Confirm every checklist item first (still to confirm: ${missing.join("; ")}).`);
  } else if (comment.trim().length < 3) {
    problems.push(decision === "rejected" ? "Say why you are rejecting it." : "Say what needs to change.");
  }
  return problems;
}

export interface Readiness {
  status: string;
  qaPassed: boolean | null;
  generatedBy: string | null;
  isDemoBusiness: boolean;
}

/** Why a website is not in the approval queue, in plain words (null when it is waiting for review). */
export function notReadyReason(r: Readiness): string | null {
  switch (r.status) {
    case "awaiting_approval": return null;
    case "approved": return "Approved. Nothing is published until someone deploys it, and only this version can be deployed.";
    case "deployed": return "Already deployed.";
    case "rejected": return "Rejected. Build a new version to send it for approval again.";
    case "changes_requested": return "Changes were requested. Revise it; the new version goes back for approval when its checks pass.";
  }
  if (r.qaPassed === false) return "Its quality checks failed. Fix the problems listed, then it goes to approval.";
  if (r.qaPassed && r.generatedBy === "demo" && !r.isDemoBusiness) return "This is a template demo, which cannot be approved for a real business. Build it with the builder first.";
  if (r.qaPassed === null) return "Its quality checks are running. Reload in a moment.";
  if (r.qaPassed && ["generated", "quality_checked"].includes(r.status)) return "Its checks have just passed; it will be in the approval queue in a moment.";
  return "Not waiting for approval.";
}
