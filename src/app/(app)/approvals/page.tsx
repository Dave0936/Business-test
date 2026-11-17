import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/app/badges";
import { DECISION_LABEL, type Decision } from "@/lib/approvals/review";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Prototype Approvals" };

const DECISION_TONE: Record<Decision, "success" | "warning" | "destructive"> = { approved: "success", changes_requested: "warning", rejected: "destructive" };

type SiteRow = { id: string; status: string; updated_at: string; businesses: { name: string; city: string | null; is_demo: boolean }; website_versions: { version: number; created_at: string; change_note: string | null } | null };

export default async function ApprovalsPage() {
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const select = "id, status, updated_at, businesses(name, city, is_demo), website_versions!generated_websites_current_version_fk(version, created_at, change_note)";
  const [{ data: waiting, error }, { data: needsWork }, { data: decisions }] = await Promise.all([
    db.from("generated_websites").select(select).eq("organisation_id", ctx.organisationId).eq("status", "awaiting_approval").order("updated_at", { ascending: true }).limit(100),
    db.from("generated_websites").select(select).eq("organisation_id", ctx.organisationId).in("status", ["changes_requested", "rejected"]).order("updated_at", { ascending: false }).limit(50),
    db.from("approvals").select("id, subject_id, decision, comment, decided_at, version_id, users(full_name, email)").eq("organisation_id", ctx.organisationId).eq("subject_type", "website").order("decided_at", { ascending: false }).limit(30),
  ]);
  if (error) throw error;
  const siteIds = [...new Set((decisions ?? []).map((d) => d.subject_id))];
  const { data: decided } = siteIds.length ? await db.from("generated_websites").select("id, businesses(name)").in("id", siteIds) : { data: [] };
  const nameOf = new Map((decided ?? []).map((s) => [s.id, (s.businesses as unknown as { name: string }).name]));
  const versionIds = (decisions ?? []).map((d) => d.version_id).filter(Boolean) as string[];
  const { data: vs } = versionIds.length ? await db.from("website_versions").select("id, version").in("id", versionIds) : { data: [] };
  const versionNo = new Map((vs ?? []).map((v) => [v.id, v.version]));
  const canDecide = roleAtLeast(ctx.role, "administrator");

  const rows = (list: SiteRow[] | null, emptyText: string, testId: string) =>
    list?.length ? (
      <ul className="divide-y" data-testid={testId}>
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">{s.businesses.name}<DemoBadge show={s.businesses.is_demo} /></p>
              <p className="text-xs text-muted-foreground">{s.businesses.city ?? ""}{s.website_versions ? ` · version ${s.website_versions.version} · ${s.website_versions.change_note ?? ""} · ${formatDate(s.website_versions.created_at, true)}` : ""}</p>
            </div>
            <Link href={`/approvals/${s.id}`} className="text-sm font-medium text-primary hover:underline">{testId === "queue" && canDecide ? "Review" : "Open"}</Link>
          </li>
        ))}
      </ul>
    ) : <p className="py-2 text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <>
      <PageHeader title="Prototype Approvals" description="Prototypes that passed their quality checks wait here for an owner or administrator. Approving records exactly which version was checked; nothing is published or sent until someone deploys it." />
      {!waiting?.length && !needsWork?.length && !decisions?.length ? (
        <EmptyState icon={ShieldCheck} title="Nothing to review">Prototypes appear here once a build passes its quality checks.</EmptyState>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle>Waiting for review ({waiting?.length ?? 0})</CardTitle><CardDescription>{canDecide ? "Oldest first. Open one to check every page and decide." : "Only owners and administrators can approve. You can open them to see their status."}</CardDescription></CardHeader>
              <CardContent>{rows(waiting as unknown as SiteRow[], "Nothing is waiting.", "queue")}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Needs work</CardTitle><CardDescription>Changes were requested or the prototype was rejected. A new version goes back to review when it passes its checks.</CardDescription></CardHeader>
              <CardContent>{rows(needsWork as unknown as SiteRow[], "Nothing needs work.", "needs-work")}</CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Recent decisions</CardTitle></CardHeader>
            <CardContent>
              {decisions?.length ? (
                <ol className="space-y-3 text-sm" data-testid="recent-decisions">
                  {decisions.map((d) => {
                    const who = d.users as unknown as { full_name: string | null; email: string } | null;
                    return (
                      <li key={d.id}>
                        <div className="flex flex-wrap items-center gap-2"><Badge variant={DECISION_TONE[d.decision as Decision]}>{DECISION_LABEL[d.decision as Decision]}</Badge><Link href={`/approvals/${d.subject_id}`} className="font-medium hover:underline">{nameOf.get(d.subject_id) ?? "Website"}</Link></div>
                        <p className="text-xs text-muted-foreground">version {versionNo.get(d.version_id ?? "") ?? "?"} · {who?.full_name ?? who?.email ?? "someone"} · {formatDate(d.decided_at, true)}</p>
                        {d.comment && <p className="mt-0.5 text-muted-foreground">{d.comment}</p>}
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="text-sm text-muted-foreground">No decisions yet.</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
