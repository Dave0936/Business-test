import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { getOrgContext, canWrite } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { FilterBar, parseFilters } from "@/components/app/filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DemoBadge, ScoreBadge, StatusBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { LEAD_STATUSES, humanise, industryById } from "@/lib/industries";
import { formatDate } from "@/lib/utils";
import { BulkBar } from "./bulk-bar";

export const metadata: Metadata = { title: "Business Leads" };

const PAGE = 50;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const page = Math.max(1, Number(sp.page ?? 1));
  const ctx = await getOrgContext();
  let q = ctx.supabase
    .from("businesses")
    .select("id, name, category, industry_id, city, country_code, website_url, email, opportunity_type, lead_score, status, contactable, discovered_at, is_demo, rating, reviews_count", { count: "exact" })
    .eq("organisation_id", ctx.organisationId);
  if (f.country) q = q.eq("country_code", f.country);
  if (f.sector) q = q.eq("industry_id", f.sector);
  if (f.opportunity) q = q.eq("opportunity_type", f.opportunity);
  if (f.minScore) q = q.gte("lead_score", Number(f.minScore));
  if (f.status) q = q.eq("status", f.status);
  if (f.from) q = q.gte("discovered_at", new Date(f.from).toISOString());
  if (f.to) q = q.lt("discovered_at", new Date(new Date(f.to).getTime() + 86400_000).toISOString());
  if (f.q) q = q.ilike("name", `%${f.q.replace(/[%_]/g, "")}%`);
  const { data: rows, count, error } = await q.order("lead_score", { ascending: false, nullsFirst: false }).order("discovered_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (error) throw error;
  const qs = (p: number) => `?${new URLSearchParams({ ...sp, page: String(p) })}`;

  return (
    <>
      <PageHeader title="Business Leads" description={`${count ?? 0} businesses. Select rows to audit, research or generate prototypes in bulk.`} actions={<><Button variant="outline" asChild><a href={`/api/export/leads?${new URLSearchParams(sp)}`}>Export CSV</a></Button><Button asChild><Link href="/opportunities">Find more</Link></Button></>} />
      <FilterBar values={f} showStatus statuses={LEAD_STATUSES} showSearch />
      {rows && rows.length ? (
        <form id="bulk" className="rounded-xl border bg-card">
          {canWrite(ctx.role) && <BulkBar />}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"><span className="sr-only">Select</span></TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Opportunity</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Found</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell><input type="checkbox" name="businessId" value={b.id} aria-label={`Select ${b.name}`} className="size-4" /></TableCell>
                  <TableCell>
                    <Link href={`/leads/${b.id}`} className="font-medium hover:underline">{b.name}</Link> <DemoBadge show={b.is_demo} />
                    <div className="text-xs text-muted-foreground">{industryById(b.industry_id)?.label ?? b.category ?? "—"}{b.rating != null ? ` · ${b.rating}★ (${b.reviews_count ?? 0})` : ""}{b.email ? " · has email" : ""}</div>
                  </TableCell>
                  <TableCell className="text-sm">{b.city ?? "—"}, {b.country_code}</TableCell>
                  <TableCell className="max-w-48 truncate text-sm">{b.website_url ? <a href={b.website_url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">{b.website_url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : <span className="text-muted-foreground">None</span>}</TableCell>
                  <TableCell className="text-sm">{humanise(b.opportunity_type)}</TableCell>
                  <TableCell className="text-right"><ScoreBadge score={b.lead_score} /></TableCell>
                  <TableCell>
                    <StatusBadge status={b.status} />
                    {b.status === "not_qualified" && b.contactable === false && (
                      <div className="mt-1 text-xs text-muted-foreground" title="The score shows how much the website could improve. A lead only qualifies when the business publishes an email, contact page or phone number.">No contact route found</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(b.discovered_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>Page {page} of {Math.max(1, Math.ceil((count ?? 0) / PAGE))}</span>
            <span className="flex gap-2">
              {page > 1 && <Link className="hover:underline" href={qs(page - 1)}>Previous</Link>}
              {page * PAGE < (count ?? 0) && <Link className="hover:underline" href={qs(page + 1)}>Next</Link>}
            </span>
          </div>
        </form>
      ) : (
        <EmptyState icon={Building2} title="No businesses match" action={<Button asChild><Link href="/opportunities">Find opportunities</Link></Button>}>Run a search, import a licensed list, or loosen the filters.</EmptyState>
      )}
    </>
  );
}
