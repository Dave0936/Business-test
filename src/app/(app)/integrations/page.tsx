import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { INTEGRATIONS, integrationStatus } from "@/lib/integrations";
import { supabaseConfigured, env } from "@/lib/env";
import { canApprove } from "@/lib/auth";
import { ActionForm } from "@/components/app/action-form";
import { ActionButton } from "@/components/app/action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { credentialFields } from "@/lib/integrations-verify";
import { checkOsmAction, connectIntegration, disconnectIntegration } from "./actions";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await getOrgContext();
  const [status, { data: conns }] = await Promise.all([
    integrationStatus(ctx.supabase, ctx.organisationId),
    ctx.supabase.from("integration_connections").select("provider, status, config, last_checked_at").eq("organisation_id", ctx.organisationId),
  ]);
  const admin = canApprove(ctx.role);
  const encryption = Boolean(env.encryptionKey);
  return (
    <>
      <PageHeader title="Integrations" description="Credentials are read on the server only and never sent to the browser. Missing integrations are shown as not connected; the app never pretends a call succeeded." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center justify-between">Supabase <Badge variant={supabaseConfigured() ? "success" : "destructive"}>{supabaseConfigured() ? "Connected" : "Missing"}</Badge></CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">Database, authentication and storage.</p>
            <p className="text-xs">Service role key for background jobs: {env.supabaseServiceRoleKey ? <span className="text-success">set</span> : <span className="text-destructive">missing</span>}</p>
            <p className="text-xs">Secret encryption key: {env.encryptionKey ? <span className="text-success">set</span> : <span className="text-destructive">missing</span>}</p>
          </CardContent>
        </Card>
        {INTEGRATIONS.map((i) => {
          const s = status[i.key];
          return (
            <Card key={i.key}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">{i.name}
                  <Badge variant={s.mode === "live" ? "success" : s.mode === "demo" ? "demo" : "secondary"}>{s.mode === "live" ? "Connected" : s.mode === "demo" ? "Demo mode" : "Not connected"}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{i.purpose}</p>
                <p className="text-muted-foreground">{s.mode === "live" ? `Using ${s.source} credentials.` : i.fallback}</p>
                <p className="text-xs text-muted-foreground">Environment: {i.envVars.map((v) => <code key={v} className="mr-1 rounded bg-muted px-1">{v}</code>)}</p>
                <a href={i.docs} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Setup documentation ↗</a>
                {i.key === "openstreetmap" && <div className="border-t pt-3"><ActionButton action={checkOsmAction} label="Check OpenStreetMap servers" variant="outline" /></div>}
                {(() => {
                  const fields = credentialFields(i.key);
                  const conn = conns?.find((c) => c.provider === i.key && c.status === "connected");
                  if (!fields.length || !admin) return null;
                  if (conn) return (
                    <div className="space-y-2 border-t pt-3">
                      <p className="text-xs text-success">Connected for this workspace. {(conn.config as { detail?: string }).detail ?? ""}</p>
                      <ActionButton action={disconnectIntegration} hidden={{ provider: i.key }} label="Disconnect" variant="outline" confirm={`Disconnect ${i.name}? The stored key is deleted.`} />
                    </div>
                  );
                  if (!encryption) return <p className="border-t pt-3 text-xs text-destructive">Set APP_ENCRYPTION_KEY on the server to store keys here.</p>;
                  return (
                    <details className="border-t pt-3">
                      <summary className="cursor-pointer text-sm font-medium text-primary">Connect with your own key</summary>
                      <ActionForm action={connectIntegration} submitLabel="Check and connect" className="mt-3 space-y-3">
                        <input type="hidden" name="provider" value={i.key} />
                        {fields.map((f) => (
                          <div key={f.name} className="space-y-1">
                            <Label htmlFor={`${i.key}-${f.name}`}>{f.label}</Label>
                            <Input id={`${i.key}-${f.name}`} name={f.name} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} required />
                          </div>
                        ))}
                        <p className="text-xs text-muted-foreground">Checked with {i.name} first, then stored encrypted. It is never shown again.</p>
                      </ActionForm>
                    </details>
                  );
                })()}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
