import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { canApprove, getOrgContext } from "@/lib/auth";
import { SelectionBar } from "@/components/app/selection-bar";
import { auditsSelectionAction } from "./actions";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { FilterBar, parseFilters } from "@/components/app/filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DemoBadge, ScoreBadge } from "@/components/app/badges";
import { Badge } from "@/components/ui/badge";
import { humanise } from "@/lib/industries";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Website Audits" };

export default async function AuditsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const f = parseFilters(await searchParams);
  const ctx = await getOrgContext();
  let q = ctx.supabase
    .from("website_audits")
    .select("id, url, audit_score, created_at, error, judgements, problems, businesses!inner(id, name, country_code, industry_id, opportunity_type, lead_score, is_demo)")
    .eq("organisation_id", ctx.organisationId);
  if (f.country) q = q.eq("businesses.country_code", f.country);
  if (f.sector) q = q.eq("businesses.industry_id", f.sector);
  if (f.opportunity) q = q.eq("businesses.opportunity_type", f.opportunity);
  if (f.minScore) q = q.gte("businesses.lead_score", Number(f.minScore));
  const { data: audits, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const admin = canApprove(ctx.role);

  return (
    <>
      <PageHeader title="Website Audits" description="Every audit separates what our crawler measured from what AI thinks. The opportunity score comes only from weighted, explained criteria." />
      <FilterBar values={f} />
      {audits?.length ? (
        <form className="rounded-xl border bg-card">
          {admin && <SelectionBar action={auditsSelectionAction} name="auditId" ops={[
            { op: "delete", label: "Delete", variant: "ghost", confirm: "Delete {n} audit(s)? Lead scores are kept." },
            { op: "prune", label: "Remove older audits", noSelection: true, confirm: "Remove every older audit, keeping the latest for each business?" },
          ]} />}
          <Table>
            <TableHeader><TableRow>{admin && <TableHead className="w-8"><span className="sr-only">Select</span></TableHead>}<TableHead>Business</TableHead><TableHead>Website</TableHead><TableHead className="text-right">Site quality</TableHead><TableHead className="text-right">Opportunity</TableHead><TableHead>Type</TableHead><TableHead>Top problem</TableHead><TableHead>Method</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
            <TableBody>
              {audits.map((a) => {
                const b = a.businesses as unknown as { id: string; name: string; opportunity_type: string; lead_score: number | null; is_demo: boolean };
                const top = (a.problems as { title: string }[])[0];
                return (
                  <TableRow key={a.id}>
                    {admin && <TableCell><input type="checkbox" name="auditId" value={a.id} aria-label={`Select the audit of ${b.name}`} className="size-4" /></TableCell>}
                    <TableCell><Link href={`/audits/${a.id}`} className="font-medium hover:underline">{b.name}</Link> <DemoBadge show={b.is_demo} /></TableCell>
                    <TableCell className="max-w-48 truncate text-sm">{a.url ? a.url.replace(/^https?:\/\/(www\.)?/, "") : <span className="text-muted-foreground">No website</span>}</TableCell>
                    <TableCell className="text-right">{a.audit_score ?? "—"}</TableCell>
                    <TableCell className="text-right"><ScoreBadge score={b.lead_score} /></TableCell>
                    <TableCell className="text-sm">{humanise(b.opportunity_type)}</TableCell>
                    <TableCell className="max-w-56 truncate text-sm text-muted-foreground">{a.error ?? top?.title ?? "—"}</TableCell>
                    <TableCell>{(a.judgements as { source?: string }).source === "ai" ? <Badge>AI + observed</Badge> : <Badge variant="secondary">Observed only</Badge>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(a.created_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </form>
      ) : <EmptyState icon={ClipboardCheck} title="No audits yet">Audits run automatically after a search, or from a lead’s page.</EmptyState>}
    </>
  );
}
