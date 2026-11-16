import type { Metadata } from "next";
import Link from "next/link";
import { getOrgContext, canWrite } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DemoBadge, ScoreBadge } from "@/components/app/badges";
import { ActionButton } from "@/components/app/action-button";
import { Button } from "@/components/ui/button";
import { humanise } from "@/lib/industries";
import { formatDate, formatMoney, nowMs } from "@/lib/utils";
import { completeFollowUp, moveLead } from "./actions";

export const metadata: Metadata = { title: "CRM" };

/** Pipeline columns, each grouping lead statuses. "next" is the natural next move. */
const COLUMNS: { title: string; statuses: string[]; next?: string }[] = [
  { title: "New", statuses: ["new", "researching"], next: "qualified" },
  { title: "Qualified", statuses: ["qualified"], next: "prototype_generated" },
  { title: "Prototype", statuses: ["prototype_generated", "awaiting_deployment_approval", "deployed"] },
  { title: "Outreach", statuses: ["awaiting_email_approval", "contacted"], next: "replied" },
  { title: "Conversation", statuses: ["replied", "interested", "meeting_requested"], next: "meeting_requested" },
  { title: "Won", statuses: ["converted"] },
  { title: "Closed", statuses: ["not_qualified", "not_interested", "suppressed"] },
];

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  const hideDemo = demo === "hide";
  const ctx = await getOrgContext();
  let q = ctx.supabase
    .from("businesses")
    .select("id, name, city, country_code, status, lead_score, follow_up_at, estimated_value, actual_revenue, is_demo, updated_at")
    .eq("organisation_id", ctx.organisationId)
    .order("lead_score", { ascending: false, nullsFirst: false })
    .limit(1000);
  if (hideDemo) q = q.eq("is_demo", false);
  const { data: leads, error } = await q;
  if (error) throw error;
  const now = nowMs();
  const due = (leads ?? []).filter((l) => l.follow_up_at && new Date(l.follow_up_at).getTime() <= now + 86400_000).sort((a, b) => a.follow_up_at!.localeCompare(b.follow_up_at!));
  const writable = canWrite(ctx.role);

  return (
    <>
      <PageHeader
        title="CRM"
        description="Every lead by pipeline stage. Open a card for its full history, or move it on from here."
        actions={<Button variant="outline" asChild><Link href={hideDemo ? "/crm" : "/crm?demo=hide"}>{hideDemo ? "Show demo leads" : "Hide demo leads"}</Link></Button>}
      />
      <Card className="mb-5">
        <CardHeader><CardTitle>Follow-ups due</CardTitle></CardHeader>
        <CardContent>
          {due.length ? (
            <ul className="divide-y">
              {due.map((l) => {
                const overdue = new Date(l.follow_up_at!).getTime() < now;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <Link href={`/leads/${l.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{l.name}</Link>
                    <span className={overdue ? "text-destructive" : "text-muted-foreground"}>{overdue ? "Overdue · " : "Due "}{formatDate(l.follow_up_at)}</span>
                    <span className="text-xs text-muted-foreground">{humanise(l.status)}</span>
                    {writable && (
                      <>
                        <ActionButton action={completeFollowUp} hidden={{ id: l.id, next: "7" }} label="Done, again in 7 days" variant="outline" />
                        <ActionButton action={completeFollowUp} hidden={{ id: l.id, next: "" }} label="Done" variant="ghost" />
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Nothing due. Set follow-up dates on a lead’s page.</p>}
        </CardContent>
      </Card>

      <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Pipeline">
        {COLUMNS.map((col) => {
          const items = (leads ?? []).filter((l) => col.statuses.includes(l.status));
          const value = items.reduce((s, l) => s + Number(col.title === "Won" ? l.actual_revenue ?? 0 : l.estimated_value ?? 0), 0);
          return (
            <section key={col.title} role="listitem" className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40">
              <header className="flex items-baseline justify-between px-3 pt-3 pb-2">
                <h2 className="text-sm font-semibold">{col.title} <span className="font-normal text-muted-foreground">{items.length}</span></h2>
                {value > 0 && <span className="text-xs text-muted-foreground">{col.title === "Won" ? formatMoney(value) : `est. ${formatMoney(value)}`}</span>}
              </header>
              <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                {items.slice(0, 60).map((l) => (
                  <li key={l.id} className="rounded-lg border bg-card p-2.5 text-sm shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/leads/${l.id}`} className="font-medium leading-snug hover:underline">{l.name}</Link>
                      <ScoreBadge score={l.lead_score} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{l.city ?? "—"}, {l.country_code} · {humanise(l.status)} <DemoBadge show={l.is_demo} /></p>
                    {l.follow_up_at && <p className="mt-1 text-xs">Follow up {formatDate(l.follow_up_at)}</p>}
                    {writable && col.next && (
                      <div className="mt-2"><ActionButton action={moveLead} hidden={{ id: l.id, status: col.next }} label={`Move to ${humanise(col.next).toLowerCase()}`} variant="outline" /></div>
                    )}
                  </li>
                ))}
                {items.length > 60 && <li className="px-1 text-xs text-muted-foreground">+{items.length - 60} more in Business Leads</li>}
                {items.length === 0 && <li className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
