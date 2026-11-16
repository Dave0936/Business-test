import type { Metadata } from "next";
import Link from "next/link";
import { getOrgContext } from "@/lib/auth";
import { FilterBar, parseFilters, toRpcFilters } from "@/components/app/filters";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/utils";
import { ActionButton } from "@/components/app/action-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { canApprove } from "@/lib/auth";
import { loadDemoData } from "./actions";

export const metadata: Metadata = { title: "Overview" };

type Metrics = Record<string, number>;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const ctx = await getOrgContext();
  const { supabase, organisationId } = ctx;

  const [{ data: m, error }, { data: activity }, { data: runs }] = await Promise.all([
    supabase.rpc("dashboard_metrics", { p_org: organisationId, ...toRpcFilters(filters) }),
    supabase.from("crm_activities").select("id, summary, type, created_at, business_id, businesses(name)").eq("organisation_id", organisationId).order("created_at", { ascending: false }).limit(10),
    supabase.from("automation_runs").select("id, status, started_at, stats").eq("organisation_id", organisationId).order("started_at", { ascending: false }).limit(5),
  ]);
  if (error) throw error;
  const metrics = (m ?? {}) as Metrics;
  const n = (k: string) => Number(metrics[k] ?? 0);
  const funnel = [
    { label: "Discovered", v: n("discovered") },
    { label: "Qualified", v: n("qualified") },
    { label: "Prototypes", v: n("prototypes_generated") },
    { label: "Deployed", v: n("deployments") },
    { label: "Emailed", v: n("emails_sent") },
    { label: "Replied", v: n("replies") },
    { label: "Interested", v: n("interested") },
    { label: "Converted", v: n("converted") },
  ];
  const max = Math.max(1, ...funnel.map((f) => f.v));

  return (
    <>
      <PageHeader
        title="Overview"
        description="Your pipeline from discovery to signed client. Figures respect the filters below."
        actions={<Button asChild><Link href="/opportunities">Find opportunities</Link></Button>}
      />
      {sp.demo === "loaded" && (
        <Alert variant="success" className="mb-5">
          <AlertTitle>Demo data loaded</AlertTitle>
          <AlertDescription>The real audit, scoring, design and prototype pipeline ran on fictional businesses. Every demo record is labelled “Demo”, uses reserved domains and can never be emailed. Remove it any time in Settings.</AlertDescription>
        </Alert>
      )}
      {n("discovered") === 0 && !Object.values(filters).some(Boolean) && (
        <Alert variant="info" className="mb-5">
          <AlertTitle>Your workspace is empty</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Run a real search, or load fictional demo data to explore. Demo data runs the real audit, scoring, design and prototype pipeline on made-up businesses. It never contacts anyone and is labelled “Demo” everywhere.</span>
            {canApprove(ctx.role) && <ActionButton action={loadDemoData} label="Load demo data" pendingLabel="Running pipeline…" />}
          </AlertDescription>
        </Alert>
      )}
      <FilterBar values={filters} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Businesses discovered" value={n("discovered")} hint={n("discovered") !== n("real_discovered") ? `${n("discovered") - n("real_discovered")} demo` : undefined} href="/leads" />
        <StatCard label="Without a website" value={n("no_website")} href="/leads?opportunity=no_website" />
        <StatCard label="Outdated websites" value={n("outdated")} href="/audits" />
        <StatCard label="Qualified leads" value={n("qualified")} href="/leads?status=qualified" />
        <StatCard label="Average lead score" value={metrics.avg_score ?? "—"} />
        <StatCard label="Designs researched" value={n("designs_researched")} href="/design-research" />
        <StatCard label="Prototypes generated" value={n("prototypes_generated")} href="/builder" />
        <StatCard label="Awaiting approval" value={n("awaiting_approval")} href="/approvals" tone={n("awaiting_approval") ? "attention" : undefined} />
        <StatCard label="Successful deployments" value={n("deployments")} href="/deployments" />
        <StatCard label="Emails awaiting approval" value={n("emails_awaiting")} href="/emails?status=awaiting_approval" tone={n("emails_awaiting") ? "attention" : undefined} />
        <StatCard label="Emails sent" value={n("emails_sent")} href="/emails?status=sent" />
        <StatCard label="Replies received" value={n("replies")} href="/crm" />
        <StatCard label="Interested prospects" value={n("interested")} href="/crm" />
        <StatCard label="Converted customers" value={n("converted")} href="/crm" tone={n("converted") ? "good" : undefined} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Pipeline</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {funnel.map((f) => (
              <div key={f.label} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{f.label}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/80" style={{ width: `${(100 * f.v) / max}%` }} /></div>
                <span className="text-right tabular-nums">{f.v}</span>
              </div>
            ))}
            <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm">
              <div><p className="text-xs text-muted-foreground">Actual revenue (converted)</p><p className="font-semibold">{formatMoney(n("actual_revenue"))}</p></div>
              <div><p className="text-xs text-muted-foreground">Estimated open opportunity</p><p className="font-semibold">{formatMoney(n("estimated_value"))} <span className="text-xs font-normal text-muted-foreground">estimate, not revenue</span></p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent>
            {activity && activity.length ? (
              <ul className="space-y-3 text-sm">
                {activity.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <span><Link className="font-medium hover:underline" href={`/leads/${a.business_id}`}>{(a.businesses as unknown as { name: string } | null)?.name ?? "Business"}</Link> <span className="text-muted-foreground">· {a.summary}</span></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(a.created_at, true)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nothing yet. Start with a search on Find Opportunities.</p>}
            {runs && runs.length > 0 && (
              <div className="mt-5 border-t pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Automation runs</p>
                <ul className="space-y-1.5 text-sm">
                  {runs.map((r) => <li key={r.id} className="flex justify-between"><Link href={`/automation/runs/${r.id}`} className="hover:underline">{formatDate(r.started_at, true)}</Link><span className="text-muted-foreground">{r.status}</span></li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
