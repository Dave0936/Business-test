import { describe, expect, it } from "vitest";
import { evaluateCompliance, looksPersonal, type ComplianceInput, type ComplianceRule } from "@/lib/email/compliance";

const GB: ComplianceRule = {
  country: "United Kingdom", regime: "UK GDPR + PECR", corporate_subscriber: "allowed_with_opt_out", individual_subscriber: "consent_required", unknown_subscriber: "review_required",
  requires_sender_identity: true, requires_postal_address: true, requires_unsubscribe: true, lawful_basis: "legitimate_interests", notes: "",
};
const DE: ComplianceRule = { ...GB, country: "Germany", regime: "GDPR + UWG §7", corporate_subscriber: "consent_required", unknown_subscriber: "consent_required", lawful_basis: "consent" };
const UNSUB = "https://app.example/u/abc";
const base: ComplianceInput = {
  countryCode: "GB", subscriberType: "corporate", rule: GB, recipient: "hello@harbour-cafe.co.uk", isDemo: false,
  suppression: { email: false, domain: false }, agency: { name: "Northlight Studio", postalAddress: "1 High Street\nAberdeen", replyEmail: "hi@northlight.example" },
  body: `Hello\n\nNorthlight Studio\n1 High Street, Aberdeen\nUnsubscribe: ${UNSUB}`, unsubscribeUrl: UNSUB, confirmations: { legitimate_interests_assessed: true }, emailSource: "business_website",
};

describe("email compliance (UK PECR and others)", () => {
  it("allows a corporate subscriber with sender identity, address, opt-out and an LIA", () => {
    const r = evaluateCompliance(base);
    expect(r.status).toBe("allowed");
    expect(r.requirements.every((q) => q.met)).toBe(true);
  });

  it("asks for the business type when it is unknown in the UK", () => {
    const r = evaluateCompliance({ ...base, subscriberType: "unknown" });
    expect(r.status).toBe("needs_confirmation");
    expect(r.reasons.join(" ")).toMatch(/limited companies and LLPs are corporate/);
  });

  it("blocks sole traders (individual subscribers) without consent", () => {
    expect(evaluateCompliance({ ...base, subscriberType: "individual" }).status).toBe("blocked");
    expect(evaluateCompliance({ ...base, subscriberType: "individual", confirmations: { ...base.confirmations, consent_obtained: true } }).status).toBe("allowed");
  });

  it("needs the legitimate interests assessment", () => {
    const r = evaluateCompliance({ ...base, confirmations: {} });
    expect(r.status).toBe("needs_confirmation");
    expect(r.reasons.join(" ")).toMatch(/legitimate interests assessment/);
  });

  it("blocks missing footer details, opt-outs, unknown sources and demo recipients", () => {
    expect(evaluateCompliance({ ...base, body: base.body.replace("1 High Street", "") }).status).toBe("blocked");
    expect(evaluateCompliance({ ...base, body: base.body.replace(UNSUB, "") }).status).toBe("blocked");
    expect(evaluateCompliance({ ...base, suppression: { email: true, domain: false, reason: "unsubscribed" } }).status).toBe("blocked");
    expect(evaluateCompliance({ ...base, emailSource: "unknown" }).status).toBe("blocked");
    expect(evaluateCompliance({ ...base, recipient: "hello@demo-cafe.invalid" }).status).toBe("blocked");
    expect(evaluateCompliance({ ...base, isDemo: true }).status).toBe("blocked");
  });

  it("blocks countries that need consent even for businesses", () => {
    const r = evaluateCompliance({ ...base, countryCode: "DE", rule: DE });
    expect(r.status).toBe("blocked");
    expect(r.reasons.join(" ")).toMatch(/needs prior consent/);
  });

  it("notices named-person addresses", () => {
    expect(looksPersonal("jane.smith@cafe.co.uk")).toBe(true);
    expect(looksPersonal("hello@cafe.co.uk")).toBe(false);
    expect(looksPersonal("bookings@cafe.co.uk")).toBe(false);
  });
});
