import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DesignBrief } from "@/lib/design/brief";
import { contrastRatio } from "@/lib/design/brief";

/** Read-only view of a brief version. */
export function BriefView({ b, refTitles }: { b: DesignBrief & { accessibility_adjustments?: string[] }; refTitles: Record<string, string> }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <CardHeader><CardTitle>Direction</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p><span className="font-medium">Positioning:</span> {b.positioning}</p>
          <p><span className="font-medium">Audience:</span> {b.audience}</p>
          <p><span className="font-medium">Visual direction:</span> {b.visual_direction}</p>
          <p><span className="font-medium">Mood:</span> {b.mood_words.join(", ")}</p>
          <p><span className="font-medium">Hero:</span> {b.hero_layout} — {b.hero_notes}</p>
          <p><span className="font-medium">Image style:</span> {b.image_style}</p>
          <p><span className="font-medium">Navigation:</span> {b.navigation}</p>
          <p><span className="font-medium">Calls to action:</span> {b.ctas.map((c) => c.label).join(" · ")}</p>
          <div><p className="font-medium">Mobile</p><ul className="list-disc pl-5">{b.mobile_recommendations.map((m) => <li key={m}>{m}</li>)}</ul></div>
          <div><p className="font-medium">Functionality</p><ul className="list-disc pl-5">{b.functionality.map((m) => <li key={m}>{m}</li>)}</ul></div>
          <p className="text-xs text-muted-foreground">{b.originality_note}</p>
        </CardContent>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Palette and type</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {(["primary", "secondary", "accent", "background", "surface", "text", "muted"] as const).map((k) => (
                <div key={k} className="space-y-1"><div className="h-12 rounded-md border" style={{ background: b.palette[k] }} /><p className="text-xs">{k}</p><p className="font-mono text-[11px] text-muted-foreground">{b.palette[k]}</p></div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Contrast: text on background {contrastRatio(b.palette.text, b.palette.background).toFixed(1)}:1 · white on primary {contrastRatio("#ffffff", b.palette.primary).toFixed(1)}:1. {b.palette.rationale}</p>
            {b.accessibility_adjustments?.length ? <p className="text-xs text-muted-foreground">Adjusted for accessibility: {b.accessibility_adjustments.join(" ")}</p> : null}
            <p><span className="font-medium">Headings:</span> {b.typography.heading} · <span className="font-medium">Body:</span> {b.typography.body}</p>
            <p className="text-muted-foreground">{b.typography.rationale}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Page structure</CardTitle></CardHeader>
          <CardContent><ul className="space-y-1 text-sm">{b.page_structure.map((p) => <li key={p.page}><span className="font-medium">{p.page}:</span> {p.sections.join(" → ")}</li>)}</ul></CardContent>
        </Card>
        {b.references_used.length > 0 && (
          <Card>
            <CardHeader><CardTitle>What it takes from the references</CardTitle></CardHeader>
            <CardContent><ul className="space-y-1 text-sm">{b.references_used.map((u) => <li key={u.reference_id}><span className="font-medium">{refTitles[u.reference_id] ?? "Reference"}:</span> {u.takeaway}</li>)}</ul></CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
