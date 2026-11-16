import type { Metadata } from "next";
import Link from "next/link";
import { Palette } from "lucide-react";
import { getOrgContext, canWrite } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DemoBadge } from "@/components/app/badges";
import { Badge } from "@/components/ui/badge";
import { INDUSTRIES, industryById } from "@/lib/industries";
import { designSearchLinks } from "@/lib/design/search-links";
import { integrationStatus } from "@/lib/integrations";
import type { DesignBrief } from "@/lib/design/brief";
import { formatDate } from "@/lib/utils";
import { addReference } from "./actions";

export const metadata: Metadata = { title: "Design Research" };

export default async function DesignResearchPage({ searchParams }: { searchParams: Promise<{ sector?: string }> }) {
  const { sector = "restaurant" } = await searchParams;
  const ctx = await getOrgContext();
  const [{ data: briefs }, { data: refs }, { data: qualified }, status] = await Promise.all([
    ctx.supabase.from("design_briefs").select("id, business_id, generated_by, created_at, brief, businesses(name, is_demo, industry_id)").eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(60),
    ctx.supabase.from("design_references").select("id, source, url, title, image_url, sector, business_id").eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(30),
    ctx.supabase.from("businesses").select("id, name").eq("organisation_id", ctx.organisationId).in("status", ["qualified", "researching", "prototype_generated", "awaiting_deployment_approval"]).order("lead_score", { ascending: false }).limit(200),
    integrationStatus(ctx.supabase, ctx.organisationId),
  ]);
  const seen = new Set<string>();
  const latest = (briefs ?? []).filter((b) => (seen.has(b.business_id) ? false : (seen.add(b.business_id), true)));
  const industry = industryById(sector) ?? INDUSTRIES[0];

  return (
    <>
      <PageHeader title="Design Research" description="References are collected for inspiration only. Briefs take abstract qualities (mood, rhythm, colour temperature) and never copy layouts, imagery or logos." />
      {status.pinterest.mode !== "live" && (
        <Alert variant="info" className="mb-5"><AlertDescription>Pinterest is not connected, so references come from your team. Use the search links below, then save what you find. Pinterest search needs an approved API token (Integrations).</AlertDescription></Alert>
      )}
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Design briefs</CardTitle></CardHeader>
          <CardContent>
            {latest.length ? (
              <ul className="divide-y">
                {latest.map((b) => {
                  const brief = b.brief as DesignBrief;
                  const biz = b.businesses as unknown as { name: string; is_demo: boolean; industry_id: string | null };
                  return (
                    <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="flex gap-1" aria-hidden>{[brief.palette.primary, brief.palette.accent, brief.palette.secondary, brief.palette.background].map((c) => <span key={c} className="size-5 rounded border" style={{ background: c }} />)}</div>
                      <div className="min-w-0 flex-1">
                        <Link href={`/design-research/${b.business_id}`} className="font-medium hover:underline">{biz.name}</Link> <DemoBadge show={biz.is_demo} />
                        <p className="truncate text-xs text-muted-foreground">{brief.typography.heading} / {brief.typography.body} · {brief.mood_words.join(", ")}</p>
                      </div>
                      <Badge variant={b.generated_by === "ai" ? "default" : "secondary"}>{b.generated_by === "ai" ? "AI brief" : "Sector preset"}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDate(b.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState icon={Palette} title="No briefs yet">Briefs are created automatically for qualified leads, or from a lead’s page.</EmptyState>}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Search for references</CardTitle><CardDescription>Opens each site in a new tab.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <form className="flex gap-2"><Select name="sector" defaultValue={sector} aria-label="Sector">{INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select><button className="rounded-md border px-3 text-sm">Update</button></form>
              <div className="flex flex-wrap gap-2">{designSearchLinks(industry.label).map((l) => <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className="rounded-md border px-2.5 py-1 text-sm hover:bg-muted">{l.label} ↗</a>)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Save a reference</CardTitle></CardHeader>
            <CardContent>
              <ActionForm action={addReference} submitLabel="Save reference" disabled={!canWrite(ctx.role)}>
                <Field label="Page URL" htmlFor="url"><Input id="url" name="url" type="url" required placeholder="https://www.pinterest.com/pin/…" /></Field>
                <Field label="Image URL (optional)" htmlFor="imageUrl" hint="Linked, never copied."><Input id="imageUrl" name="imageUrl" type="url" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="For business" htmlFor="businessId"><Select id="businessId" name="businessId"><option value="">— sector-wide —</option>{qualified?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
                  <Field label="Or sector" htmlFor="ref-sector"><Select id="ref-sector" name="sector" defaultValue={sector}>{INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
                </div>
                <Field label="Title" htmlFor="title"><Input id="title" name="title" /></Field>
                <Field label="What to take from it" htmlFor="notes" hint="e.g. “warm off-white background, generous spacing, serif headings”."><Textarea id="notes" name="notes" rows={2} /></Field>
              </ActionForm>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent references</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">{refs?.map((r) => <li key={r.id} className="flex items-center gap-2"><Badge variant="secondary">{r.source}</Badge><a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="truncate hover:underline">{r.title ?? r.url}</a></li>)}</ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
