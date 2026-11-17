import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CheckCircle2, Mail, MessageSquareReply, Wand2, CalendarClock, ShieldCheck, TriangleAlert } from "lucide-react";
import { getOrgContext, canApprove } from "@/lib/auth";
import { FilterBar, parseFilters, toRpcFilters } from "@/components/app/filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ActionButton } from "@/components/app/action-button";
import { TrendStat } from "@/components/charts/trend-stat";
import { SectorDonut, type Slice } from "@/components/charts/sector-donut";
import { WeeklyBars } from "@/components/charts/weekly-bars";
import { ProgressRing } from "@/components/charts/progress-ring";
import { INDUSTRIES, industryById } from "@/lib/industries";
import { listCountries } from "@/lib/places";
import { formatDate, formatMoney, nowMs } from "@/lib/utils";
import { loadDemoData } from "./actions";

export const metadata: Metadata = { title: "Overview" };

type Metrics = Record<string, number>;
type Trend = { days: number } & Record<string, [number, number]>;

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }).format(nowMs()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const ctx = await getOrgContext();
  const { supabase, organisationId } = ctx;
  const rpc = toRpcFilters(filters);
  const now = nowMs();
  const soon = new Date(now + 86400_000).toISOString();

  const [m, t, weeks, sectors, countries, profile, sitesWaiting, emailsWaiting, followUps, failedJobs, audited, activity, countryNames] = await Promise.all([
    supabase.rpc("dashboard_metrics", { p_org: organisationId, ...rpc }),
    supabase.rpc("dashboard_trends", { p_org: organisationId, p_days: 30, p_country: rpc.p_country, p_sector: rpc.p_sector }),
    supabase.rpc("weekly_discoveries", { p_org: organisationId, p_weeks: 8, p_country: rpc.p_country, p_sector: rpc.p_sector }),
    supabase.rpc("analytics_breakdown", { p_org: organisationId, p_dimension: "industry_id", p_from: rpc.p_from, p_to: rpc.p_to }),
    supabase.rpc("analytics_breakdown", { p_org: organisationId, p_dimension: "country_code", p_from: rpc.p_from, p_to: rpc.p_to }),
    supabase.from("users").select("full_name, email").eq("id", ctx.user.id).single(),
    supabase.from("generated_websites").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("status", "awaiting_approval"),
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).in("status", ["review", "awaiting_approval"]),
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).lte("follow_up_at", soon),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("status", "failed").gte("finished_at", new Date(now - 7 * 86400_000).toISOString()),
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).not("lead_score", "is", null),
    supabase.from("crm_activities").select("id, summary, type, created_at, business_id, businesses!inner(name)").eq("organisation_id", organisationId).order("created_at", { ascending: false }).limit(8),
    listCountries(),
  ]);
  if (m.error) throw m.error;
  const metrics = (m.data ?? {}) as Metrics;
  const trend = (t.data ?? { days: 30 }) as Trend;
  const n = (k: string) => Number(metrics[k] ?? 0);
  const firstName = (profile.data?.full_name ?? profile.data?.email ?? "").split(/[\s@.]/)[0] ?? "";

  // Sectors: five largest named, the rest folded into "Other"; colours follow the sector, in catalogue order.
  const sectorRows = ((sectors.data ?? []) as { label: string; leads: number }[]).filter((r) => r.leads > 0);
  const top = sectorRows.slice(0, 5);
  const restTotal = sectorRows.slice(5).reduce((s, r) => s + Number(r.leads), 0);
  const ordered = [...top].sort((a, b) => INDUSTRIES.findIndex((i) => i.id === a.label) - INDUSTRIES.findIndex((i) => i.id === b.label));
  const palette = Object.fromEntries(ordered.map((r, i) => [r.label, i]));
  const slices: Slice[] = [
    ...top.map((r) => ({ key: r.label, label: industryById(r.label)?.label ?? (r.label === "unknown" ? "Unassigned" : r.label), value: Number(r.leads) })),
    ...(restTotal ? [{ key: "other", label: "Other sectors", value: restTotal }] : []),
  ];
  const sectorTotal = slices.reduce((s, x) => s + x.value, 0);

  const weekData = ((weeks.data ?? []) as { week_start: string; discovered: number }[]).map((w) => ({
    label: new Date(w.week_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    discovered: Number(w.discovered),
  }));

  const countryRows = ((countries.data ?? []) as { label: string; leads: number; qualified: number; avg_score: number | null; contacted: number; converted: number }[]).slice(0, 6);
  const countryName = (code: string) => countryNames.find((c) => c.code === code)?.name ?? code;
  const qualRate = (audited.count ?? 0) > 0 ? (100 * n("qualified")) / (audited.count ?? 1) : null;

  const attention = [
    { icon: ShieldCheck, label: "Prototypes awaiting approval", count: sitesWaiting.count ?? 0, href: "/approvals" },
    { icon: Mail, label: "Emails awaiting approval", count: emailsWaiting.count ?? 0, href: "/emails" },
    { icon: CalendarClock, label: "Follow-ups due", count: followUps.count ?? 0, href: "/crm" },
    { icon: TriangleAlert, label: "Failed jobs this week", count: failedJobs.count ?? 0, href: "/opportunities" },
  ];
  const empty = n("discovered") === 0 && !Object.values(filters).some(Boolean);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{greeting()}{firstName ? `, ${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}` : ""}!</h1>
          <p className="mt-1 text-sm text-muted-foreground">Here’s your pipeline from discovery to signed client.</p>
        </div>
        <Button asChild><Link href="/opportunities">Find opportunities</Link></Button>
      </div>

      {sp.demo === "loaded" && (
        <Alert variant="success" className="mb-5">
          <AlertTitle>Demo data loaded</AlertTitle>
          <AlertDescription>The real audit, scoring, design and prototype pipeline ran on fictional businesses. Every demo record is labelled “Demo”, uses reserved domains and can never be emailed. Remove it any time in Settings.</AlertDescription>
        </Alert>
      )}
      {empty && (
        <Alert variant="info" className="mb-5">
          <AlertTitle>Your workspace is empty</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Run a real search, or load fictional demo data to explore. Demo data runs the real pipeline on made-up businesses, never contacts anyone and is labelled “Demo” everywhere.</span>
            {canApprove(ctx.role) && <ActionButton action={loadDemoData} label="Load demo data" pendingLabel="Running pipeline…" />}
          </AlertDescription>
        </Alert>
      )}

      <FilterBar values={filters} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
        <TrendStat label="Businesses discovered" value={n("discovered")} current={trend.discovered?.[0]} previous={trend.discovered?.[1]} days={trend.days} href="/leads" icon={Building2} tone="bg-series-1/12 text-series-1" />
        <TrendStat label="Qualified leads" value={n("qualified")} current={trend.qualified?.[0]} previous={trend.qualified?.[1]} days={trend.days} href="/leads?status=qualified" icon={CheckCircle2} tone="bg-series-3/12 text-series-3" />
        <TrendStat label="Prototypes" value={n("prototypes_generated")} current={trend.prototypes?.[0]} previous={trend.prototypes?.[1]} days={trend.days} href="/builder" icon={Wand2} tone="bg-series-5/12 text-series-5" />
        <TrendStat label="Emails sent" value={n("emails_sent")} current={trend.emails_sent?.[0]} previous={trend.emails_sent?.[1]} days={trend.days} href="/emails" icon={Mail} tone="bg-series-2/12 text-series-2" />
        <TrendStat label="Replies" value={n("replies")} current={trend.replies?.[0]} previous={trend.replies?.[1]} days={trend.days} href="/crm" icon={MessageSquareReply} tone="bg-highlight/20 text-foreground" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[1.15fr_1.15fr_0.9fr] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>Leads by sector</CardTitle></CardHeader>
          <CardContent><SectorDonut slices={slices} total={sectorTotal} palette={palette} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Discovered per week</CardTitle></CardHeader>
          <CardContent><WeeklyBars data={weekData} /></CardContent>
        </Card>
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader><CardTitle>Needs your attention</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {attention.map((a) => (
              <Link key={a.label} href={a.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                <a.icon className="size-4 text-muted-foreground" />
                <span className="flex-1">{a.label}</span>
                <span className={a.count ? "rounded-full bg-highlight px-2 text-xs font-semibold text-highlight-foreground" : "text-muted-foreground tabular-nums"}>{a.count}</span>
              </Link>
            ))}
            <Button variant="highlight" className="mt-3 w-full" asChild><Link href="/approvals">Open approvals</Link></Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_300px] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>Pipeline by country</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {countryRows.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Country</th><th className="px-3 text-right font-medium">Leads</th><th className="px-3 text-right font-medium">Qualified</th><th className="px-3 text-right font-medium">Avg score</th><th className="px-3 text-right font-medium">Contacted</th><th className="pl-3 text-right font-medium">Converted</th>
                  </tr>
                </thead>
                <tbody>
                  {countryRows.map((r) => (
                    <tr key={r.label} className="border-b last:border-0">
                      <td className="py-2.5 pr-3"><Link className="hover:underline" href={`/leads?country=${r.label}`}>{countryName(r.label)}</Link></td>
                      <td className="px-3 text-right tabular-nums">{r.leads}</td>
                      <td className="px-3 text-right tabular-nums">{r.qualified}</td>
                      <td className="px-3 text-right tabular-nums">{r.avg_score ?? "—"}</td>
                      <td className="px-3 text-right tabular-nums">{r.contacted}</td>
                      <td className="pl-3 text-right tabular-nums">{r.converted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-muted-foreground">No leads yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Qualification rate</CardTitle></CardHeader>
          <CardContent><ProgressRing value={qualRate} label="qualified" caption={`${n("qualified")} of ${audited.count ?? 0} audited businesses scored at or above your threshold.`} /></CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>Pipeline at a glance</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {[
                ["Businesses discovered", n("discovered"), "/leads"], ["Without a website", n("no_website"), "/leads?opportunity=no_website"], ["Outdated websites", n("outdated"), "/audits"],
                ["Qualified leads", n("qualified"), "/leads?status=qualified"], ["Average lead score", metrics.avg_score ?? "—", "/audits"], ["Designs researched", n("designs_researched"), "/design-research"],
                ["Prototypes generated", n("prototypes_generated"), "/builder"], ["Awaiting approval", n("awaiting_approval"), "/approvals"], ["Successful deployments", n("deployments"), "/deployments"],
                ["Emails awaiting approval", n("emails_awaiting"), "/emails"], ["Emails sent", n("emails_sent"), "/emails"], ["Replies received", n("replies"), "/crm"],
                ["Interested prospects", n("interested"), "/crm"], ["Converted customers", n("converted"), "/crm"],
              ].map(([label, value, href]) => (
                <Link key={String(label)} href={String(href)} className="group">
                  <dt className="text-xs text-muted-foreground group-hover:text-foreground">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                </Link>
              ))}
            </dl>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm">
              <div><p className="text-xs text-muted-foreground">Actual revenue (converted)</p><p className="font-semibold">{formatMoney(n("actual_revenue"))}</p></div>
              <div><p className="text-xs text-muted-foreground">Estimated open opportunity</p><p className="font-semibold">{formatMoney(n("estimated_value"))} <span className="text-xs font-normal text-muted-foreground">estimate, not revenue</span></p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent>
            {activity.data?.length ? (
              <ol className="relative space-y-3 border-l pl-4 text-sm">
                {activity.data.map((a) => (
                  <li key={a.id}>
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card bg-series-1" />
                    <p><Link className="font-medium hover:underline" href={`/leads/${a.business_id}`}>{(a.businesses as unknown as { name: string } | null)?.name ?? "Business"}</Link> <span className="text-muted-foreground">· {a.summary}</span></p>
                    <p className="text-xs text-muted-foreground">{formatDate(a.created_at, true)}</p>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted-foreground">Nothing yet. Start with a search on Find Opportunities.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
