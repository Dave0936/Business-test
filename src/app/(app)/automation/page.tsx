import type { Metadata } from "next";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ActionButton } from "@/components/app/action-button";
import { StatusBadge } from "@/components/app/badges";
import { humanise } from "@/lib/industries";
import { formatDate } from "@/lib/utils";
import type { WorkflowConfig } from "@/lib/jobs/worker";
import { cancelRunAction, deleteWorkflowAction, runWorkflowNowAction, setAutomationPausedAction, updateWorkflowAction } from "./actions";

export const metadata: Metadata = { title: "Automation Centre" };

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Claude (AI)", higgsfield: "Higgsfield (photos)", serpapi: "SerpAPI (search)", google_places: "Google Places", unsplash: "Unsplash" };
const STAT_KEYS = ["searches", "discovered", "new_businesses", "audited", "qualified", "briefs", "prototypes_built", "builds_failed"];

function schedule(minutes: number | null): string {
  if (!minutes) return "Manual only";
  if (minutes % 10080 === 0) return minutes === 10080 ? "Every week" : `Every ${minutes / 10080} weeks`;
  if (minutes % 1440 === 0) return minutes === 1440 ? "Every day" : `Every ${minutes / 1440} days`;
  return `Every ${Math.round(minutes / 60)} hours`;
}

export default async function AutomationPage() {
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [{ data: org }, { data: workflows }, { data: runs }, { data: usage }, { data: failed }, { data: activity }] = await Promise.all([
    db.from("organisations").select("settings, monthly_ai_budget_usd").eq("id", ctx.organisationId).single(),
    db.from("automation_workflows").select("id, name, config, frequency_minutes, enabled, paused, next_run_at, last_run_at").eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }),
    db.from("automation_runs").select("id, status, stats, error, started_at, finished_at, workflow_id").eq("organisation_id", ctx.organisationId).order("started_at", { ascending: false }).limit(15),
    db.from("api_usage").select("provider, cost_usd").eq("organisation_id", ctx.organisationId).gte("created_at", monthStart.toISOString()).limit(10000),
    db.from("jobs").select("id, type, last_error, finished_at, created_at, payload").eq("organisation_id", ctx.organisationId).eq("status", "failed").order("created_at", { ascending: false }).limit(10),
    db.from("crm_activities").select("id, summary, type, created_at, business_id, businesses!inner(name)").eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(25),
  ]);
  const paused = Boolean((org?.settings as { automation_paused?: boolean } | null)?.automation_paused);
  const budget = Number(org?.monthly_ai_budget_usd ?? 0);
  const byProvider = new Map<string, number>();
  for (const u of usage ?? []) byProvider.set(u.provider, (byProvider.get(u.provider) ?? 0) + Number(u.cost_usd));
  const aiSpend = byProvider.get("anthropic") ?? 0;
  const total = [...byProvider.values()].reduce((a, b) => a + b, 0);
  const wfName = new Map((workflows ?? []).map((w) => [w.id, w.name]));
  const staff = roleAtLeast(ctx.role, "staff");
  const admin = roleAtLeast(ctx.role, "administrator");

  return (
    <>
      <PageHeader
        title="Automation Centre"
        description="Repeating searches, what is running now, what it costs, and what happened recently. Automation finds, audits, researches and builds; it never deploys or emails without approval."
        actions={admin && <ActionButton action={setAutomationPausedAction} hidden={{ paused: paused ? "0" : "1" }} label={paused ? "Resume automation" : "Pause all automation"} variant={paused ? "default" : "outline"} confirm={paused ? undefined : "Pause all automation? Repeating searches won't start and running searches stop picking up work until you resume."} />}
      />
      {paused && <Alert variant="warning" className="mb-5" data-testid="paused-banner"><AlertDescription>All automation is paused. Repeating searches won&apos;t start and running searches are on hold.</AlertDescription></Alert>}

      <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Repeating searches ({workflows?.length ?? 0})</CardTitle>
              <CardDescription>Start one from <Link href="/opportunities" className="underline">Find Opportunities</Link> and choose &ldquo;Run this search again&rdquo;. They are checked daily{env.supabaseServiceRoleKey ? "" : " (needs the service role key)"} and whenever someone has the app open.</CardDescription>
            </CardHeader>
            <CardContent>
              {workflows?.length ? (
                <ul className="divide-y" data-testid="workflows">
                  {workflows.map((w) => {
                    const c = w.config as WorkflowConfig;
                    const agents = [c.agents?.audit && "audit", c.agents?.research && "design research", c.agents?.generate && `up to ${c.prototypeLimit} prototypes`].filter(Boolean).join(", ");
                    return (
                      <li key={w.id} className="space-y-2 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">{w.name}</p>
                          <div className="flex items-center gap-2">{w.paused ? <Badge variant="warning">Paused</Badge> : <Badge variant="success">On</Badge>}<Badge variant="secondary">{schedule(w.frequency_minutes)}</Badge></div>
                        </div>
                        <p className="text-xs text-muted-foreground">{c.locations?.map((l) => l.city).join(", ")} · {c.sectors?.length ?? 0} industr{c.sectors?.length === 1 ? "y" : "ies"} · {c.leadsPerSearch} per search · {humanise(c.provider ?? "")}{agents ? ` · then ${agents}` : ""}</p>
                        <p className="text-xs text-muted-foreground">{w.last_run_at ? `Last ran ${formatDate(w.last_run_at, true)}` : "Not run yet"}{!w.paused && w.next_run_at ? ` · next ${formatDate(w.next_run_at, true)}` : ""}</p>
                        {staff && (
                          <div className="flex flex-wrap gap-2">
                            <ActionButton action={runWorkflowNowAction} hidden={{ workflowId: w.id }} label="Run now" variant="outline" disabled={paused} />
                            <ActionButton action={updateWorkflowAction} hidden={{ workflowId: w.id, op: w.paused ? "resume" : "pause" }} label={w.paused ? "Resume" : "Pause"} variant="outline" />
                            <ActionButton action={updateWorkflowAction} hidden={{ workflowId: w.id, op: w.frequency_minutes === 10080 ? "monthly" : "weekly" }} label={w.frequency_minutes === 10080 ? "Every 4 weeks instead" : "Every week instead"} variant="ghost" />
                            {admin && <ActionButton action={deleteWorkflowAction} hidden={{ workflowId: w.id }} label="Delete" variant="ghost" confirm={`Delete "${w.name}"? Leads it found are kept.`} />}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground"><Workflow className="size-6" /><p>No repeating searches yet.</p></div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
            <CardContent>
              {runs?.length ? (
                <ul className="divide-y" data-testid="runs">
                  {runs.map((r) => {
                    const s = (r.stats ?? {}) as Record<string, number>;
                    const summary = STAT_KEYS.filter((k) => s[k]).map((k) => `${humanise(k)} ${s[k]}`).join(" · ");
                    return (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <Link href={`/automation/runs/${r.id}`} className="font-medium hover:underline">{r.workflow_id ? wfName.get(r.workflow_id) ?? "Saved search" : "One-off search"}</Link>
                          <p className="text-xs text-muted-foreground">{formatDate(r.started_at, true)}{summary ? ` · ${summary}` : ""}</p>
                          {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                        </div>
                        <div className="flex items-center gap-2"><StatusBadge status={r.status} />{staff && (r.status === "running" || r.status === "paused") && <ActionButton action={cancelRunAction} hidden={{ runId: r.id }} label="Stop" variant="ghost" confirm="Stop this run? Work already done is kept." />}</div>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-muted-foreground">No runs yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle><CardDescription>The latest things that happened to your leads.</CardDescription></CardHeader>
            <CardContent>
              {activity?.length ? (
                <ol className="space-y-2 text-sm" data-testid="activity">
                  {activity.map((a) => (
                    <li key={a.id} className="flex gap-3">
                      <span className="w-28 shrink-0 text-xs text-muted-foreground">{formatDate(a.created_at, true)}</span>
                      <span className="min-w-0"><Link href={`/leads/${a.business_id}`} className="font-medium hover:underline">{(a.businesses as unknown as { name: string }).name}</Link>: {a.summary}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card data-testid="spend">
            <CardHeader><CardTitle>This month&apos;s spend</CardTitle><CardDescription>Recorded from each provider&apos;s reported usage. Runs pause when Claude spending reaches the monthly budget (Settings).</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="flex justify-between"><span>Claude</span><span className="tabular-nums">${aiSpend.toFixed(2)}{budget ? ` of $${budget.toFixed(0)}` : ""}</span></div>
                {budget > 0 && <Progress value={Math.min(100, (aiSpend / budget) * 100)} className="mt-1" aria-label="Claude spending against the monthly budget" />}
              </div>
              {[...byProvider.entries()].filter(([p]) => p !== "anthropic").map(([p, v]) => <div key={p} className="flex justify-between"><span>{PROVIDER_LABEL[p] ?? humanise(p)}</span><span className="tabular-nums">${v.toFixed(2)}</span></div>)}
              <div className="flex justify-between border-t pt-2 font-medium"><span>Total</span><span className="tabular-nums">${total.toFixed(2)}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Problems</CardTitle><CardDescription>Work that failed after its retries.</CardDescription></CardHeader>
            <CardContent>
              {failed?.length ? (
                <ul className="space-y-2 text-sm" data-testid="failed-jobs">
                  {failed.map((j) => {
                    const bid = (j.payload as { businessId?: string } | null)?.businessId;
                    return (
                      <li key={j.id}>
                        <p className="font-medium">{humanise(j.type)}{bid && <> · <Link href={`/leads/${bid}`} className="text-primary hover:underline">lead</Link></>}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(j.finished_at ?? j.created_at, true)} · {j.last_error ?? "failed"}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Nothing has failed.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
