import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext, canWrite } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "@/components/app/action-button";
import { Badge } from "@/components/ui/badge";
import type { DesignBrief } from "@/lib/design/brief";
import { contrastRatio } from "@/lib/design/brief";
import { queueAction } from "../../leads/actions";

export const metadata: Metadata = { title: "Design brief" };

export default async function BriefPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await getOrgContext();
  const [{ data: biz }, { data: row }, { data: refs }] = await Promise.all([
    ctx.supabase.from("businesses").select("id, name").eq("id", businessId).eq("organisation_id", ctx.organisationId).maybeSingle(),
    ctx.supabase.from("design_briefs").select("brief, generated_by, created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.supabase.from("design_references").select("id, source, url, title, attribution").eq("business_id", businessId),
  ]);
  if (!biz) notFound();
  if (!row) return <PageHeader title={`Design brief: ${biz.name}`} description="No brief yet." actions={<ActionButton action={queueAction} hidden={{ businessId, type: "research" }} label="Research design" />} />;
  const b = row.brief as DesignBrief & { accessibility_adjustments?: string[] };

  return (
    <>
      <PageHeader title={`Design brief: ${biz.name}`} description={<><Badge variant={row.generated_by === "ai" ? "default" : "secondary"}>{row.generated_by === "ai" ? "AI brief" : "Sector preset (AI not configured)"}</Badge> · <Link href={`/leads/${businessId}`} className="text-primary hover:underline">lead</Link></>}
        actions={canWrite(ctx.role) && <ActionButton action={queueAction} hidden={{ businessId, type: "research", force: "1" }} label="New brief" variant="outline" />} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Direction</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><span className="font-medium">Positioning:</span> {b.positioning}</p>
            <p><span className="font-medium">Audience:</span> {b.audience}</p>
            <p><span className="font-medium">Visual direction:</span> {b.visual_direction}</p>
            <p><span className="font-medium">Hero:</span> {b.hero_layout} — {b.hero_notes}</p>
            <p><span className="font-medium">Image style:</span> {b.image_style}</p>
            <p><span className="font-medium">Navigation:</span> {b.navigation}</p>
            <p><span className="font-medium">Calls to action:</span> {b.ctas.map((c) => c.label).join(" · ")}</p>
            <div><p className="font-medium">Mobile</p><ul className="list-disc pl-5">{b.mobile_recommendations.map((m) => <li key={m}>{m}</li>)}</ul></div>
            <div><p className="font-medium">Functionality</p><ul className="list-disc pl-5">{b.functionality.map((m) => <li key={m}>{m}</li>)}</ul></div>
            <p className="text-xs text-muted-foreground">{b.originality_note}</p>
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Palette and type</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {(["primary", "secondary", "accent", "background", "surface", "text", "muted"] as const).map((k) => (
                  <div key={k} className="space-y-1"><div className="h-12 rounded-md border" style={{ background: b.palette[k] }} /><p className="text-xs">{k}</p><p className="font-mono text-[11px] text-muted-foreground">{b.palette[k]}</p></div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Contrast: text on background {contrastRatio(b.palette.text, b.palette.background).toFixed(1)}:1 · white on primary {contrastRatio("#ffffff", b.palette.primary).toFixed(1)}:1. {b.palette.rationale}</p>
              {b.accessibility_adjustments?.length ? <p className="text-xs text-muted-foreground">Adjusted for accessibility: {b.accessibility_adjustments.join(" ")}</p> : null}
              <p><span className="font-medium">Headings:</span> {b.typography.heading} · <span className="font-medium">Body:</span> {b.typography.body}</p>
              <p className="text-muted-foreground">{b.typography.rationale}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Page structure</CardTitle></CardHeader>
            <CardContent><ul className="space-y-1 text-sm">{b.page_structure.map((p) => <li key={p.page}><span className="font-medium">{p.page}:</span> {p.sections.join(" → ")}</li>)}</ul></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>References</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {refs?.length ? refs.map((r) => {
                const used = b.references_used.find((u) => u.reference_id === r.id);
                return <div key={r.id}><a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">{r.title ?? r.url}</a> <span className="text-xs text-muted-foreground">({r.attribution})</span>{used && <p className="text-xs text-muted-foreground">Took: {used.takeaway}</p>}</div>;
              }) : <p className="text-muted-foreground">None. The brief is based on the sector and audit.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
