import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { FilterBar, parseFilters, toRpcFilters } from "@/components/app/filters";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COUNTRIES, humanise, industryById } from "@/lib/industries";
import { nowMs } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

type Metrics = Record<string, number>;
type Row = { label: string; leads: number; qualified: number; avg_score: number | null; contacted: number; interested: number; converted: number; estimated_value: number; actual_revenue: number };

const FUNNEL: { key: string; label: string; hint: string }[] = [
  { key: "discovered", label: "Discovered", hint: "Businesses found" },
  { key: "qualified", label: "Qualified", hint: "Latest score qualifies" },
  { key: "designs_researched", label: "Design researched", hint: "Have a design brief" },
  { key: "prototypes_generated", label: "Prototype built", hint: "Have a concept site" },
  { key: "deployments", label: "Deployed", hint: "Concept live (approved first)" },
  { key: "emails_sent", label: "Emailed", hint: "Introduction sent (approved first)" },
  { key: "interested", label: "Interested", hint: "Interested, call booked or won" },
  { key: "converted", label: "Won", hint: "Became a client" },
];

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const money = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
const countryName = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const rpc = toRpcFilters(filters);
  const sixMonths = new Date();
  sixMonths.setUTCMonth(sixMonths.getUTCMonth() - 5, 1);
  sixMonths.setUTCHours(0, 0, 0, 0);
  const eventsFrom = rpc.p_from ?? new Date(nowMs() - 90 * 86400_000).toISOString();

  const [m, countries, sectors, opportunities, usage, events, sent, unsubscribed] = await Promise.all([
    db.rpc("dashboard_metrics", { p_org: ctx.organisationId, ...rpc }),
    db.rpc("analytics_breakdown", { p_org: ctx.organisationId, p_dimension: "country_code", ...rpc }),
    db.rpc("analytics_breakdown", { p_org: ctx.organisationId, p_dimension: "industry_id", ...rpc }),
    db.rpc("analytics_breakdown", { p_org: ctx.organisationId, p_dimension: "opportunity_type", ...rpc }),
    db.from("api_usage").select("provider, cost_usd, created_at").eq("organisation_id", ctx.organisationId).gte("created_at", sixMonths.toISOString()).limit(20000),
    db.from("email_events").select("type").eq("organisation_id", ctx.organisationId).gte("occurred_at", eventsFrom).limit(20000),
    db.from("email_drafts").select("id", { count: "exact", head: true }).eq("organisation_id", ctx.organisationId).eq("status", "sent").gte("sent_at", eventsFrom),
    db.from("suppression_lists").select("id", { count: "exact", head: true }).eq("organisation_id", ctx.organisationId).eq("reason", "unsubscribed").gte("created_at", eventsFrom),
  ]);
  const metrics = (m.data ?? {}) as Metrics;
  const max = Math.max(1, Number(metrics.discovered ?? 0));

  // Costs by month and provider (USD, as providers bill).
  const months: string[] = [];
  for (let i = 0; i < 6; i++) { const d = new Date(sixMonths); d.setUTCMonth(d.getUTCMonth() + i); months.push(d.toISOString().slice(0, 7)); }
  const providers = new Map<string, Map<string, number>>();
  for (const u of usage.data ?? []) {
    const month = u.created_at.slice(0, 7);
    if (!providers.has(u.provider)) providers.set(u.provider, new Map());
    const pm = providers.get(u.provider)!;
    pm.set(month, (pm.get(month) ?? 0) + Number(u.cost_usd));
  }
  const monthTotal = (mo: string) => [...providers.values()].reduce((s, pm) => s + (pm.get(mo) ?? 0), 0);
  const sixMonthTotal = months.reduce((s, mo) => s + monthTotal(mo), 0);
  const ev = new Map<string, number>();
  for (const e of events.data ?? []) ev.set(e.type, (ev.get(e.type) ?? 0) + 1);
  const qs = new URLSearchParams(Object.entries({ from: filters.from ?? "", to: filters.to ?? "", country: filters.country ?? "", sector: filters.sector ?? "", opportunity: filters.opportunity ?? "", minScore: filters.minScore ?? "" }).filter(([, v]) => v));

  const breakdown = (title: string, dimension: string, rows: Row[] | null, name: (l: string) => string) => (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div><CardTitle>{title}</CardTitle><CardDescription>In pipeline = leads past qualifying. Reply rate = interested ÷ contacted.</CardDescription></div>
        <a href={`/api/export/breakdown?dimension=${dimension}&${qs}`} className="shrink-0 text-sm text-primary hover:underline">Download CSV</a>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table data-testid={`breakdown-${dimension}`}>
          <TableHeader><TableRow><TableHead>{title.replace("By ", "")}</TableHead><TableHead className="text-right">Leads</TableHead><TableHead className="text-right" title="Leads past the qualifying stage of the pipeline">In pipeline</TableHead><TableHead className="text-right">Contacted</TableHead><TableHead className="text-right">Interested</TableHead><TableHead className="text-right">Reply rate</TableHead><TableHead className="text-right">Won</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
          <TableBody>
            {(rows ?? []).length ? (rows ?? []).map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium">{name(r.label)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.leads}</TableCell>
                <TableCell className="text-right tabular-nums">{r.qualified}</TableCell>
                <TableCell className="text-right tabular-nums">{r.contacted}</TableCell>
                <TableCell className="text-right tabular-nums">{r.interested}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(Number(r.interested), Number(r.contacted))}</TableCell>
                <TableCell className="text-right tabular-nums">{r.converted}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(r.actual_revenue) ? money(Number(r.actual_revenue)) : "—"}</TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No leads in this period.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader title="Analytics" description="How leads move from discovery to won work, where replies come from, and what it costs. Figures exclude leads in the recycle bin." />
      <FilterBar values={filters} />

      <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
        <Card>
          <CardHeader><CardTitle>Pipeline</CardTitle><CardDescription>How many leads reached each step, as a share of businesses discovered. Steps can be taken out of order (for example, a brief for a lead that didn&apos;t qualify), so they are not strictly nested.</CardDescription></CardHeader>
          <CardContent>
            <ol className="space-y-3" data-testid="funnel">
              {FUNNEL.map((s, i) => {
                const v = Number(metrics[s.key] ?? 0);
                return (
                  <li key={s.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
                    <span><span className="font-medium">{s.label}</span><span className="block text-xs text-muted-foreground">{s.hint}</span></span>
                    <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(v ? 1.5 : 0, (v / max) * 100)}%` }} /></span>
                    <span className="w-28 text-right tabular-nums"><span className="font-medium">{v}</span><span className="text-xs text-muted-foreground"> · {i ? pct(v, max) : "100%"}</span></span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card data-testid="email-stats">
            <CardHeader><CardTitle>Email</CardTitle><CardDescription>{rpc.p_from ? "In the selected period." : "Last 90 days."} Delivery figures need the Resend webhook.</CardDescription></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Sent</dt><dd className="text-right tabular-nums">{sent.count ?? 0}</dd>
                <dt className="text-muted-foreground">Delivered</dt><dd className="text-right tabular-nums">{ev.get("email.delivered") ?? 0}</dd>
                <dt className="text-muted-foreground">Bounced</dt><dd className="text-right tabular-nums">{ev.get("email.bounced") ?? 0}</dd>
                <dt className="text-muted-foreground">Marked as spam</dt><dd className="text-right tabular-nums">{ev.get("email.complained") ?? 0}</dd>
                <dt className="text-muted-foreground">Unsubscribed</dt><dd className="text-right tabular-nums">{unsubscribed.count ?? 0}</dd>
                <dt className="text-muted-foreground">Interested (all time)</dt><dd className="text-right tabular-nums">{Number(metrics.interested ?? 0)}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card data-testid="value">
            <CardHeader><CardTitle>Value</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Won revenue</dt><dd className="text-right tabular-nums">{money(Number(metrics.actual_revenue ?? 0))}</dd>
                <dt className="text-muted-foreground">Open pipeline (estimated)</dt><dd className="text-right tabular-nums">{money(Number(metrics.estimated_value ?? 0))}</dd>
                <dt className="text-muted-foreground">Spend, last 6 months</dt><dd className="text-right tabular-nums">${sixMonthTotal.toFixed(2)}</dd>
                <dt className="text-muted-foreground">Spend per won client</dt><dd className="text-right tabular-nums">{Number(metrics.converted) ? `$${(sixMonthTotal / Number(metrics.converted)).toFixed(2)}` : "—"}</dd>
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">Revenue and estimates come from what you enter on each lead. Spend is in US dollars, as the providers bill it.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 [&>*]:min-w-0">
        {breakdown("By country", "country_code", countries.data as Row[] | null, countryName)}
        {breakdown("By industry", "industry_id", sectors.data as Row[] | null, (l) => industryById(l)?.label ?? (l === "unknown" ? "Unassigned" : humanise(l)))}
        {breakdown("By opportunity type", "opportunity_type", opportunities.data as Row[] | null, (l) => humanise(l))}

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div><CardTitle>Costs by month</CardTitle><CardDescription>From each provider&apos;s reported usage, in US dollars.</CardDescription></div>
            <a href="/api/export/costs" download className="shrink-0 text-sm text-primary hover:underline">Download CSV</a>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table data-testid="costs">
              <TableHeader><TableRow><TableHead>Provider</TableHead>{months.map((mo) => <TableHead key={mo} className="text-right">{new Date(`${mo}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {[...providers.entries()].map(([p, pm]) => (
                  <TableRow key={p}><TableCell className="font-medium">{p === "anthropic" ? "Claude" : humanise(p)}</TableCell>{months.map((mo) => <TableCell key={mo} className="text-right tabular-nums">{pm.get(mo) ? `$${pm.get(mo)!.toFixed(2)}` : "—"}</TableCell>)}</TableRow>
                ))}
                <TableRow><TableCell className="font-medium">Total</TableCell>{months.map((mo) => <TableCell key={mo} className="text-right font-medium tabular-nums">${monthTotal(mo).toFixed(2)}</TableCell>)}</TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
