import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/app/action-button";
import { DemoBadge, StatusBadge } from "@/components/app/badges";
import type { QaCheck } from "@/lib/qa/checks";
import type { SiteFiles, SiteSpec } from "@/lib/sites/spec";
import { DECISION_LABEL, notReadyReason, type Decision } from "@/lib/approvals/review";
import { formatDate } from "@/lib/utils";
import { PreviewFrame } from "../../builder/[id]/preview-frame";
import { decideWebsiteAction, recheckWebsiteAction } from "../actions";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Review prototype" };
// Re-running the checks starts a browser; allow time for it.
export const maxDuration = 300;

const QA_TONE: Record<string, "success" | "destructive" | "warning" | "secondary"> = { pass: "success", fail: "destructive", warn: "warning", skipped: "secondary" };
const DECISION_TONE: Record<Decision, "success" | "warning" | "destructive"> = { approved: "success", changes_requested: "warning", rejected: "destructive" };

export default async function ReviewPage({ params }: { params: Promise<{ websiteId: string }> }) {
  const { websiteId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(websiteId)) notFound();
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const { data: site } = await db.from("generated_websites").select("id, status, current_version_id, business_id, businesses(id, name, is_demo, phone, email, address, city, postal_code, website_url)").eq("id", websiteId).eq("organisation_id", ctx.organisationId).maybeSingle();
  if (!site) notFound();
  const biz = site.businesses as unknown as { id: string; name: string; is_demo: boolean; phone: string | null; email: string | null; address: string | null; city: string | null; postal_code: string | null; website_url: string | null };

  const [{ data: current }, { data: qa }, { data: history }, { data: sources }, { data: build }] = await Promise.all([
    site.current_version_id ? db.from("website_versions").select("id, version, spec, files, generated_by, change_note, created_at").eq("id", site.current_version_id).single() : Promise.resolve({ data: null }),
    site.current_version_id ? db.from("quality_reports").select("passed, checks, created_at").eq("version_id", site.current_version_id).order("created_at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    db.from("approvals").select("id, decision, comment, decided_at, version_id, users(full_name, email)").eq("subject_type", "website").eq("subject_id", websiteId).order("decided_at", { ascending: false }).limit(20),
    db.from("business_sources").select("provider, source_url, attribution, fetched_at").eq("business_id", site.business_id).order("fetched_at", { ascending: false }).limit(3),
    site.current_version_id ? db.from("site_builds").select("summary, instruction, kind").eq("result_version_id", site.current_version_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: versionRows } = await db.from("website_versions").select("id, version").eq("website_id", websiteId);
  const versionNo = new Map((versionRows ?? []).map((v) => [v.id, v.version]));
  const { data: previewToken } = current ? await db.rpc("sign_preview", { p_version: current.id }) : { data: null };

  const spec = current?.spec as SiteSpec | undefined;
  const files = (current?.files ?? {}) as SiteFiles;
  const pages = Object.keys(files).filter((f) => f.endsWith(".html")).sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
  const checks = (qa?.checks ?? []) as QaCheck[];
  const images = Object.values(spec?.images ?? {});
  const aiImages = images.filter((i) => i.aiGenerated).length;
  const stockImages = images.filter((i) => i.credit).length;
  const canDecide = roleAtLeast(ctx.role, "administrator");
  const canRecheck = roleAtLeast(ctx.role, "staff");
  const waiting = site.status === "awaiting_approval";
  const reason = notReadyReason({ status: site.status, qaPassed: qa ? qa.passed : null, generatedBy: current?.generated_by ?? null, isDemoBusiness: biz.is_demo });
  const lastAsk = history?.find((h) => h.decision !== "approved" && h.comment);
  const { data: liveRec } = await db.from("deployment_records").select("url, version_id").eq("website_id", websiteId).eq("status", "verified").order("created_at", { ascending: false }).limit(1).maybeSingle();

  return (
    <>
      <PageHeader
        title={`Review: ${biz.name}`}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={site.status} /><DemoBadge show={biz.is_demo} />{current && <Badge variant="secondary">Version {current.version}</Badge>}<Link href={`/builder/${websiteId}`} className="text-primary hover:underline">open in builder</Link><Link href={`/leads/${biz.id}`} className="text-primary hover:underline">lead</Link></span>}
        actions={canRecheck && current && <ActionButton action={recheckWebsiteAction} hidden={{ websiteId }} label="Run checks again" variant="outline" />}
      />

      {!current ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">This website has no version yet.</CardContent></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
          <div className="space-y-5">
            <PreviewFrame base={previewToken ? `/api/preview/${current.id}/~${previewToken}` : `/api/preview/${current.id}`} versionKey={current.id} pages={pages} />
            <Card>
              <CardHeader><CardTitle>About this version</CardTitle><CardDescription>Version {current.version} · {current.change_note} · {formatDate(current.created_at, true)}</CardDescription></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {build?.instruction && <p><span className="font-medium">Change asked for:</span> {build.instruction}</p>}
                {(build?.summary ?? spec?.summary) && <p><span className="font-medium">Builder&apos;s summary:</span> {build?.summary ?? spec?.summary}</p>}
                <p className="text-muted-foreground">{pages.length} page{pages.length === 1 ? "" : "s"} · {aiImages} AI-generated image{aiImages === 1 ? "" : "s"} · {stockImages} stock photo{stockImages === 1 ? "" : "s"}</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-5">
            {waiting ? (
              canDecide ? (
                <Card data-testid="decision-card">
                  <CardHeader><CardTitle>Your decision</CardTitle><CardDescription>Look through every page in the preview, compare it with the verified details below, then decide.</CardDescription></CardHeader>
                  <CardContent>
                    {lastAsk && <Alert variant="info" className="mb-4"><AlertDescription>Last time ({DECISION_LABEL[lastAsk.decision as Decision].toLowerCase()} on version {versionNo.get(lastAsk.version_id ?? "") ?? "?"}): {lastAsk.comment}</AlertDescription></Alert>}
                    <ReviewForm action={decideWebsiteAction} websiteId={websiteId} versionId={current.id} versionLabel={`version ${current.version}`} />
                  </CardContent>
                </Card>
              ) : (
                <Alert variant="info"><AlertDescription>Waiting for an owner or administrator to review it. Your role ({ctx.role.replace("_", " ")}) can view it but not decide.</AlertDescription></Alert>
              )
            ) : (
              <Alert variant={site.status === "approved" || site.status === "deployed" ? "success" : "info"} data-testid="not-waiting">
                <AlertDescription className="space-y-2">
                  <p>{site.status === "deployed" && liveRec?.url ? <>Live at <a href={liveRec.url} target="_blank" rel="noreferrer noopener" className="font-medium underline">{liveRec.url}</a>.</> : reason}</p>
                  {(site.status === "approved" || site.status === "deployed") && <p><Link href="/deployments" className="text-sm font-medium underline">{site.status === "approved" ? "Deploy it from Deployments" : "Deployments"}</Link></p>}
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader><CardTitle>Verified details</CardTitle><CardDescription>The only facts the site may state about the business. Check the preview against these.</CardDescription></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm" data-testid="verified-facts">
                  <dt className="text-muted-foreground">Name</dt><dd>{biz.name}</dd>
                  <dt className="text-muted-foreground">Phone</dt><dd>{biz.phone ?? <span className="text-muted-foreground">not known (must not appear)</span>}</dd>
                  <dt className="text-muted-foreground">Email</dt><dd>{biz.email ?? <span className="text-muted-foreground">not known (must not appear)</span>}</dd>
                  <dt className="text-muted-foreground">Address</dt><dd>{[biz.address, biz.city, biz.postal_code].filter(Boolean).join(", ") || <span className="text-muted-foreground">not known (must not appear)</span>}</dd>
                  <dt className="text-muted-foreground">Current site</dt><dd className="break-all">{biz.website_url ? <a href={biz.website_url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{biz.website_url}</a> : "none found"}</dd>
                  <dt className="text-muted-foreground">Source</dt>
                  <dd>{sources?.length ? sources.map((s) => <span key={`${s.provider}-${s.fetched_at}`} className="block">{s.source_url ? <a href={s.source_url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">{s.attribution ?? s.provider}</a> : (s.attribution ?? s.provider)} · {formatDate(s.fetched_at)}</span>) : "added by hand"}</dd>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Quality checks</CardTitle><CardDescription>{qa ? `${qa.passed ? "All required checks passed" : "Some required checks failed"} · ${formatDate(qa.created_at, true)}` : "Not checked yet."}</CardDescription></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm" data-testid="qa-list">
                  {checks.map((c) => (
                    <li key={c.id}>
                      <div className="flex items-center justify-between gap-2"><span>{c.label}</span><Badge variant={QA_TONE[c.status]}>{c.status}</Badge></div>
                      {c.status !== "pass" && c.details.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{c.details.slice(0, 5).map((d) => <li key={d}>{d}</li>)}{c.details.length > 5 && <li>…and {c.details.length - 5} more</li>}</ul>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Decision history</CardTitle></CardHeader>
              <CardContent>
                {history?.length ? (
                  <ol className="space-y-3 text-sm" data-testid="decision-history">
                    {history.map((h) => {
                      const who = h.users as unknown as { full_name: string | null; email: string } | null;
                      return (
                        <li key={h.id}>
                          <div className="flex flex-wrap items-center gap-2"><Badge variant={DECISION_TONE[h.decision as Decision]}>{DECISION_LABEL[h.decision as Decision]}</Badge><span className="text-xs text-muted-foreground">version {versionNo.get(h.version_id ?? "") ?? "?"} · {who?.full_name ?? who?.email ?? "someone"} · {formatDate(h.decided_at, true)}</span></div>
                          {h.comment && <p className="mt-1">{h.comment}</p>}
                        </li>
                      );
                    })}
                  </ol>
                ) : <p className="text-sm text-muted-foreground">No decisions yet.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
