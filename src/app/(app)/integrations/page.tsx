import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { INTEGRATIONS, integrationStatus } from "@/lib/integrations";
import { supabaseConfigured, env } from "@/lib/env";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await getOrgContext();
  const status = await integrationStatus(ctx.supabase, ctx.organisationId);
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
