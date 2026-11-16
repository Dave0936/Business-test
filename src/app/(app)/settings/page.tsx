import type { Metadata } from "next";
import { getOrgContext, canApprove } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/app/action-form";
import { ActionButton } from "@/components/app/action-button";
import { Field } from "@/components/app/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { COUNTRIES, humanise } from "@/lib/industries";
import { formatDate } from "@/lib/utils";
import { changeEmail, changePassword, changeRole, inviteMember, removeMember, saveOrganisation } from "./actions";
import { removeDemoData } from "../overview/actions";

export const metadata: Metadata = { title: "Settings" };

const ROLES = ["owner", "administrator", "staff", "read_only"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const ctx = await getOrgContext();
  const [{ data: org }, { data: members }, { data: logs }] = await Promise.all([
    ctx.supabase.from("organisations").select("*").eq("id", ctx.organisationId).single(),
    ctx.supabase.from("organisation_members").select("user_id, role, created_at, users(email, full_name)").eq("organisation_id", ctx.organisationId).order("created_at"),
    ctx.supabase.from("audit_logs").select("id, action, entity_type, created_at, actor_type, users(email)").eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(40),
  ]);
  const admin = canApprove(ctx.role);
  const owner = ctx.role === "owner";

  return (
    <>
      <PageHeader title="Settings" description="Agency details, team roles and the audit log." />
      {welcome && (
        <Alert variant="success" className="mb-5"><AlertTitle>Workspace created</AlertTitle><AlertDescription>Add your agency details next. They identify you in every prototype and email footer.</AlertDescription></Alert>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Agency profile</CardTitle><CardDescription>Shown on concept sites and required in marketing emails (sender identity and postal address).</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={saveOrganisation} submitLabel="Save settings" disabled={!admin}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Workspace name" htmlFor="name"><Input id="name" name="name" defaultValue={org.name} required /></Field>
                <Field label="Agency trading name" htmlFor="agency_name"><Input id="agency_name" name="agency_name" defaultValue={org.agency_name ?? ""} /></Field>
                <Field label="Agency website" htmlFor="agency_website"><Input id="agency_website" name="agency_website" type="url" defaultValue={org.agency_website ?? ""} /></Field>
                <Field label="Reply-to email" htmlFor="agency_reply_email"><Input id="agency_reply_email" name="agency_reply_email" type="email" defaultValue={org.agency_reply_email ?? ""} /></Field>
                <Field label="Default country" htmlFor="default_country_code"><Select id="default_country_code" name="default_country_code" defaultValue={org.default_country_code ?? ""}><option value="">—</option>{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
                <Field label="Daily email limit" htmlFor="daily_email_limit"><Input id="daily_email_limit" name="daily_email_limit" type="number" min={0} max={5000} defaultValue={org.daily_email_limit} /></Field>
                <Field label="Monthly AI budget (USD)" htmlFor="monthly_ai_budget_usd" hint="Automation pauses when reached."><Input id="monthly_ai_budget_usd" name="monthly_ai_budget_usd" type="number" min={0} step="1" defaultValue={org.monthly_ai_budget_usd} /></Field>
              </div>
              <Field label="Postal address" htmlFor="agency_postal_address" hint="Required by UK PECR, CAN-SPAM and most other regimes."><Textarea id="agency_postal_address" name="agency_postal_address" rows={2} defaultValue={org.agency_postal_address ?? ""} /></Field>
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Team</CardTitle><CardDescription>Owners manage the team. Owners and administrators approve deployments and emails. Staff run searches and edit. Read-only can view.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <ul className="divide-y">
              {members?.map((m) => {
                const u = m.users as unknown as { email: string; full_name: string | null };
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{u.full_name ?? u.email}</p><p className="truncate text-xs text-muted-foreground">{u.email}{m.user_id === ctx.user.id ? " · you" : ""}</p></div>
                    {owner ? (
                      <>
                        <ActionForm action={changeRole} submitLabel="Set" className="flex items-center gap-2">
                          <input type="hidden" name="userId" value={m.user_id} />
                          <Select name="role" defaultValue={m.role} className="h-8 w-36" aria-label={`Role for ${u.email}`}>{ROLES.map((r) => <option key={r} value={r}>{humanise(r)}</option>)}</Select>
                        </ActionForm>
                        {m.user_id !== ctx.user.id && <ActionButton action={removeMember} hidden={{ userId: m.user_id }} label="Remove" variant="ghost" confirm={`Remove ${u.email} from this workspace?`} />}
                      </>
                    ) : <Badge variant="outline">{humanise(m.role)}</Badge>}
                  </li>
                );
              })}
            </ul>
            {owner && (
              <ActionForm action={inviteMember} submitLabel="Invite" className="space-y-3 border-t pt-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                  <Field label="Email" htmlFor="invite-email"><Input id="invite-email" name="email" type="email" required /></Field>
                  <Field label="Role" htmlFor="invite-role"><Select id="invite-role" name="role" defaultValue="staff">{ROLES.map((r) => <option key={r} value={r}>{humanise(r)}</option>)}</Select></Field>
                </div>
              </ActionForm>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Your account</CardTitle><CardDescription>Signed in as {ctx.user.email}.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <ActionForm action={changePassword} submitLabel="Change password" className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="New password" htmlFor="new-password"><Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
                <Field label="Repeat new password" htmlFor="confirm-password"><Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
              </div>
            </ActionForm>
            <ActionForm action={changeEmail} submitLabel="Change email" className="space-y-3 border-t pt-5">
              <Field label="New email address" htmlFor="new-email" hint="We send a confirmation link to the new address. Your sign-in email changes when you open it."><Input id="new-email" name="email" type="email" autoComplete="email" required /></Field>
            </ActionForm>
          </CardContent>
        </Card>

        {admin && (
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>Demo data</CardTitle><CardDescription>Delete every fictional “[Demo]” business and its audits, briefs and prototypes. Real data is untouched.</CardDescription></CardHeader>
            <CardContent><ActionButton action={removeDemoData} label="Remove demo data" variant="outline" confirm="Delete all demo businesses and their records?" /></CardContent>
          </Card>
        )}

        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Audit log</CardTitle><CardDescription>Append-only. Nobody, including owners, can edit or delete entries.</CardDescription></CardHeader>
          <CardContent>
            {logs?.length ? (
              <ul className="divide-y text-sm">
                {logs.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span><span className="font-mono text-xs">{l.action}</span> {l.entity_type && <span className="text-muted-foreground">on {l.entity_type}</span>}</span>
                    <span className="text-xs text-muted-foreground">{(l.users as unknown as { email: string } | null)?.email ?? l.actor_type} · {formatDate(l.created_at, true)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No entries yet.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
