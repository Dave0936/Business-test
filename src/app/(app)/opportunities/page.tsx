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
import { aiAvailable } from "@/lib/ai/client";
import { formatDate } from "@/lib/utils";
import { addManual, importCsv, runSearch } from "./actions";

export const metadata: Metadata = { title: "Find Opportunities" };

export default async function OpportunitiesPage() {
  const ctx = await getOrgContext();
  const { data: runs } = await ctx.supabase.from("automation_runs").select("id, status, started_at, stats, workflow_id").eq("organisation_id", ctx.organisationId).is("workflow_id", null).order("started_at", { ascending: false }).limit(8);
  const providers = DISCOVERY_PROVIDERS.map((p) => ({ id: p.id, label: p.label, description: p.description, available: p.available(), reason: p.unavailableReason?.(), attribution: p.terms.attribution, retention: p.terms.retentionDays }));
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
            <ActionForm action={runSearch} submitLabel="Start search" disabled={!writable}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Data source" htmlFor="provider" className="sm:col-span-2" hint="Only sources you are authorised to use are listed as available.">
                  <Select id="provider" name="provider" defaultValue={providers.find((p) => p.available && p.id !== "demo")?.id ?? "demo"}>
                    {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? "" : ` — ${p.reason}`}</option>)}
                  </Select>
                </Field>
                <Field label="Country" htmlFor="countryCode">
                  <Select id="countryCode" name="countryCode" defaultValue="GB">{COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
                </Field>
                <Field label="Region (optional)" htmlFor="region"><Input id="region" name="region" placeholder="Scotland" /></Field>
                <Field label="Cities" htmlFor="cities" className="sm:col-span-2" hint="One or more, separated by commas.">
                  <Input id="cities" name="cities" required placeholder="Edinburgh, Glasgow" />
                </Field>
                <fieldset className="sm:col-span-2">
                  <legend className="mb-2 text-sm font-medium">Industries</legend>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-3">
                    {INDUSTRIES.map((i) => (
                      <label key={i.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="industryIds" value={i.id} defaultChecked={i.id === "restaurant"} className="size-4 accent-[var(--primary)]" />{i.label}</label>
                    ))}
                  </div>
                </fieldset>
                <Field label="Business type (optional)" htmlFor="businessType" hint="Narrows text-based providers, e.g. “vegan restaurant”."><Input id="businessType" name="businessType" /></Field>
                <Field label="Search radius (km)" htmlFor="radiusKm"><Input id="radiusKm" name="radiusKm" type="number" min={1} max={50} defaultValue={5} /></Field>
                <Field label="Businesses per search" htmlFor="limit"><Input id="limit" name="limit" type="number" min={1} max={200} defaultValue={50} /></Field>
                <Field label="Minimum lead score to qualify" htmlFor="minScore"><Input id="minScore" name="minScore" type="number" min={0} max={100} defaultValue={55} /></Field>
                <fieldset className="space-y-2 sm:col-span-2 rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">Then automatically</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="audit" defaultChecked className="size-4" />Audit websites and score every lead</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="research" defaultChecked className="size-4" />Research design direction for qualified leads</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="generate" className="size-4" />Generate prototypes, up to <input name="prototypeLimit" type="number" min={0} max={100} defaultValue={5} className="h-7 w-16 rounded border px-1" aria-label="Prototype limit" /> per search</label>
                  <p className="text-xs text-muted-foreground">Prototypes stop at the approval centre. Nothing is deployed or emailed without approval.</p>
                </fieldset>
              </div>
            </ActionForm>
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
