import type { Metadata } from "next";
import Link from "next/link";
import { getOrgContext, canWrite } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/app/field";
import { ActionForm } from "@/components/app/action-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/app/badges";
import { COUNTRIES, INDUSTRIES } from "@/lib/industries";
import { DISCOVERY_PROVIDERS } from "@/lib/providers/discovery";
import { isMarkedUnreachable } from "@/lib/providers/discovery/health";
import { aiAvailable } from "@/lib/ai/client";
import { formatDate } from "@/lib/utils";
import { addManual, importCsv } from "./actions";
import { SearchForm } from "./search-form";
import { integrationStatus } from "@/lib/integrations";
import { listCountries } from "@/lib/places";

export const metadata: Metadata = { title: "Find Opportunities" };

export default async function OpportunitiesPage() {
  const ctx = await getOrgContext();
  const { data: runs } = await ctx.supabase.from("automation_runs").select("id, status, started_at, stats, workflow_id").eq("organisation_id", ctx.organisationId).is("workflow_id", null).order("started_at", { ascending: false }).limit(8);
  const [status, countries, { data: org }, { data: health }] = await Promise.all([
    integrationStatus(ctx.supabase, ctx.organisationId),
    listCountries(),
    ctx.supabase.from("organisations").select("default_country_code").eq("id", ctx.organisationId).single(),
    ctx.supabase.from("provider_health").select("provider, ok, checked_at").eq("organisation_id", ctx.organisationId),
  ]);
  const providers = DISCOVERY_PROVIDERS.map((p) => {
    const unreachable = isMarkedUnreachable(health?.find((h) => h.provider === p.id));
    const available = (!p.requires || status[p.requires].mode === "live") && !unreachable;
    return { id: p.id, label: p.label, description: p.description, available, reason: available ? undefined : unreachable ? "not reachable from this site; re-check in Integrations" : "connect in Integrations", paid: Boolean(p.costNote), attribution: p.terms.attribution, retention: p.terms.retentionDays };
  });
  const writable = canWrite(ctx.role);

  return (
    <>
      <PageHeader title="Find Opportunities" description="Search any country and city for businesses with no website or a weak one. Results are de-duplicated against your existing leads, audited and scored." />
      {!aiAvailable() && (
        <Alert variant="warning" className="mb-5">
          <AlertTitle>AI is not connected</AlertTitle>
          <AlertDescription>Discovery, audits and scoring work fully. Audit judgements, design briefs and website copy will use labelled templates until you add ANTHROPIC_API_KEY.</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>New search</CardTitle>
            <CardDescription>Each city × industry pair runs as its own background search. Re-running never duplicates businesses or audits.</CardDescription>
          </CardHeader>
          <CardContent>
            <SearchForm providers={providers.map((p) => ({ id: p.id, label: p.label, available: p.available, reason: p.reason, paid: p.paid }))} countries={countries.map((c) => ({ code: c.code, name: c.name }))} industries={INDUSTRIES.map((i) => ({ id: i.id, label: i.label }))} disabled={!writable} defaultCountry={org?.default_country_code ?? "GB"} />
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Recent searches</CardTitle></CardHeader>
            <CardContent>
              {runs?.length ? (
                <ul className="divide-y text-sm">
                  {runs.map((r) => {
                    const s = r.stats as Record<string, number>;
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                        <Link href={`/automation/runs/${r.id}`} className="hover:underline">{formatDate(r.started_at, true)}</Link>
                        <span className="text-xs text-muted-foreground">{s.new_businesses ?? 0} new · {s.qualified ?? 0} qualified</span>
                        <StatusBadge status={r.status} />
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-muted-foreground">No searches yet.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Data sources</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {providers.map((p) => (
                <div key={p.id}>
                  <p className="font-medium">{p.label} {p.available ? <span className="text-xs text-success">available</span> : <span className="text-xs text-muted-foreground">not configured</span>}</p>
                  <p className="text-muted-foreground">{p.description}</p>
                  <p className="text-xs text-muted-foreground">Attribution: {p.attribution}{p.retention ? ` · data refreshed or removed after ${p.retention} days` : ""}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Import a licensed list (CSV)</CardTitle><CardDescription>Columns: name, country_code, city, website, email, phone, category, source_url.</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={importCsv} submitLabel="Import" disabled={!writable}>
              <Input type="file" name="file" accept=".csv,text/csv" required aria-label="CSV file" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Licence / source" htmlFor="licence"><Input id="licence" name="licence" placeholder="Directory name, licence ref" required /></Field>
                <Field label="Industry" htmlFor="industryId"><Select id="industryId" name="industryId"><option value="">Mixed</option>{INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
              </div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="attest" className="mt-0.5 size-4" required />I confirm we are licensed to use this data for business outreach and that the emails were published by the businesses.</label>
            </ActionForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Add a business manually</CardTitle><CardDescription>Use details the business publishes itself. Include where you found them.</CardDescription></CardHeader>
          <CardContent>
            <ActionForm action={addManual} submitLabel="Add business" disabled={!writable}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Business name" htmlFor="m-name"><Input id="m-name" name="name" required /></Field>
                <Field label="Country" htmlFor="m-country"><Select id="m-country" name="countryCode" defaultValue="GB">{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
                <Field label="City" htmlFor="m-city"><Input id="m-city" name="city" /></Field>
                <Field label="Industry" htmlFor="m-ind"><Select id="m-ind" name="industryId">{INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
                <Field label="Website" htmlFor="m-web"><Input id="m-web" name="website" type="url" placeholder="https://" /></Field>
                <Field label="Public email" htmlFor="m-email"><Input id="m-email" name="email" type="email" /></Field>
                <Field label="Public phone" htmlFor="m-phone"><Input id="m-phone" name="phone" /></Field>
                <Field label="Found at (URL)" htmlFor="m-src"><Input id="m-src" name="sourceUrl" type="url" required placeholder="https://" /></Field>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
