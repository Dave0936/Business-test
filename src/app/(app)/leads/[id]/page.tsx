import type { Metadata } from "next";
import { draftEmailAction } from "../../emails/actions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext, canWrite } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DemoBadge, ScoreBadge, StatusBadge } from "@/components/app/badges";
import { ScoreBreakdown } from "@/components/app/score-breakdown";
import { ActionButton } from "@/components/app/action-button";
import { ActionForm } from "@/components/app/action-form";
import { Field } from "@/components/app/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_STATUSES, humanise, industryById } from "@/lib/industries";
import { formatDate, formatMoney } from "@/lib/utils";
import { addNote, queueAction, updateLead } from "../actions";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgContext();
  const db = ctx.supabase;
  const { data: b } = await db.from("businesses").select("*").eq("id", id).eq("organisation_id", ctx.organisationId).maybeSingle();
  if (!b) notFound();

  const [{ data: sources }, { data: score }, { data: audit }, { data: brief }, { data: refs }, { data: site }, { data: deps }, { data: emails }, { data: activity }] = await Promise.all([
    db.from("business_sources").select("provider, source_url, attribution, licence, fetched_at, retention_expires_at").eq("business_id", id),
    db.from("opportunity_scores").select("score, breakdown, threshold, weights_version, qualified, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("website_audits").select("id, audit_score, problems, improvements, recommendations, judgements, created_at, error").eq("business_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("design_briefs").select("id, brief, generated_by, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("design_references").select("id, source, title, url").eq("business_id", id).limit(8),
    db.from("generated_websites").select("id, status, slug, updated_at").eq("business_id", id).maybeSingle(),
    db.from("deployment_records").select("id, status, url, created_at, error").eq("business_id", id).order("created_at", { ascending: false }).limit(3),
    db.from("email_drafts").select("id, subject, status, kind, sent_at, created_at").eq("business_id", id).order("created_at", { ascending: false }),
    db.from("crm_activities").select("id, type, summary, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(60),
  ]);
  const writable = canWrite(ctx.role);
  const liveUrl = deps?.find((d) => d.status === "verified")?.url;
  const hidden = { businessId: id };

  return (
    <>
      <PageHeader
        title={b.name}
        description={<span className="flex flex-wrap items-center gap-2">{industryById(b.industry_id)?.label ?? b.category ?? "Business"} · {b.city ?? "—"}, {b.country_code} <StatusBadge status={b.status} /> <DemoBadge show={b.is_demo} /></span>}
        actions={(
          <>
            <Link href={`/design-research/${id}`} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">Design studio</Link>
            {site && <Link href={`/builder/${site.id}`} className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted">Open prototype</Link>}
            {writable && <>
            <ActionButton action={queueAction} hidden={{ ...hidden, type: "audit", force: "1" }} label={audit ? "Re-audit" : "Audit & score"} variant="outline" />
            <ActionButton action={queueAction} hidden={{ ...hidden, type: "research", force: "1" }} label={brief ? "Quick new brief" : "Quick brief"} variant="outline" />
            <ActionButton action={queueAction} hidden={{ ...hidden, type: "generate", force: site ? "1" : "" }} label={site ? "Regenerate prototype" : "Generate prototype"} variant="outline" confirm={site ? "This creates a new version and resets approval. Continue?" : undefined} />
            {liveUrl && b.email && <ActionButton action={draftEmailAction} hidden={{ businessId: b.id }} label="Draft email" pendingLabel="Writing…" />}
            </>}
          </>
        )}
      />

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Opportunity score</CardTitle></CardHeader>
            <CardContent>
              {score ? <ScoreBreakdown score={score.score} breakdown={score.breakdown} threshold={score.threshold} weightsVersion={score.weights_version} /> : <p className="text-sm text-muted-foreground">Not scored yet. Run an audit.</p>}
            </CardContent>
          </Card>

          {audit && (
            <Card>
              <CardHeader><CardTitle>Audit findings</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="text-muted-foreground">{formatDate(audit.created_at, true)} · current site score {audit.audit_score ?? "n/a"} · {(audit.judgements as { source?: string }).source === "ai" ? "AI judgements included" : "rule-based (no AI)"} · <Link className="text-primary hover:underline" href={`/audits/${audit.id}`}>full audit</Link></p>
                <div>
                  <p className="mb-1 font-medium">Problems</p>
                  <ul className="list-disc space-y-1 pl-5">{(audit.problems as { title: string; detail: string; basis?: string }[]).map((p, i) => <li key={i}><span className="font-medium">{p.title}</span> <span className="text-xs text-muted-foreground">({p.basis === "ai_judgement" ? "AI judgement" : "observed"})</span>: {p.detail}</li>)}</ul>
                </div>
                <div>
                  <p className="mb-1 font-medium">Recommendations</p>
                  <ul className="list-disc space-y-1 pl-5">{[...(audit.improvements as { title: string; detail: string }[]), ...(audit.recommendations as { title: string; detail: string }[])].map((p, i) => <li key={i}><span className="font-medium">{p.title}</span>: {p.detail}</li>)}</ul>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Prototype, deployment and emails</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-muted-foreground">Design brief</span>
                {brief ? <><Link className="text-primary hover:underline" href={`/design-research/${id}`}>Open in design studio</Link><span className="text-xs text-muted-foreground">({brief.generated_by === "ai" ? "AI" : brief.generated_by === "manual" ? "edited" : "sector preset"}, {refs?.length ?? 0} references)</span></> : <Link className="text-primary hover:underline" href={`/design-research/${id}`}>None yet: open the design studio</Link>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-muted-foreground">Prototype</span>
                {site ? <><Link className="text-primary hover:underline" href={`/builder/${site.id}`}>Open in builder</Link><StatusBadge status={site.status} /></> : <span className="text-muted-foreground">None</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-28 text-muted-foreground">Cloudflare URL</span>
                {liveUrl ? <a className="text-primary hover:underline" href={liveUrl} target="_blank" rel="noopener noreferrer">{liveUrl}</a> : deps?.[0] ? <StatusBadge status={deps[0].status} /> : <span className="text-muted-foreground">Not deployed</span>}
              </div>
              <div>
                <span className="text-muted-foreground">Emails</span>
                {emails?.length ? (
                  <ul className="mt-1 space-y-1">{emails.map((e) => <li key={e.id} className="flex items-center gap-2"><Link className="hover:underline" href={`/emails/${e.id}`}>{e.subject}</Link><StatusBadge status={e.status} /><span className="text-xs text-muted-foreground">{e.sent_at ? `sent ${formatDate(e.sent_at, true)}` : formatDate(e.created_at)}</span></li>)}</ul>
                ) : <p className="text-muted-foreground">{!b.email ? "No published email address. Use their contact page or phone." : liveUrl ? "None drafted yet." : "Emails can be drafted once the concept is deployed."}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent>
              {writable && (
                <ActionForm action={addNote} submitLabel="Add note" className="mb-4 space-y-2">
                  <input type="hidden" name="id" value={id} />
                  <Textarea name="note" placeholder="Call notes, context, next steps…" rows={2} aria-label="Note" />
                </ActionForm>
              )}
              <ol className="relative space-y-3 border-l pl-4 text-sm">
                {activity?.map((a) => (
                  <li key={a.id}>
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card bg-primary/60" />
                    <p>{a.summary}</p>
                    <p className="text-xs text-muted-foreground">{humanise(a.type)} · {formatDate(a.created_at, true)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Business details</CardTitle></CardHeader>
            <CardContent>
              <ActionForm action={updateLead} submitLabel="Save" disabled={!writable}>
                <input type="hidden" name="id" value={id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Status" htmlFor="status"><Select id="status" name="status" defaultValue={b.status}>{LEAD_STATUSES.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}</Select></Field>
                  <Field label="Subscriber type" htmlFor="subscriber_type" hint="Limited companies/LLPs are corporate; sole traders are individuals (UK PECR).">
                    <Select id="subscriber_type" name="subscriber_type" defaultValue={b.subscriber_type}><option value="unknown">Unknown</option><option value="corporate">Corporate subscriber</option><option value="individual">Individual subscriber</option></Select>
                  </Field>
                  <Field label="Website" htmlFor="website_url"><Input id="website_url" name="website_url" type="url" defaultValue={b.website_url ?? ""} /></Field>
                  <Field label="Public email" htmlFor="email" hint={b.email ? `Source: ${humanise(b.email_source)}` : "Only an address the business publishes itself (its website, Google listing or social page). Never guess or buy addresses."}><Input id="email" name="email" type="email" defaultValue={b.email ?? ""} /></Field>
                  <Field label="Public phone" htmlFor="phone"><Input id="phone" name="phone" defaultValue={b.phone ?? ""} /></Field>
                  <Field label="Follow-up date" htmlFor="follow_up_at"><Input id="follow_up_at" name="follow_up_at" type="date" defaultValue={b.follow_up_at?.slice(0, 10) ?? ""} /></Field>
                  <Field label="Estimated value" htmlFor="estimated_value" hint="An estimate, not revenue."><Input id="estimated_value" name="estimated_value" type="number" min={0} defaultValue={b.estimated_value ?? ""} /></Field>
                  <Field label="Actual revenue" htmlFor="actual_revenue" hint="Only when converted."><Input id="actual_revenue" name="actual_revenue" type="number" min={0} defaultValue={b.actual_revenue ?? ""} /></Field>
                </div>
                <Field label="Notes" htmlFor="notes"><Textarea id="notes" name="notes" defaultValue={b.notes ?? ""} rows={3} /></Field>
              </ActionForm>
              <dl className="mt-5 grid grid-cols-[110px_1fr] gap-y-1.5 border-t pt-4 text-sm">
                <dt className="text-muted-foreground">Lead score</dt><dd><ScoreBadge score={b.lead_score} /></dd>
                <dt className="text-muted-foreground">Opportunity</dt><dd>{humanise(b.opportunity_type)}</dd>
                <dt className="text-muted-foreground">Address</dt><dd>{[b.address, b.postal_code, b.city].filter(Boolean).join(", ") || "—"}</dd>
                <dt className="text-muted-foreground">Rating</dt><dd>{b.rating != null ? `${b.rating} ★ from ${b.reviews_count ?? 0} reviews` : "—"}{b.listing_url && <> · <a className="text-primary hover:underline" href={b.listing_url} target="_blank" rel="noopener noreferrer nofollow">listing</a></>}</dd>
                {b.opening_hours && <><dt className="text-muted-foreground">Opening hours</dt><dd className="text-xs">{Object.entries(b.opening_hours as Record<string, string>).map(([d, h]) => <span key={d} className="block">{d.charAt(0).toUpperCase() + d.slice(1)}: {h}</span>)}</dd></>}
                {b.is_chain && <><dt className="text-muted-foreground">Chain</dt><dd>Looks like a chain or franchise</dd></>}
                <dt className="text-muted-foreground">Contact page</dt><dd>{b.contact_page_url ? <a className="text-primary hover:underline" href={b.contact_page_url} target="_blank" rel="noopener noreferrer nofollow">Open</a> : "—"}</dd>
                <dt className="text-muted-foreground">Discovered</dt><dd>{formatDate(b.discovered_at, true)}</dd>
                <dt className="text-muted-foreground">Revenue</dt><dd>{b.actual_revenue ? formatMoney(Number(b.actual_revenue)) : "—"} {b.estimated_value ? <span className="text-xs text-muted-foreground">(est. {formatMoney(Number(b.estimated_value))})</span> : null}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Sources</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {sources?.map((s, i) => (
                <div key={i}>
                  <p className="font-medium">{humanise(s.provider)} {s.source_url && <a href={s.source_url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-primary hover:underline">view source</a>}</p>
                  <p className="text-xs text-muted-foreground">{s.attribution} · {s.licence} · fetched {formatDate(s.fetched_at)}{s.retention_expires_at ? ` · refresh by ${formatDate(s.retention_expires_at)}` : ""}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
