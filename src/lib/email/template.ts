/** Template rendering. Values are plain text; the email is sent as text plus an escaped HTML copy. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export interface FooterInput {
  agencyName: string;
  postalAddress: string | null;
  replyEmail: string | null;
  agencyWebsite: string | null;
  unsubscribeUrl: string;
  businessName: string;
  source: string;
}

/** Mandatory footer appended by the system (not editable in the draft body). */
export function complianceFooter(f: FooterInput): string {
  return [
    "—",
    `${f.agencyName}${f.agencyWebsite ? ` · ${f.agencyWebsite}` : ""}`,
    f.postalAddress ? f.postalAddress.replace(/\n+/g, ", ") : null,
    `You're receiving this because ${f.businessName} publishes this address as a business contact (${f.source}). The concept was created independently and was not commissioned by ${f.businessName}.`,
    `To stop hearing from us, reply "unsubscribe" or use: ${f.unsubscribeUrl}`,
  ].filter(Boolean).join("\n");
}

export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linkify = (s: string) => s.replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1f2328;max-width:560px">${text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}
