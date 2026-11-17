import type { Metadata } from "next";
import Link from "next/link";
import { CloudUpload, ExternalLink } from "lucide-react";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { env } from "@/lib/env";
import { integrationStatus } from "@/lib/integrations";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/app/action-button";
import { DemoBadge } from "@/components/app/badges";
import { formatDate } from "@/lib/utils";
import { deployWebsiteAction, recheckDeploymentAction, removeDeploymentAction } from "./actions";

export const metadata: Metadata = { title: "Cloudflare Deployments" };
// Deploying uploads the site and waits for it to be live: allow up to 5 minutes.
export const maxDuration = 300;

const TONE: Record<string, "success" | "warning" | "destructive" | "secondary" | "default"> = { verified: "success", succeeded: "warning", uploading: "default", pending: "secondary", failed: "destructive", removed: "secondary" };
const LABEL: Record<string, string> = { verified: "Live", succeeded: "Not confirmed", uploading: "Uploading", pending: "Starting", failed: "Failed", removed: "Taken offline" };

type Rec = { id: string; website_id: string; version_id: string; status: string; url: string | null; error: string | null; created_at: string; verified_at: string | null; removed_at: string | null; project_name: string; businesses: { name: string; is_demo: boolean } | null; website_versions: { version: number } | null; requester: { full_name: string | null; email: string } | null };

export default async function DeploymentsPage() {
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const [{ data: ready }, { data: records, error }, status] = await Promise.all([
    db.from("generated_websites").select("id, status, current_version_id, businesses!inner(name, is_demo, city), website_versions!generated_websites_current_version_fk(version)").eq("organisation_id", ctx.organisationId).eq("status", "approved").order("updated_at", { ascending: false }).limit(50),
    db.from("deployment_records").select("id, website_id, version_id, status, url, error, created_at, verified_at, removed_at, project_name, businesses!inner(name, is_demo), website_versions(version), requester:users!deployment_records_requested_by_fkey(full_name, email)").eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(100),
    integrationStatus(db, ctx.organisationId),
  ]);
  if (error) throw error;
  const recs = (records ?? []) as unknown as Rec[];
  const { data: sites } = await db.from("generated_websites").select("id, current_version_id").in("id", [...new Set(recs.map((r) => r.website_id))]);
  const currentOf = new Map((sites ?? []).map((s) => [s.id, s.current_version_id]));

  // Latest record per website decides what is live or needs attention.
  const latest = new Map<string, Rec>();
  for (const r of recs) if (!latest.has(r.website_id)) latest.set(r.website_id, r);
  const live = [...latest.values()].filter((r) => r.status === "verified");
  const attention = [...latest.values()].filter((r) => r.status === "failed" || r.status === "succeeded");
  const canDeploy = roleAtLeast(ctx.role, "administrator");
  const connected = status.cloudflare.mode === "live";
  const serviceReady = Boolean(env.supabaseServiceRoleKey);
  const readyToDeploy = (ready ?? []).filter((s) => latest.get(s.id)?.status !== "uploading");

  return (
    <>
      <PageHeader title="Cloudflare Deployments" description="Approved concepts are published on Cloudflare at a workers.dev address, marked noindex. A deployment counts as live only when Cloudflare accepts it and the address serves exactly the approved version." />

      {!connected && <Alert variant="warning" className="mb-5"><AlertDescription>Cloudflare isn&apos;t connected, so nothing can be deployed. <Link href="/integrations" className="font-medium underline">Connect it under Integrations</Link> with your account ID and an API token that can edit Workers scripts.</AlertDescription></Alert>}
      {connected && !serviceReady && <Alert variant="warning" className="mb-5"><AlertDescription>Deployment also needs SUPABASE_SERVICE_ROLE_KEY in the server&apos;s environment variables (Vercel). Add it and redeploy the app.</AlertDescription></Alert>}

      {!recs.length && !readyToDeploy.length ? (
        <EmptyState icon={CloudUpload} title="Nothing to deploy yet">Approve a prototype under <Link href="/approvals" className="underline">Prototype Approvals</Link>; it then appears here, ready to deploy.</EmptyState>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_400px] [&>*]:min-w-0">
          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle>Ready to deploy ({readyToDeploy.length})</CardTitle><CardDescription>{canDeploy ? "Approved and not yet live. Deploying takes up to a minute." : "Only owners and administrators can deploy."}</CardDescription></CardHeader>
              <CardContent>
                {readyToDeploy.length ? (
                  <ul className="divide-y" data-testid="ready">
                    {readyToDeploy.map((s) => {
                      const b = s.businesses as unknown as { name: string; is_demo: boolean; city: string | null };
                      const v = s.website_versions as unknown as { version: number } | null;
                      return (
                        <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 font-medium">{b.name}<DemoBadge show={b.is_demo} /></p><p className="text-xs text-muted-foreground">{b.city ?? ""} · approved version {v?.version ?? "?"} · <Link href={`/approvals/${s.id}`} className="text-primary hover:underline">review</Link></p></div>
                          {canDeploy && <ActionButton action={deployWebsiteAction} hidden={{ websiteId: s.id }} label="Deploy" pendingLabel="Deploying…" disabled={!connected || !serviceReady} confirm={`Publish ${b.name}'s approved concept on Cloudflare? It will be reachable by anyone with the address (not listed in search engines).`} />}
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">Nothing is waiting to be deployed.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Live ({live.length})</CardTitle></CardHeader>
              <CardContent>
                {live.length ? (
                  <ul className="divide-y" data-testid="live">
                    {live.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-medium">{r.businesses?.name}<DemoBadge show={Boolean(r.businesses?.is_demo)} /></p>
                          {r.url && <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-sm text-primary hover:underline">{r.url}<ExternalLink className="size-3.5 shrink-0" /></a>}
                          <p className="text-xs text-muted-foreground">version {r.website_versions?.version ?? "?"} · confirmed {formatDate(r.verified_at ?? r.created_at, true)}{r.requester ? ` · by ${r.requester.full_name ?? r.requester.email}` : ""}{currentOf.get(r.website_id) !== r.version_id ? " · a newer version exists (approve it, then deploy again)" : ""}</p>
                        </div>
                        {canDeploy && <ActionButton action={removeDeploymentAction} hidden={{ websiteId: r.website_id }} label="Take offline" variant="outline" confirm="Take this concept offline? The address stops working straight away. The approval and history are kept, and you can deploy it again." />}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">Nothing is live.</p>}
              </CardContent>
            </Card>

            {attention.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Needs attention</CardTitle><CardDescription>The last attempt failed, or Cloudflare accepted it but the address couldn&apos;t be confirmed yet.</CardDescription></CardHeader>
                <CardContent>
                  <ul className="divide-y" data-testid="attention">
                    {attention.map((r) => (
                      <li key={r.id} className="space-y-2 py-3">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.businesses?.name}</span><Badge variant={TONE[r.status]}>{LABEL[r.status]}</Badge></div>
                        {r.error && <p className="text-sm text-muted-foreground">{r.error}</p>}
                        {canDeploy && (
                          <div className="flex flex-wrap gap-2">
                            {r.url && <ActionButton action={recheckDeploymentAction} hidden={{ recordId: r.id }} label="Check again" variant="outline" />}
                            {r.status === "failed" && currentOf.get(r.website_id) === r.version_id && <ActionButton action={deployWebsiteAction} hidden={{ websiteId: r.website_id }} label="Deploy again" pendingLabel="Deploying…" disabled={!connected || !serviceReady} />}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              {recs.length ? (
                <ol className="space-y-3 text-sm" data-testid="history">
                  {recs.slice(0, 40).map((r) => (
                    <li key={r.id}>
                      <div className="flex flex-wrap items-center gap-2"><Badge variant={TONE[r.status]}>{LABEL[r.status] ?? r.status}</Badge><Link href={`/approvals/${r.website_id}`} className="font-medium hover:underline">{r.businesses?.name ?? "Website"}</Link></div>
                      <p className="text-xs text-muted-foreground">version {r.website_versions?.version ?? "?"} · {formatDate(r.created_at, true)}{r.removed_at ? ` · taken offline ${formatDate(r.removed_at, true)}` : ""}</p>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-muted-foreground">No deployments yet.</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
