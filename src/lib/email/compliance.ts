/**
 * Direct-marketing compliance gate. Pure and deterministic so it can be tested
 * and re-run at send time. Rules come from the compliance_rules table
 * (organisation override, then global default for the country, then "*").
 *
 * This is decision support, not legal advice: each outcome lists its reasons,
 * and anything uncertain needs a person to confirm it explicitly.
 */
export type RuleOutcome = "allowed_with_opt_out" | "consent_required" | "review_required";

export interface ComplianceRule {
  country: string;
  regime: string;
  corporate_subscriber: RuleOutcome;
  individual_subscriber: RuleOutcome;
  unknown_subscriber: RuleOutcome;
  requires_sender_identity: boolean;
  requires_postal_address: boolean;
  requires_unsubscribe: boolean;
  lawful_basis: string;
  notes: string;
  references?: string[];
}

export interface ComplianceConfirmations {
  /** A legitimate interests assessment exists for this kind of outreach. */
  legitimate_interests_assessed?: boolean;
  /** For review_required rules: a person checked the jurisdiction-specific conditions in `notes`. */
  jurisdiction_conditions_confirmed?: boolean;
  /** Prior consent obtained from this recipient (with evidence recorded elsewhere). */
  consent_obtained?: boolean;
}

export interface ComplianceInput {
  countryCode: string;
  subscriberType: "corporate" | "individual" | "unknown";
  rule: ComplianceRule;
  recipient: string;
  isDemo: boolean;
  suppression: { email: boolean; domain: boolean; reason?: string };
  agency: { name: string | null; postalAddress: string | null; replyEmail: string | null };
  body: string;
  unsubscribeUrl: string | null;
  confirmations: ComplianceConfirmations;
  /** Address was published by the business (website/listing), not guessed or bought. */
  emailSource: "business_website" | "listing" | "manual" | "unknown";
}

export interface ComplianceResult {
  allowed: boolean;
  status: "allowed" | "needs_confirmation" | "blocked";
  outcome: RuleOutcome;
  regime: string;
  lawfulBasis: string;
  reasons: string[];
  requirements: { id: string; label: string; met: boolean }[];
  notes: string;
  checkedAt: string;
}

const RESERVED = /\.(invalid|example|test|localhost)$/i;
const ROLE_LOCALPART = /^(info|hello|enquiries|enquiry|contact|office|admin|bookings?|reservations?|sales|reception|team|mail|studio|support|hi)$/i;

export function looksPersonal(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  if (ROLE_LOCALPART.test(local)) return false;
  return /^[a-z]+[._-][a-z]+$/i.test(local) || /^[a-z]\.?[a-z]{3,}$/i.test(local);
}

export function pickRule(rules: { organisation_id: string | null; country_code: string; rule: ComplianceRule }[], organisationId: string, country: string): ComplianceRule {
  const cc = country.toUpperCase();
  return (
    rules.find((r) => r.organisation_id === organisationId && r.country_code === cc)?.rule ??
    rules.find((r) => r.organisation_id === null && r.country_code === cc)?.rule ??
    rules.find((r) => r.organisation_id === organisationId && r.country_code === "*")?.rule ??
    rules.find((r) => r.organisation_id === null && r.country_code === "*")!.rule
  );
}

export function evaluateCompliance(i: ComplianceInput): ComplianceResult {
  const reasons: string[] = [];
  const requirements: ComplianceResult["requirements"] = [];
  const req = (id: string, label: string, met: boolean) => requirements.push({ id, label, met });
  let blocked = false;
  let needsConfirmation = false;

  const outcome: RuleOutcome =
    i.subscriberType === "corporate" ? i.rule.corporate_subscriber : i.subscriberType === "individual" ? i.rule.individual_subscriber : i.rule.unknown_subscriber;

  if (i.isDemo || RESERVED.test(i.recipient)) {
    blocked = true;
    reasons.push("Demo or reserved-domain recipient: never sent.");
  }
  if (i.suppression.email || i.suppression.domain) {
    blocked = true;
    reasons.push(`Recipient is on the suppression list (${i.suppression.reason ?? "opted out"}).`);
  }
  if (i.emailSource === "unknown") {
    blocked = true;
    reasons.push("The source of this email address is unknown. Only use addresses the business published itself.");
  }

  if (i.rule.requires_sender_identity) {
    const ok = Boolean(i.agency.name && i.body.includes(i.agency.name));
    req("sender_identity", "Email identifies the sender (agency name)", ok);
    if (!ok) { blocked = true; reasons.push("Add your agency name in Settings; it must appear in the email."); }
  }
  if (i.rule.requires_postal_address) {
    const ok = Boolean(i.agency.postalAddress && i.body.includes(i.agency.postalAddress.split("\n")[0]));
    req("postal_address", "Email includes a valid postal address", ok);
    if (!ok) { blocked = true; reasons.push("Add your agency postal address in Settings; it must appear in the email."); }
  }
  if (i.rule.requires_unsubscribe) {
    const ok = Boolean(i.unsubscribeUrl && i.body.includes(i.unsubscribeUrl));
    req("unsubscribe", "Email contains a working opt-out link", ok);
    if (!ok) { blocked = true; reasons.push("The opt-out link is missing from the email."); }
  }

  switch (outcome) {
    case "consent_required": {
      const ok = Boolean(i.confirmations.consent_obtained);
      req("consent", "Prior consent from this recipient is recorded", ok);
      if (!ok) {
        blocked = true;
        reasons.push(`${i.rule.regime}: this recipient (${i.subscriberType} subscriber) needs prior consent for marketing email. Use another channel, such as their contact form or a phone call, instead.`);
      }
      break;
    }
    case "review_required": {
      const ok = Boolean(i.confirmations.jurisdiction_conditions_confirmed);
      req("jurisdiction_conditions", `Conditions for ${i.rule.country} confirmed by a person`, ok);
      if (!ok) {
        needsConfirmation = true;
        reasons.push(i.subscriberType === "unknown" && i.countryCode.toUpperCase() === "GB"
          ? "Classify the business first: limited companies and LLPs are corporate subscribers; sole traders and some partnerships are individual subscribers and need consent under PECR."
          : `Confirm the conditions for ${i.rule.country}: ${i.rule.notes}`);
      }
      break;
    }
    case "allowed_with_opt_out":
      reasons.push(`${i.rule.regime}: permitted for ${i.subscriberType} subscribers with sender identification and an opt-out.`);
      break;
  }

  if (i.rule.lawful_basis === "legitimate_interests") {
    const ok = Boolean(i.confirmations.legitimate_interests_assessed);
    req("lia", "Legitimate interests assessment completed (Settings)", ok);
    if (!ok) { needsConfirmation = true; reasons.push("Record a legitimate interests assessment in Settings before sending under GDPR."); }
    if (looksPersonal(i.recipient)) reasons.push("This looks like a named person's address. It is personal data: keep the message relevant to their business role and honour objections immediately.");
  }

  const status = blocked ? "blocked" : needsConfirmation ? "needs_confirmation" : "allowed";
  return {
    allowed: status === "allowed",
    status,
    outcome,
    regime: i.rule.regime,
    lawfulBasis: i.rule.lawful_basis,
    reasons,
    requirements,
    notes: i.rule.notes,
    checkedAt: new Date().toISOString(),
  };
}
