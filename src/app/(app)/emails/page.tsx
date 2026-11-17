import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Mail } from "lucide-react";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { env } from "@/lib/env";
import { integrationStatus } from "@/lib/integrations";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ActionButton } from "@/components/app/action-button";
import { ActionForm } from "@/components/app/action-form";
import { DemoBadge, StatusBadge } from "@/components/app/badges";
import { formatDate } from "@/lib/utils";
import { addSuppressionAction, draftEmailAction, removeSuppressionAction } from "./actions";

export const metadata: Metadata = { title: "Email Campaigns" };
// Drafting asks Claude to write the email: allow time for it.
export const maxDuration = 120;

type Draft = { id: string; subject: string; to_email: string; status: string; kind: string; sent_at: string | null; follow_up_at: string | null; created_at: string; businesses: { id: string; name: string; is_demo: boolean } | null };

export default async function EmailsPage() {
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const [{ data: drafts, error }, { data: org }, { data: live }, { data: suppressed, count: suppressedCount }, status] = await Promise.all([
    db.from("email_drafts").select("id, subject, to_email, status, kind, sent_at, follow_up_at, created_at, businesses(id, name, is_demo)").eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(200),
    db.from("organisations").select("agency_name, agency_postal_address, agency_reply_email, settings").eq("id", ctx.organisationId).single(),
    db.from("deployment_records").select("business_id, url, businesses(id, name, email, is_demo, status)").eq("organisation_id", ctx.organisationId).eq("status", "verified").order("created_at", { ascending: false }).limit(100),
    db.from("suppression_lists").select("id, email, domain, reason, created_at", { count: "exact" }).eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(30),
    integrationStatus(db, ctx.organisationId),
  ]);
  if (error) throw error;
  const all = (drafts ?? []) as unknown as Draft[];
  const by = (statuses: string[]) => all.filter((d) => statuses.includes(d.status));
  const waiting = by(["awaiting_approval", "review"]);
  const approved = by(["approved", "sending"]);
  const attention = by(["blocked", "failed"]);
  const sent = by(["sent"]);
  const followUpsDue = sent.filter((d) => d.kind === "initial" && d.follow_up_at && new Date(d.follow_up_at) <= new Date());
  const hasDraft = new Set(all.filter((d) => d.kind === "initial" && d.status !== "cancelled").map((d) => d.businesses?.id));
  const seen = new Set<string>();
  const ready = (live ?? []).map((r) => r.businesses as unknown as { id: string; name: string; email: string | null; is_demo: boolean; status: string }).filter((b) => b && !hasDraft.has(b.id) && b.status !== "suppressed" && !seen.has(b.id) && seen.add(b.id));
  const staff = roleAtLeast(ctx.role, "staff");
  const admin = roleAtLeast(ctx.role, "administrator");
  const lia = (org?.settings as { lia?: { completed_at?: string } } | null)?.lia;

  const setup = [
    { ok: status.resend.mode === "live", label: "Resend connected (for sending)", href: "/integrations" },
    { ok: Boolean(org?.agency_name), label: "Agency name set (sender identity)", href: "/settings" },
    { ok: Boolean(org?.agency_postal_address), label: "Postal address set (required in the footer)", href: "/settings" },
    { ok: Boolean(org?.agency_reply_email), label: "Reply address set", href: "/settings" },
    { ok: Boolean(lia?.completed_at), label: "Legitimate interests assessment recorded (UK/EU)", href: "/settings" },
    { ok: Boolean(env.supabaseServiceRoleKey), label: "Server can send (service role key set)", href: "/integrations" },
  ];

  const list = (items: Draft[], empty: string, testId: string) =>
    items.length ? (
      <ul className="divide-y" data-testid={testId}>
        {items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <Link href={`/emails/${d.id}`} className="font-medium hover:underline">{d.subject}</Link>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{d.businesses?.name}<DemoBadge show={Boolean(d.businesses?.is_demo)} /> · {d.to_email} · {d.kind === "follow_up" ? "follow-up · " : ""}{d.sent_at ? `sent ${formatDate(d.sent_at, true)}` : formatDate(d.created_at, true)}</p>
            </div>
            <StatusBadge status={d.status} />
          </li>
        ))}
      </ul>
    ) : <p className="text-sm text-muted-foreground">{empty}</p>;

  return (
    <>
      <PageHeader title="Email Campaigns" description="One short, honest email per business, with its live concept. Every email is approved by an owner or administrator before it can be sent, and checked against the country's rules at drafting, approval and sending." />

      {setup.some((s) => !s.ok) && (
        <Card className="mb-5" data-testid="email-setup">
          <CardHeader><CardTitle>Before you send</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {setup.map((s) => <li key={s.label} className="flex items-center gap-2">{s.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <CircleAlert className="size-4 shrink-0 text-warning" />}{s.ok ? s.label : <Link href={s.href} className="underline">{s.label}</Link>}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
        {!all.length && !ready.length ? (
          <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground"><Mail className="size-6" /><p>Emails can be drafted once a concept is approved and live. <Link href="/deployments" className="underline">Deployments</Link></p></CardContent></Card>
        ) : (
          <div className="space-y-5">
            {ready.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Concepts live, no email yet ({ready.length})</CardTitle><CardDescription>Drafting writes a personalised email from the audit&apos;s observed facts. Nothing is sent.</CardDescription></CardHeader>
                <CardContent>
                  <ul className="divide-y" data-testid="ready-to-email">
                    {ready.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0"><p className="flex items-center gap-2 font-medium">{b.name}<DemoBadge show={b.is_demo} /></p><p className="text-xs text-muted-foreground">{b.email ?? <>No published email address. <Link href={`/leads/${b.id}`} className="underline">Add the one they publish</Link>, or contact them by phone or their contact form.</>}</p></div>
                        {staff && b.email && <ActionButton action={draftEmailAction} hidden={{ businessId: b.id }} label="Draft email" pendingLabel="Writing…" />}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle>Waiting for approval ({waiting.length})</CardTitle></CardHeader>
              <CardContent>{list(waiting, "Nothing is waiting.", "waiting")}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Approved, not sent ({approved.length})</CardTitle><CardDescription>{admin ? "Open one to send it." : "Owners and administrators send approved emails."}</CardDescription></CardHeader>
              <CardContent>{list(approved, "Nothing is ready to send.", "approved")}</CardContent>
            </Card>
            {attention.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Can&apos;t be sent ({attention.length})</CardTitle><CardDescription>Blocked by the checks, or sending failed. Open one to see why.</CardDescription></CardHeader>
                <CardContent>{list(attention, "", "attention")}</CardContent>
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle>Sent ({sent.length})</CardTitle>{followUpsDue.length > 0 && <CardDescription>{followUpsDue.length} without a reply after six days: you may send one gentle follow-up.</CardDescription>}</CardHeader>
              <CardContent>{list(sent, "Nothing sent yet.", "sent")}</CardContent>
            </Card>
          </div>
        )}

          <Card>
            <CardHeader><CardTitle>Do not contact ({suppressedCount ?? 0})</CardTitle><CardDescription>Opt-outs, bounces, complaints and anyone you add. Nothing is ever sent to these addresses or domains.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {staff && (
                <ActionForm action={addSuppressionAction} submitLabel="Add" className="flex items-end gap-2">
                  <Input name="value" placeholder="name@example.co.uk or example.co.uk" aria-label="Email address or domain" required />
                </ActionForm>
              )}
              {suppressed?.length ? (
                <ul className="divide-y text-sm" data-testid="suppression">
                  {suppressed.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0"><p className="truncate">{s.email ?? `@${s.domain}`}</p><p className="text-xs text-muted-foreground">{s.reason.replace(/_/g, " ")} · {formatDate(s.created_at)}</p></div>
                      {admin && ["manual", "do_not_contact"].includes(s.reason) ? <ActionButton action={removeSuppressionAction} hidden={{ id: s.id }} label="Remove" variant="ghost" confirm="Remove from the do-not-contact list?" /> : <Badge variant="secondary">permanent</Badge>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Nobody yet.</p>}
            </CardContent>
          </Card>
      </div>
    </>
  );
}
