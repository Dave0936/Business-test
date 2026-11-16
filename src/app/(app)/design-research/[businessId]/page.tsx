import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { getOrgContext, canWrite } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionButton } from "@/components/app/action-button";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/components/app/badges";
import type { DesignBrief } from "@/lib/design/brief";
import { loadReferences, signedUploadUrls, type ReferenceRow, type Studio, type StudioBusiness } from "@/lib/design/studio";
import { SITE_TYPES, SITE_TYPE_IDS, defaultSiteType } from "@/lib/design/studio-rules";
import { industryById, inferIndustryId } from "@/lib/industries";
import { integrationStatus } from "@/lib/integrations";
import { formatDate } from "@/lib/utils";
import { ReferenceCard } from "./reference-card";
import { BriefView } from "./brief-view";
import { BriefEditor } from "./brief-editor";
import {
  addSiteAction, answersAction, briefAction, collectPinsAction, discoverSitesAction, pickAction, questionsAction, saveStudioSetup, uploadAction,
} from "../studio-actions";
import { buildSiteAction } from "../../builder/actions";

// Server actions here can run a builder step or a web search: allow up to 5 minutes.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Design studio" };

function Step({ n, title, done, children, description }: { n: number; title: string; done: boolean; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="space-y-3">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-success text-white" : "bg-secondary text-secondary-foreground"}`} aria-hidden>{done ? <Check className="size-4" /> : n}</span>
        <div>
          <h2 id={`step-${n}`} className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="sm:pl-10">{children}</div>
    </section>
  );
}

export default async function StudioPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const { data: biz } = await db.from("businesses").select("id, name, category, city, country_code, opportunity_type, industry_id, sector, is_demo").eq("id", businessId).eq("organisation_id", ctx.organisationId).maybeSingle();
  if (!biz) notFound();
  const business = { ...biz, industry_id: biz.industry_id ?? inferIndustryId(biz.category) ?? null } as StudioBusiness & { is_demo: boolean };
  const [{ data: studioRow }, refs, { data: briefs }, status] = await Promise.all([
    db.from("design_studios").select("*").eq("business_id", businessId).eq("organisation_id", ctx.organisationId).maybeSingle(),
    loadReferences(db, ctx.organisationId, business),
    db.from("design_briefs").select("id, brief, generated_by, created_at").eq("business_id", businessId).eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(6),
    integrationStatus(db, ctx.organisationId),
  ]);
  const studio = studioRow as Studio | null;
  const industry = industryById(business.industry_id);
  const siteType = studio?.site_type ?? defaultSiteType(business.industry_id, industry?.sector ?? business.sector, business.category);
  const signed = await signedUploadUrls(db, refs);
  const imageFor = (r: ReferenceRow) => (r.storage_path ? signed[r.storage_path] ?? null : r.image_url);
  const byId = new Map(refs.map((r) => [r.id, r]));
  const picks = (studio?.picks ?? []).filter((p) => byId.has(p.reference_id));
  const pickedFor = new Map(picks.map((p) => [p.reference_id, p.section]));
  const questions = studio?.questions ?? [];
  const answered = questions.filter((q) => q.answer).length;
  const latest = briefs?.[0];
  const editable = canWrite(ctx.role);
  const hidden = { businessId };
  const loved = refs.filter((r) => r.verdict === "loved").length;
  const rejected = refs.filter((r) => r.verdict === "rejected").length;
  const pinterestLive = status.pinterest.mode === "live";
  const aiLive = status.anthropic.mode === "live";
  const refTitles = Object.fromEntries(refs.map((r) => [r.id, r.title ?? r.attribution ?? "Reference"]));

  return (
    <>
      <PageHeader
        title={`Design studio: ${business.name}`}
        description={<>{industry?.label ?? business.category ?? "Business"}{business.city ? ` in ${business.city}` : ""} <DemoBadge show={business.is_demo} /> · <Link href={`/leads/${businessId}`} className="text-primary hover:underline">lead record</Link> · References are inspiration only: we take mood, rhythm and colour temperature, never layouts, imagery, logos or wording.</>}
      />

      <div className="space-y-10">
        <Card>
          <CardHeader><CardTitle>Idea and site type</CardTitle><CardDescription>The site type sets the page sections each pick should cover.</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={saveStudioSetup} submitLabel="Save" disabled={!editable} className="grid gap-4 md:grid-cols-[2fr_1fr_auto] md:items-end">
              <input type="hidden" name="businessId" value={businessId} />
              <Field label="Idea (optional)" htmlFor="idea" hint="For example: “calm and premium, lots of white space, like a boutique hotel”."><Textarea id="idea" name="idea" rows={2} defaultValue={studio?.idea ?? ""} maxLength={600} /></Field>
              <Field label="Site type" htmlFor="siteType"><Select id="siteType" name="siteType" defaultValue={siteType}>{SITE_TYPE_IDS.map((t) => <option key={t} value={t}>{SITE_TYPES[t].label}</option>)}</Select></Field>
            </ActionForm>
            <p className="mt-2 text-xs text-muted-foreground">Sections: {SITE_TYPES[siteType].sections.join(" · ")}</p>
          </CardContent>
        </Card>

        <Step n={1} title="Collect references" done={refs.length >= 3} description={`${refs.length} references · ${loved} loved · ${rejected} rejected. Love what you like; rejected references are never picked.`}>
          <div className="mb-4 grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Card>
              <CardHeader><CardTitle className="text-base">From Pinterest</CardTitle><CardDescription>{pinterestLive ? "Reads the board assigned to this sector, 12 pins at a time." : "Not connected. Connect it under Integrations, then assign boards on the Design Research page."}</CardDescription></CardHeader>
              <CardContent><ActionButton action={collectPinsAction} hidden={hidden} label={refs.some((r) => r.kind === "pin") ? "Collect more pins" : "Collect pins"} disabled={!editable || !pinterestLive} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Add a website</CardTitle><CardDescription>We read its fonts, colours and preview image.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 border-b pb-3">
                  <ActionButton action={discoverSitesAction} hidden={hidden} label="Find sites for me" variant="outline" disabled={!editable || !aiLive} title={aiLive ? "Claude searches the web for well-designed sites of this kind (up to 5 searches, usually under $0.20)" : "Needs Claude: add your Anthropic key under Integrations"} />
                  <span className="text-xs text-muted-foreground">{aiLive ? "Up to 6 sites via web search. Usually under $0.20." : "Needs Claude to be connected."}</span>
                </div>
                <ActionForm action={addSiteAction} submitLabel="Add site" disabled={!editable} className="space-y-2">
                  <input type="hidden" name="businessId" value={businessId} />
                  <Input name="url" type="url" required placeholder="https://…" aria-label="Website address" />
                  <Input name="notes" placeholder="What you like about it (optional)" aria-label="Notes" maxLength={600} />
                </ActionForm>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Upload a picture</CardTitle><CardDescription>PNG, JPEG or WebP up to 2 MB. Stored privately.</CardDescription></CardHeader>
              <CardContent>
                <ActionForm action={uploadAction} submitLabel="Upload" disabled={!editable} className="space-y-2">
                  <input type="hidden" name="businessId" value={businessId} />
                  <Input name="file" type="file" accept="image/png,image/jpeg,image/webp" required aria-label="Picture" />
                  <Input name="notes" placeholder="What to take from it (optional)" aria-label="Picture notes" maxLength={600} />
                  <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="rights" className="mt-0.5" required /> I have the right to use this picture as a reference.</label>
                </ActionForm>
              </CardContent>
            </Card>
          </div>
          {refs.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {refs.map((r) => <ReferenceCard key={r.id} r={r} businessId={businessId} imageSrc={imageFor(r)} pickedFor={pickedFor.get(r.id)} canEdit={editable} />)}
            </div>
          ) : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No references yet. Add a website or a picture above{pinterestLive ? ", or collect pins" : ""}.</p>}
        </Step>

        <Step n={2} title="Pick references" done={picks.length > 0} description={picks.length ? <>Round {studio?.round ?? 1} · {studio?.picked_by === "ai" ? "picked by Claude" : "picked by simple rules (Claude not connected)"}. Re-pick for a fresh set that keeps what you loved.</> : "Up to five references, one for each section of the page."}>
          <div className="mb-3 flex flex-wrap gap-2">
            <ActionButton action={pickAction} hidden={hidden} label={picks.length ? "Pick again" : "Pick references"} disabled={!editable || refs.length === 0} />
            {picks.length > 0 && <ActionButton action={pickAction} hidden={{ ...hidden, round: "new" }} label="New round" variant="outline" disabled={!editable} />}
          </div>
          {picks.length > 0 && (
            <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {picks.map((p) => {
                const r = byId.get(p.reference_id)!;
                const img = imageFor(r);
                return (
                  <li key={p.reference_id} className="overflow-hidden rounded-xl border bg-card" data-testid="pick">
                    <div className="aspect-[4/3] bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element -- hot-linked reference thumbnail */}
                      {img ? <img src={img} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : <div className="flex size-full">{(r.analysis?.facts?.colours ?? ["#d9d3c7"]).map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}</div>}
                    </div>
                    <div className="space-y-1 p-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p.section}</p>
                      <p className="line-clamp-1 font-medium">{r.title ?? r.attribution}</p>
                      <p className="text-xs text-muted-foreground">{p.reason}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Step>

        <Step n={3} title="Answer a few questions" done={questions.length > 0 && answered === questions.length} description={questions.length ? `${answered} of ${questions.length} answered · ${studio?.questions_by === "ai" ? "written by Claude from your picks" : "standard questions (Claude not connected)"}. Your answers override the defaults in the brief.` : "Short multiple-choice questions that settle the direction."}>
          {questions.length === 0 ? (
            <ActionButton action={questionsAction} hidden={hidden} label="Prepare questions" disabled={!editable} />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <ActionForm action={answersAction} submitLabel="Save answers" disabled={!editable}>
                  <input type="hidden" name="businessId" value={businessId} />
                  {questions.map((q) => {
                    const other = q.answer && !q.options.includes(q.answer) ? q.answer : "";
                    return (
                      <fieldset key={q.id} className="space-y-2">
                        <legend className="text-sm font-medium">{q.question}</legend>
                        <div className="flex flex-wrap gap-2">
                          {q.options.map((o) => (
                            <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent">
                              <input type="radio" name={`q_${q.id}`} value={o} defaultChecked={q.answer === o} /> {o}
                            </label>
                          ))}
                          <label className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent">
                            <input type="radio" name={`q_${q.id}`} value="__other" defaultChecked={Boolean(other)} /> Other:
                            <input name={`q_${q.id}_other`} defaultValue={other} className="w-40 bg-transparent outline-none" aria-label={`Other answer to: ${q.question}`} maxLength={200} />
                          </label>
                        </div>
                      </fieldset>
                    );
                  })}
                </ActionForm>
                <div className="mt-3"><ActionButton action={questionsAction} hidden={hidden} label="Ask different questions" variant="ghost" disabled={!editable} confirm="Replace these questions and their answers?" /></div>
              </CardContent>
            </Card>
          )}
        </Step>

        <Step n={4} title="Creative brief" done={Boolean(latest)} description={latest ? <>Latest version {formatDate(latest.created_at, true)} · <Badge variant={latest.generated_by === "ai" ? "default" : "secondary"}>{latest.generated_by === "ai" ? "Written by Claude" : latest.generated_by === "manual" ? "Edited by your team" : "Sector preset + your choices"}</Badge></> : "Uses your picks and answers. Every version is kept, and the website builder uses the latest one."}>
          <div className="mb-4 flex flex-wrap gap-2">
            <ActionButton action={briefAction} hidden={hidden} label={latest ? "Write a new brief" : "Create brief"} disabled={!editable} />
            {latest && <ActionButton action={buildSiteAction} hidden={hidden} label="Build prototype" variant="outline" disabled={!editable} />}
          </div>
          {latest && (
            <div className="space-y-5">
              <BriefView b={latest.brief as DesignBrief} refTitles={refTitles} />
              {editable && (
                <details className="rounded-xl border bg-card p-4" data-testid="brief-editor">
                  <summary className="cursor-pointer text-sm font-medium">Edit this brief</summary>
                  <div className="mt-4"><BriefEditor businessId={businessId} brief={latest.brief as DesignBrief} /></div>
                </details>
              )}
              {(briefs?.length ?? 0) > 1 && (
                <div className="text-sm">
                  <p className="font-medium">Earlier versions</p>
                  <ul className="text-muted-foreground">{briefs!.slice(1).map((v) => <li key={v.id}>{formatDate(v.created_at, true)} · {v.generated_by === "ai" ? "Claude" : v.generated_by === "manual" ? "edited" : "preset"}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </Step>
      </div>
    </>
  );
}
