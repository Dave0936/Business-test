import type { Metadata } from "next";
import Link from "next/link";
import { Wand2 } from "lucide-react";
import { getOrgContext } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { DemoBadge, StatusBadge } from "@/components/app/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SiteSpec } from "@/lib/sites/spec";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "AI Website Builder" };

export default async function BuilderPage() {
  const ctx = await getOrgContext();
  const { data: sites, error } = await ctx.supabase
    .from("generated_websites")
    .select("id, status, updated_at, current_version_id, businesses(name, is_demo, city), website_versions!generated_websites_current_version_fk(version, spec, generated_by), quality_reports(passed, created_at, version_id)")
    .eq("organisation_id", ctx.organisationId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  return (
    <>
      <PageHeader title="AI Website Builder" description="Bespoke prototypes written by Claude from each business’s verified details and design brief. Every build and revision is a new version, checked before it can be approved." actions={<Button variant="outline" asChild><Link href="/design-research">Start from a design studio</Link></Button>} />
      {sites?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sites.map((s) => {
            const v = s.website_versions as unknown as { version: number; spec: SiteSpec; generated_by: string } | null;
            const b = s.businesses as unknown as { name: string; is_demo: boolean; city: string | null };
            const qa = (s.quality_reports as { passed: boolean; version_id: string; created_at: string }[]).filter((q) => q.version_id === s.current_version_id).sort((a, c) => c.created_at.localeCompare(a.created_at))[0];
            return (
              <Link key={s.id} href={`/builder/${s.id}`} className="group overflow-hidden rounded-xl border bg-card shadow-xs transition hover:border-primary/40">
                <div className="h-28 border-b" style={v ? { background: `linear-gradient(135deg, ${v.spec.theme.colors.primary}, ${v.spec.theme.colors.accent})` } : undefined}>
                  {v && <div className="flex h-full flex-col justify-end p-4 text-white"><p className="text-lg font-semibold leading-tight drop-shadow" style={{ fontFamily: v.spec.theme.fonts.heading }}>{b.name}</p><p className="text-xs opacity-90">{v.spec.theme.fonts.heading} · {v.spec.content?.pages.length ?? v.spec.pages?.length ?? 0} pages</p></div>}
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} /><DemoBadge show={b.is_demo} />{qa && <Badge variant={qa.passed ? "success" : "destructive"}>QA {qa.passed ? "passed" : "failed"}</Badge>}{v && <Badge variant="secondary">{v.generated_by === "ai" ? "AI" : v.generated_by === "demo" ? "Template demo" : "Edited"}</Badge>}</div>
                  <p className="text-xs text-muted-foreground">Version {v?.version ?? "—"} · updated {formatDate(s.updated_at, true)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      ) : <EmptyState icon={Wand2} title="No prototypes yet">Generate one from a qualified lead, or turn on prototype generation in a search.</EmptyState>}
    </>
  );
}
