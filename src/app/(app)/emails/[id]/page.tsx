import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { integrationStatus } from "@/lib/integrations";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ActionButton } from "@/components/app/action-button";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/field";
import { DemoBadge, StatusBadge } from "@/components/app/badges";
import type { ComplianceResult } from "@/lib/email/compliance";
import { formatDate } from "@/lib/utils";
import { cancelEmailAction, confirmConditionsAction, decideEmailAction, draftEmailAction, markRepliedAction, recheckEmailAction, saveDraftAction, sendEmailAction, testSendAction } from "../actions";
import { EmailDecisionForm } from "./decision-form";

export const metadata: Metadata = { title: "Email" };

const EDITABLE = ["draft", "review", "awaiting_approval", "blocked", "failed"];
const EVENT_LABEL: Record<string, string> = { "email.sent": "Sent by Resend", "email.delivered": "Delivered", "email.delivery_delayed": "Delivery delayed", "email.bounced": "Bounced", "email.complained": "Marked as spam", "email.opened": "Opened", "email.clicked": "Link clicked" };

export default async function EmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const { data: d } = await db.from("email_drafts").select("id, business_id, kind, to_email, subject, body_text, status, compliance, generated_by, sent_at, follow_up_at, last_error, created_at, deployment_id, businesses(id, name, is_demo, status)").eq("id", id).eq("organisation_id", ctx.organisationId).maybeSingle();
  if (!d) notFound();
  const biz = d.businesses as unknown as { id: string; name: string; is_demo: boolean; status: string };
  const [{ data: events }, { data: decisions }, { data: dep }, { data: followUps }, status] = await Promise.all([
    db.from("email_events").select("id, type, occurred_at").eq("draft_id", id).order("occurred_at", { ascending: false }).limit(20),
    db.from("approvals").select("id, decision, comment, decided_at, users(full_name, email)").eq("subject_type", "email").eq("subject_id", id).order("decided_at", { ascending: false }).limit(10),
    d.deployment_id ? db.from("deployment_records").select("url, status").eq("id", d.deployment_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("email_drafts").select("id, status").eq("business_id", d.business_id).eq("kind", "follow_up").neq("status", "cancelled"),
    integrationStatus(db, ctx.organisationId),
  ]);
  const c = (d.compliance ?? {}) as Partial<ComplianceResult>;
  const staff = roleAtLeast(ctx.role, "staff");
  const admin = roleAtLeast(ctx.role, "administrator");
  const editable = staff && EDITABLE.includes(d.status);
  const waiting = d.status === "awaiting_approval" || d.status === "review";
  const resendLive = status.resend.mode === "live";
  const needsConfirm = c.status === "needs_confirmation" && c.requirements?.some((r) => r.id === "jurisdiction_conditions" && !r.met);
  const followUpDue = d.status === "sent" && d.kind === "initial" && d.follow_up_at && new Date(d.follow_up_at) <= new Date() && !followUps?.length && ["contacted"].includes(biz.status);

  return (
    <>
      <PageHeader
        title={d.subject}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={d.status} /><DemoBadge show={biz.is_demo} /><Badge variant="secondary">{d.kind === "follow_up" ? "Follow-up" : "Introduction"}</Badge><span>to {d.to_email}</span><Link href={`/leads/${biz.id}`} className="text-primary hover:underline">{biz.name}</Link>{dep?.url && <a href={dep.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">live concept</a>}</span>}
        actions={staff && EDITABLE.concat("approved").includes(d.status) && <ActionButton action={cancelEmailAction} hidden={{ draftId: id }} label="Cancel email" variant="ghost" confirm="Cancel this email? It won't be sent." />}
      />
      {d.last_error && d.status !== "sent" && <Alert variant={d.status === "cancelled" ? "info" : "destructive"} className="mb-5"><AlertDescription>{d.last_error}</AlertDescription></Alert>}

      <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>{editable ? "Edit email" : "Email"}</CardTitle><CardDescription>{d.generated_by === "ai" ? "Written by Claude from the audit's observed facts; check every sentence." : d.generated_by === "manual" ? "Edited by your team." : "From the template."} Plain text; the footer is required and added by the system.</CardDescription></CardHeader>
          <CardContent>
            {editable ? (
              <ActionForm action={saveDraftAction} submitLabel="Save changes">
                <input type="hidden" name="draftId" value={id} />
                <Field label="Subject" htmlFor="subject"><Input id="subject" name="subject" defaultValue={d.subject} maxLength={150} required /></Field>
                <Field label="Message" htmlFor="body" hint="Editing an approved email voids its approval."><Textarea id="body" name="body" rows={22} defaultValue={d.body_text} className="font-mono text-[13px] leading-relaxed" required /></Field>
              </ActionForm>
            ) : (
              <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-4 font-sans text-sm leading-relaxed" data-testid="email-body">{d.body_text}</pre>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          {waiting && (admin ? (
            <Card data-testid="email-decision-card">
              <CardHeader><CardTitle>Your decision</CardTitle><CardDescription>Approving doesn&apos;t send it. Sending is a separate step.</CardDescription></CardHeader>
              <CardContent><EmailDecisionForm action={decideEmailAction} draftId={id} canApprove={Boolean(c.allowed)} /></CardContent>
            </Card>
          ) : <Alert variant="info"><AlertDescription>Waiting for an owner or administrator to approve it.</AlertDescription></Alert>)}

          {d.status === "approved" && (
            <Card data-testid="send-card">
              <CardHeader><CardTitle>Send</CardTitle><CardDescription>{resendLive ? "Sends this exact approved text through Resend, with a one-click unsubscribe header." : "Connect Resend under Integrations to send."}</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {admin && <ActionButton action={sendEmailAction} hidden={{ draftId: id }} label="Send now" pendingLabel="Sending…" disabled={!resendLive} confirm={`Send this email to ${d.to_email}? This can't be undone.`} />}
                {staff && <ActionButton action={testSendAction} hidden={{ draftId: id }} label="Send a test to me" variant="outline" disabled={!resendLive} />}
                {!admin && <p className="text-sm text-muted-foreground">Only owners and administrators can send.</p>}
              </CardContent>
            </Card>
          )}

          {d.status === "sent" && (
            <Card data-testid="sent-card">
              <CardHeader><CardTitle>Sent {d.sent_at ? formatDate(d.sent_at, true) : ""}</CardTitle><CardDescription>Replies go to your reply address. Record them here so the lead moves on.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {events?.length ? (
                  <ol className="space-y-1 text-sm">{events.map((e) => <li key={e.id} className="flex justify-between gap-2"><span>{EVENT_LABEL[e.type] ?? e.type}</span><span className="text-xs text-muted-foreground">{formatDate(e.occurred_at, true)}</span></li>)}</ol>
                ) : <p className="text-sm text-muted-foreground">No delivery events yet. Add the Resend webhook (see Integrations) to track delivery and bounces.</p>}
                {staff && (
                  <ActionForm action={markRepliedAction} submitLabel="Record reply" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="draftId" value={id} />
                    <Field label="They replied" htmlFor="outcome"><Select id="outcome" name="outcome" defaultValue="replied"><option value="replied">Replied</option><option value="interested">Interested</option><option value="meeting_requested">Wants a call or meeting</option><option value="not_interested">Not interested (stop emailing)</option></Select></Field>
                  </ActionForm>
                )}
                {staff && followUpDue && <ActionButton action={draftEmailAction} hidden={{ businessId: biz.id, kind: "follow_up" }} label="Draft a follow-up" variant="outline" />}
                {d.follow_up_at && !followUpDue && biz.status === "contacted" && <p className="text-xs text-muted-foreground">A follow-up can be drafted from {formatDate(d.follow_up_at)} if there is no reply.</p>}
              </CardContent>
            </Card>
          )}

          <Card data-testid="compliance-card">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">Checks {c.status && <Badge variant={c.allowed ? "success" : c.status === "blocked" ? "destructive" : "warning"}>{c.allowed ? "Can be sent" : c.status === "blocked" ? "Can't be sent" : "Needs confirmation"}</Badge>}</CardTitle>
              <CardDescription>{c.regime ?? "Rules"}{c.lawfulBasis ? ` · basis: ${c.lawfulBasis.replace(/_/g, " ")}` : ""}{c.checkedAt ? ` · checked ${formatDate(c.checkedAt, true)}` : ""}. Re-checked automatically when approving and again when sending. Decision support, not legal advice.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="space-y-1.5" data-testid="requirements">
                {(c.requirements ?? []).map((r) => <li key={r.id} className="flex items-start gap-2">{r.met ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />}<span>{r.label}</span></li>)}
              </ul>
              {c.reasons?.length ? <ul className="list-disc space-y-1 pl-5 text-muted-foreground" data-testid="reasons">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
              {needsConfirm && admin && (
                <ActionForm action={confirmConditionsAction} submitLabel="Confirm">
                  <input type="hidden" name="draftId" value={id} />
                  <p className="text-muted-foreground">{c.notes}</p>
                  <label className="flex items-start gap-2"><input type="checkbox" name="confirm" className="mt-0.5 size-4" /> I have checked these conditions for this business and recorded the evidence.</label>
                </ActionForm>
              )}
              {staff && EDITABLE.includes(d.status) && <ActionButton action={recheckEmailAction} hidden={{ draftId: id }} label="Check again" variant="outline" />}
              <p className="text-xs text-muted-foreground">Fix problems in <Link href="/settings" className="underline">Settings</Link> (agency name, postal address, legitimate interests assessment) or on the <Link href={`/leads/${biz.id}`} className="underline">lead</Link> (business type), then check again.</p>
            </CardContent>
          </Card>

          {decisions && decisions.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Decisions</CardTitle></CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm">
                  {decisions.map((a) => {
                    const who = a.users as unknown as { full_name: string | null; email: string } | null;
                    return <li key={a.id}><StatusBadge status={a.decision} /> <span className="text-xs text-muted-foreground">{who?.full_name ?? who?.email} · {formatDate(a.decided_at, true)}</span>{a.comment && <p className="mt-0.5">{a.comment}</p>}</li>;
                  })}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
