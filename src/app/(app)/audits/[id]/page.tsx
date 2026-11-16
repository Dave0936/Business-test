import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBreakdown } from "@/components/app/score-breakdown";
import { BasisBadge } from "@/components/app/badges";
import type { Observations } from "@/lib/audit/observe";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit" };

function Fact({ label, value, bad }: { label: string; value: React.ReactNode; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={bad ? "font-medium text-destructive" : ""}>{value}</dd>
    </div>
  );
}

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgContext();
  const { data: a } = await ctx.supabase.from("website_audits").select("*, businesses(id, name)").eq("id", id).eq("organisation_id", ctx.organisationId).maybeSingle();
  if (!a) notFound();
  const { data: s } = await ctx.supabase.from("opportunity_scores").select("*").eq("audit_id", id).maybeSingle();
  const o = a.observed as Observations & { noWebsite?: boolean };
  const j = a.judgements as Record<string, string | number | null> & { source?: string; note?: string };
  const biz = a.businesses as { id: string; name: string };
  const yes = (v: boolean) => (v ? "Yes" : "No");

  return (
    <>
      <PageHeader title={`Audit: ${biz.name}`} description={<>{a.url ?? "No website"} · {formatDate(a.created_at, true)} · <Link href={`/leads/${biz.id}`} className="text-primary hover:underline">lead record</Link></>} />
      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Observed facts</CardTitle><CardDescription>{(o as { simulated?: boolean }).simulated ? "Demo record: measured from a fictional sample page, not a real website." : "Measured by our crawler. No opinions."}</CardDescription></CardHeader>
          <CardContent>
            {o.noWebsite ? <p className="text-sm">No website found for this business.</p> : (
              <dl>
                <Fact label="Reachable" value={o.fetched ? `HTTP ${o.httpStatus}` : o.error ?? "No"} bad={!o.fetched} />
                <Fact label="HTTPS" value={yes(o.https)} bad={!o.https} />
                <Fact label="Time to first byte" value={o.timeToFirstByteMs != null ? `${o.timeToFirstByteMs} ms` : "—"} bad={(o.timeToFirstByteMs ?? 0) > 1500} />
                <Fact label="HTML size" value={o.pageBytes != null ? `${Math.round(o.pageBytes / 1024)} KB` : "—"} />
                <Fact label="Responsive viewport" value={yes(o.hasResponsiveViewport)} bad={!o.hasResponsiveViewport} />
                <Fact label="Phone overflow (375px)" value={o.mobileRender?.checked ? yes(Boolean(o.mobileRender.horizontalOverflow)) : "Not checked"} bad={o.mobileRender?.horizontalOverflow} />
                <Fact label="Title / description" value={`${o.title ? "Yes" : "No"} / ${o.metaDescription ? "Yes" : "No"}`} bad={!o.title || !o.metaDescription} />
                <Fact label="H1 headings" value={o.h1Count} bad={o.h1Count === 0} />
                <Fact label="Images without alt" value={`${o.imagesMissingAlt} of ${o.imageCount}`} bad={o.imagesMissingAlt > 0} />
                <Fact label="Page language" value={o.lang ?? "Not declared"} bad={!o.lang} />
                <Fact label="Forms" value={o.formCount} bad={o.formCount === 0} />
                <Fact label="Booking links / systems" value={[...o.bookingPlatforms, o.bookingLinks.length ? `${o.bookingLinks.length} links` : ""].filter(Boolean).join(", ") || "None"} />
                <Fact label="Calls to action" value={o.ctaCount ? o.ctaTexts.slice(0, 3).join(", ") : "None found"} bad={o.ctaCount === 0} />
                <Fact label="Tap-to-call / email" value={`${o.telLinks.length ? "Yes" : "No"} / ${o.publishedEmails.length ? "Yes" : "No"}`} />
                <Fact label="Contact page" value={o.contactPageUrl ? "Yes" : "No"} />
                <Fact label="Generator" value={o.generator ?? "—"} />
                <Fact label="Obsolete tags" value={o.deprecatedTags.join(", ") || "None"} bad={o.deprecatedTags.length > 0} />
                <Fact label="Flash / applets" value={yes(o.usesFlashOrApplets)} bad={o.usesFlashOrApplets} />
                <Fact label="Latest © year" value={o.latestYearMentioned ?? "—"} />
                <Fact label="Structured data" value={yes(o.structuredData)} />
                <Fact label="Broken links" value={`${o.brokenLinks.length} of ${o.linksChecked} checked`} bad={o.brokenLinks.length > 0} />
                <Fact label="robots.txt blocks crawling" value={yes(o.robotsDisallowed)} />
              </dl>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>AI judgements</CardTitle><CardDescription>Opinions, labelled as such.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {j.source === "ai" ? (
              <>
                <p><span className="font-medium">Visual quality:</span> {j.visual_quality ?? "not rated"}/5 — {j.visual_quality_rationale}</p>
                <p><span className="font-medium">Navigation:</span> {j.navigation_clarity ?? "not rated"}/5 — {j.navigation_rationale}</p>
                <p><span className="font-medium">Calls to action:</span> {j.cta_assessment}</p>
              </>
            ) : <p className="text-muted-foreground">{j.note ?? "No AI judgement."}</p>}
            <div className="border-t pt-3">
              <p className="mb-1 font-medium">Problems</p>
              <ul className="space-y-2">{(a.problems as { title: string; detail: string; basis?: string; severity?: string }[]).map((p, i) => <li key={i}><p className="font-medium">{p.title} <BasisBadge basis={p.basis ?? "observed"} /></p><p className="text-muted-foreground">{p.detail}</p></li>)}</ul>
            </div>
            <div className="border-t pt-3">
              <p className="mb-1 font-medium">Suggested improvements</p>
              <ul className="list-disc space-y-1 pl-5">{(a.improvements as { title: string; detail: string }[]).map((p, i) => <li key={i}><span className="font-medium">{p.title}:</span> {p.detail}</li>)}</ul>
            </div>
            <div className="border-t pt-3">
              <p className="mb-1 font-medium">Business-specific recommendations</p>
              <ul className="list-disc space-y-1 pl-5">{(a.recommendations as { title: string; detail: string }[]).map((p, i) => <li key={i}><span className="font-medium">{p.title}:</span> {p.detail}</li>)}</ul>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Opportunity score</CardTitle></CardHeader>
          <CardContent>{s ? <ScoreBreakdown score={s.score} breakdown={s.breakdown} threshold={s.threshold} weightsVersion={s.weights_version} /> : "—"}</CardContent>
        </Card>
      </div>
    </>
  );
}
