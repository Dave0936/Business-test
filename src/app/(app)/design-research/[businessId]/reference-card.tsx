import { Heart, X, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/app/action-button";
import type { ReferenceRow } from "@/lib/design/studio";
import { verdictAction } from "../studio-actions";

const KIND_LABEL: Record<string, string> = { pin: "Pinterest", site: "Website", upload: "Your picture", link: "Link" };

/** One reference: thumbnail (hot-linked, never copied), observed design facts and love/reject. */
export function ReferenceCard({ r, businessId, imageSrc, pickedFor, canEdit }: { r: ReferenceRow; businessId: string; imageSrc: string | null; pickedFor?: string; canEdit: boolean }) {
  const facts = r.analysis?.facts;
  const rejected = r.verdict === "rejected";
  return (
    <article className={`flex flex-col overflow-hidden rounded-xl border bg-card ${rejected ? "opacity-55" : ""} ${r.verdict === "loved" ? "ring-2 ring-highlight" : ""}`} data-testid="reference-card" data-verdict={r.verdict ?? ""}>
      <div className="relative aspect-[4/3] bg-muted">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- third-party thumbnails are hot-linked, not optimised or stored
          <img src={imageSrc} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : facts?.colours?.length ? (
          <div className="flex size-full" aria-hidden>{facts.colours.map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}</div>
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground"><ImageOff className="size-6" aria-hidden /></div>
        )}
        {pickedFor && <span className="absolute left-2 top-2 rounded-md bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground">Picked: {pickedFor}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          {r.storage_path ? <span className="line-clamp-2 font-medium">{r.title ?? "Your picture"}</span> : (
            <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="line-clamp-2 font-medium hover:underline">{r.title ?? r.url}</a>
          )}
          <Badge variant="secondary" className="shrink-0">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
        </div>
        {r.attribution && <p className="text-xs text-muted-foreground">{r.attribution}{r.business_id ? "" : " · sector-wide"}</p>}
        {facts && (facts.fonts.length > 0 || facts.colours.length > 0) && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {facts.fonts.length > 0 && <p>Fonts seen: {facts.fonts.slice(0, 3).join(", ")}</p>}
            {facts.colours.length > 0 && (
              <p className="flex items-center gap-1">Colours: {facts.colours.slice(0, 6).map((c) => <span key={c} title={c} className="inline-block size-3.5 rounded-sm border" style={{ background: c }} />)}</p>
            )}
          </div>
        )}
        {r.analysis?.fetch_error && <p className="text-xs text-muted-foreground">Couldn&apos;t read the site: {r.analysis.fetch_error}</p>}
        {r.analysis?.notes && <p className="text-xs">“{r.analysis.notes}”</p>}
        {canEdit && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            {r.verdict !== "loved" && <VerdictButton id={r.id} businessId={businessId} verdict="loved" label="Love" />}
            {r.verdict !== "rejected" && <VerdictButton id={r.id} businessId={businessId} verdict="rejected" label="Reject" />}
            {r.verdict && <VerdictButton id={r.id} businessId={businessId} verdict="clear" label={r.verdict === "loved" ? "Unlove" : "Restore"} />}
          </div>
        )}
        {!canEdit && r.verdict && <p className="text-xs">{r.verdict === "loved" ? <Heart className="inline size-3.5" aria-hidden /> : <X className="inline size-3.5" aria-hidden />} {r.verdict}</p>}
      </div>
    </article>
  );
}

function VerdictButton({ id, businessId, verdict, label }: { id: string; businessId: string; verdict: string; label: string }) {
  return <ActionButton action={verdictAction} hidden={{ referenceId: id, businessId, verdict }} label={label} variant={verdict === "loved" ? "default" : "outline"} size="sm" />;
}
