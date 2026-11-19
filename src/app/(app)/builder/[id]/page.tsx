import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext, canApprove, canWrite } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/app/action-button";
import { ActionForm } from "@/components/app/action-form";
import { Textarea } from "@/components/ui/textarea";
import { DemoBadge, StatusBadge } from "@/components/app/badges";
import { integrationStatus } from "@/lib/integrations";
import type { QaCheck } from "@/lib/qa/checks";
import type { SiteFiles, SiteSpec } from "@/lib/sites/spec";
import { formatDate } from "@/lib/utils";
import { PreviewFrame } from "./preview-frame";
import { buildRestAction, buildSiteAction, deleteWebsiteAction, restoreVersion, reviseMotionAction, reviseSiteAction, stopBuildAction } from "../actions";
import { recheckWebsiteAction } from "../../approvals/actions";
import { DECISION_LABEL, notReadyReason, type Decision } from "@/lib/approvals/review";

// Server actions here can run a builder step or a web search: allow up to 5 minutes.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Website" };

const QA_TONE: Record<string, "success" | "destructive" | "warning" | "secondary"> = { pass: "success", fail: "destructive", warn: "warning", skipped: "secondary" };

export default async function WebsitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const { data: site } = await db.from("generated_websites").select("id, slug, status, business_id, current_version_id, businesses!inner(id, name, is_demo)").eq("id", id).eq("organisation_id", ctx.organisationId).maybeSingle();
  if (!site) notFound();
  const biz = site.businesses as unknown as { id: string; name: string; is_demo: boolean };
  const [{ data: versions }, { data: builds }, { data: current }, { data: qa }, status] = await Promise.all([
    db.from("website_versions").select("id, version, generated_by, change_note, created_at, spec->kind").eq("website_id", id).order("version", { ascending: false }).limit(30),
    db.from("site_builds").select("id, kind, status, instruction, turns, cost_usd, activity, error, summary, suggestions, created_at, finished_at, direction, direction_summary").eq("website_id", id).order("created_at", { ascending: false }).limit(5),
    site.current_version_id ? db.from("website_versions").select("id, version, spec, files, generated_by").eq("id", site.current_version_id).single() : Promise.resolve({ data: null }),
    site.current_version_id ? db.from("quality_reports").select("passed, checks, created_at").eq("version_id", site.current_version_id).order("created_at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    integrationStatus(db, ctx.organisationId),
  ]);
  const { data: lastDecision } = await db.from("approvals").select("decision, comment, decided_at, version_id").eq("subject_type", "website").eq("subject_id", id).order("decided_at", { ascending: false }).limit(1).maybeSingle();
  const spec = current?.spec as SiteSpec | undefined;
  // Short-lived signed preview link (the sandboxed frame sends no cookies for its assets).
  const { data: previewToken } = current ? await db.rpc("sign_preview", { p_version: current.id }) : { data: null };
  const pages = current ? Object.keys(current.files as SiteFiles).filter((f) => f.endsWith(".html")).sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b))) : [];
  const active = builds?.find((b) => b.status === "queued" || b.status === "running");
  const lastDone = builds?.find((b) => b.status !== "queued" && b.status !== "running");
  const editable = canWrite(ctx.role);
  const aiLive = status.anthropic.mode === "live";
  const isTemplate = spec?.kind !== "bespoke";
  const checks = (qa?.checks ?? []) as QaCheck[];

  return (
    <>
      <PageHeader
        title={biz.name}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={site.status} /><DemoBadge show={biz.is_demo} />{current && <Badge variant="secondary">Version {current.version} · {current.generated_by === "ai" ? "built by Claude" : current.generated_by === "demo" ? "template demo" : "edited"}</Badge>}<Link href={`/leads/${biz.id}`} className="text-primary hover:underline">lead</Link><Link href={`/design-research/${biz.id}`} className="text-primary hover:underline">design studio</Link></span>}
        actions={editable && !active && (
          <span className="flex flex-wrap gap-2">
            <ActionButton action={buildSiteAction} hidden={{ businessId: biz.id, scope: "home" }} label={current ? "New homepage from the brief" : "Build homepage first"} variant={current ? "outline" : "default"} confirm={current ? "Build a fresh homepage from the brief? The current version is kept in the history." : undefined} />
            <ActionButton action={buildSiteAction} hidden={{ businessId: biz.id, scope: "full" }} label={current ? "Whole site from the brief" : "Build whole site"} variant="outline" confirm={current ? "Build a fresh whole site from the brief? The current version is kept in the history." : undefined} />
          </span>
        )}
      />

      {current && isTemplate && current.generated_by === "demo" && (
        <Alert variant="info" className="mb-5"><AlertDescription>{biz.is_demo ? "Template demo of a fictional business, for trying the workflow." : "This is a template demo made because Claude isn't connected. It's for testing only and can't be sent for approval. Connect Claude under Integrations, then build the real site."}</AlertDescription></Alert>
      )}

      {active && (
        <Card className="mb-5" data-testid="active-build">
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div><CardTitle>{active.kind === "revision" ? "Revising" : "Building"}…</CardTitle><CardDescription>{active.instruction ? `“${active.instruction}” · ` : ""}{active.turns} steps · ${Number(active.cost_usd).toFixed(2)} so far · updates while this page is open</CardDescription></div>
            {editable && <ActionButton action={stopBuildAction} hidden={{ buildId: active.id }} label="Stop" variant="outline" confirm="Stop this build? The draft so far is kept with the build." />}
          </CardHeader>
          <CardContent><Activity items={active.activity as { at: string; text: string }[]} /></CardContent>
        </Card>
      )}
      {!active && lastDone && (lastDone.status === "failed" || lastDone.status === "stopped") && (
        <Alert variant={lastDone.status === "failed" ? "destructive" : "info"} className="mb-5"><AlertDescription>Last build {lastDone.status === "failed" ? "failed" : "was stopped"} {formatDate(lastDone.finished_at ?? lastDone.created_at, true)}.{lastDone.error ? ` ${lastDone.error}` : ""}</AlertDescription></Alert>
      )}

      {current ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px] [&>*]:min-w-0">
          <PreviewFrame base={previewToken ? `/api/preview/${current.id}/~${previewToken}` : `/api/preview/${current.id}`} versionKey={current.id} pages={pages} />
          <div className="space-y-5">
            {spec?.scope === "home" && (
              <Card data-testid="homepage-draft" className="border-primary/40">
                <CardHeader><CardTitle>Homepage draft</CardTitle><CardDescription>Agree the look here first. Use Revise as often as you like (other pages are placeholders for now). When you are happy, build the rest of the site in this design; the full site then goes to approval.</CardDescription></CardHeader>
                {editable && <CardContent><ActionButton action={buildRestAction} hidden={{ websiteId: id }} label="Homepage agreed: build the rest of the site" disabled={!aiLive || Boolean(active)} confirm={`Build the other pages (${(spec.plannedPages ?? []).filter((p) => p.file !== "index.html").map((p) => p.label).join(", ") || "as planned"}) in this homepage's design?`} /></CardContent>}
              </Card>
            )}
            <Card data-testid="approval-card">
              <CardHeader><CardTitle>Approval</CardTitle><CardDescription>{spec?.scope === "home" ? "A homepage draft can't be sent for approval. Build the rest of the site first." : site.status === "awaiting_approval" ? "Passed its checks and waiting for an owner or administrator." : notReadyReason({ status: site.status, qaPassed: qa ? qa.passed : null, generatedBy: current.generated_by, isDemoBusiness: biz.is_demo })}</CardDescription></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {lastDecision && (
                  <div>
                    <p className="font-medium">{DECISION_LABEL[lastDecision.decision as Decision]} {formatDate(lastDecision.decided_at, true)}{lastDecision.version_id && lastDecision.version_id !== current.id ? " (an earlier version)" : ""}</p>
                    {lastDecision.comment && <p className="text-muted-foreground">{lastDecision.comment}</p>}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link href={`/approvals/${id}`} className="font-medium text-primary hover:underline">{site.status === "awaiting_approval" ? "Review for approval" : "Approval details"}</Link>
                  {(site.status === "approved" || site.status === "deployed") && <Link href="/deployments" className="font-medium text-primary hover:underline">{site.status === "deployed" ? "Live site" : "Deploy"}</Link>}
                  {editable && spec?.kind === "bespoke" && aiLive && !active && lastDecision?.decision === "changes_requested" && lastDecision.comment && site.status === "changes_requested" && (
                    <ActionButton action={reviseSiteAction} hidden={{ websiteId: id, instruction: lastDecision.comment }} label="Revise with this feedback" variant="outline" />
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Quality checks</CardTitle><CardDescription>{qa ? (qa.passed ? "All required checks passed." : "Some checks failed; it can't be approved until they pass.") : "Not checked yet."}</CardDescription></CardHeader>
              <CardContent>
                {editable && !active && <div className="mb-3"><ActionButton action={recheckWebsiteAction} hidden={{ websiteId: id }} label="Run checks again" variant="outline" /></div>}
                <ul className="space-y-2 text-sm" data-testid="qa-list">
                  {checks.map((c) => (
                    <li key={c.id}>
                      <div className="flex items-center justify-between gap-2"><span>{c.label}</span><Badge variant={QA_TONE[c.status]}>{c.status}</Badge></div>
                      {c.status !== "pass" && c.details.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{c.details.slice(0, 4).map((d) => <li key={d}>{d}</li>)}{c.details.length > 4 && <li>…and {c.details.length - 4} more</li>}</ul>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {spec?.kind === "bespoke" && (
              <Card>
                <CardHeader><CardTitle>Revise</CardTitle><CardDescription>Tell the builder what to change. It edits this version and saves a new one.</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {spec.summary && <p className="text-sm text-muted-foreground">{spec.summary}</p>}
                  {spec.suggestions?.length ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">Builder&apos;s suggestions</p>
                      {spec.suggestions.map((sug) => (
                        <div key={sug} className="flex items-start justify-between gap-2 text-sm"><span>{sug}</span>{editable && aiLive && !active && <ActionButton action={reviseSiteAction} hidden={{ websiteId: id, instruction: sug }} label="Apply" variant="ghost" />}</div>
                      ))}
                    </div>
                  ) : null}
                  {editable && (
                    <ActionForm action={reviseSiteAction} submitLabel="Revise" disabled={!aiLive || Boolean(active)}>
                      <input type="hidden" name="websiteId" value={id} />
                      <Textarea name="instruction" rows={3} maxLength={2000} placeholder="For example: make the hero calmer with more white space, and move the booking form higher." aria-label="Change to make" required />
                    </ActionForm>
                  )}
                  {editable && (
                    <div className="space-y-2 border-t pt-3" data-testid="motion-form">
                      <p className="text-xs font-medium">Add motion</p>
                      <p className="text-xs text-muted-foreground">Animates this version without changing its words or layout. Motion is switched off for visitors who ask their device for less motion.</p>
                      <ActionForm action={reviseMotionAction} submitLabel="Add motion" disabled={!aiLive || Boolean(active)}>
                        <input type="hidden" name="websiteId" value={id} />
                        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <legend className="sr-only">What should move</legend>
                          <label className="flex items-center gap-1.5"><input type="checkbox" name="area" value="hero" defaultChecked /> First screen</label>
                          <label className="flex items-center gap-1.5"><input type="checkbox" name="area" value="scroll" defaultChecked /> On scroll</label>
                          <label className="flex items-center gap-1.5"><input type="checkbox" name="area" value="hover" /> Hover</label>
                        </fieldset>
                        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          <legend className="sr-only">Strength</legend>
                          <label className="flex items-center gap-1.5"><input type="radio" name="strength" value="subtle" defaultChecked /> Subtle</label>
                          <label className="flex items-center gap-1.5"><input type="radio" name="strength" value="bold" /> Bold</label>
                        </fieldset>
                      </ActionForm>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0"><CardTitle>Versions</CardTitle>{canApprove(ctx.role) && !active && <ActionButton action={deleteWebsiteAction} hidden={{ websiteId: id }} label="Delete prototype" variant="ghost" confirm={`Delete this prototype for ${biz.name}, with every version and build? Approval decisions stay in the history. This can't be undone.`} />}</CardHeader>
              <CardContent>
                <ul className="divide-y text-sm" data-testid="versions">
                  {versions?.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div><p className="font-medium">Version {v.version}{v.id === site.current_version_id ? " (current)" : ""}</p><p className="text-xs text-muted-foreground">{v.change_note} · {formatDate(v.created_at, true)}</p></div>
                      <div className="flex items-center gap-2">
                        <a href={`/api/export/site/${v.id}`} className="text-xs text-primary hover:underline">Download</a>
                        {editable && v.id !== site.current_version_id && <ActionButton action={restoreVersion} hidden={{ websiteId: id, versionId: v.id }} label="Restore" variant="ghost" />}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {builds && builds.length > 0 && !active && lastDone && (
              <Card>
                <CardHeader><CardTitle>Last build</CardTitle><CardDescription>{lastDone.turns} steps · ${Number(lastDone.cost_usd).toFixed(2)}</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {lastDone.direction && (
                    <details className="rounded-md border p-3 text-sm" data-testid="direction">
                      <summary className="cursor-pointer font-medium">Art direction{lastDone.direction_summary ? `: ${lastDone.direction_summary}` : ""}</summary>
                      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">{lastDone.direction}</pre>
                    </details>
                  )}
                  <Activity items={lastDone.activity as { at: string; text: string }[]} />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : !active ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No version yet. {editable ? "Use Build site to start." : ""}</CardContent></Card>
      ) : null}
    </>
  );
}

function Activity({ items }: { items: { at: string; text: string }[] }) {
  const recent = items.slice(-14).reverse();
  return (
    <ol className="space-y-1 text-sm" aria-label="Build activity">
      {recent.map((a, i) => <li key={`${a.at}-${i}`} className="flex gap-3"><span className="w-14 shrink-0 tabular-nums text-xs text-muted-foreground">{new Date(a.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span><span>{a.text}</span></li>)}
    </ol>
  );
}
