"use client";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/app/field";
import { FONT_CHOICES, contrastRatio, type DesignBrief } from "@/lib/design/brief";
import { saveBriefAction } from "../studio-actions";

const COLOURS = ["primary", "secondary", "accent", "background", "surface", "text", "muted"] as const;
type Colour = (typeof COLOURS)[number];
const HEX = /^#[0-9a-f]{6}$/i;

function Ratio({ label, a, b }: { label: string; a: string; b: string }) {
  if (!HEX.test(a) || !HEX.test(b)) return <li>{label}: —</li>;
  const r = contrastRatio(a, b);
  const ok = r >= 4.5;
  return <li className={ok ? "" : "font-medium text-destructive"}>{label}: {r.toFixed(1)}:1 {ok ? "passes" : "fails WCAG AA (needs 4.5:1); it will be adjusted when saved"}</li>;
}

/** Edit the latest brief; saving creates a new version. Contrast is checked as you type. */
export function BriefEditor({ businessId, brief }: { businessId: string; brief: DesignBrief }) {
  const [state, run, pending] = useActionState(saveBriefAction, {});
  const [palette, setPalette] = useState<Record<Colour, string>>(() => Object.fromEntries(COLOURS.map((k) => [k, brief.palette[k]])) as Record<Colour, string>);
  const set = (k: Colour) => (e: React.ChangeEvent<HTMLInputElement>) => setPalette((p) => ({ ...p, [k]: e.target.value }));

  return (
    <form action={run} className="space-y-4">
      <input type="hidden" name="businessId" value={businessId} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Positioning" htmlFor="positioning"><Textarea id="positioning" name="positioning" rows={2} defaultValue={brief.positioning} required /></Field>
        <Field label="Audience" htmlFor="audience"><Textarea id="audience" name="audience" rows={2} defaultValue={brief.audience} required /></Field>
        <Field label="Visual direction" htmlFor="visual_direction"><Textarea id="visual_direction" name="visual_direction" rows={2} defaultValue={brief.visual_direction} required /></Field>
        <Field label="Mood words" htmlFor="mood_words" hint="Comma-separated, up to six."><Input id="mood_words" name="mood_words" defaultValue={brief.mood_words.join(", ")} /></Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Palette</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {COLOURS.map((k) => (
            <label key={k} className="space-y-1 text-xs">
              <span className="block capitalize">{k}</span>
              <span className="flex items-center gap-1.5">
                <input type="color" aria-label={`${k} colour picker`} value={HEX.test(palette[k]) ? palette[k] : "#000000"} onChange={set(k)} className="h-8 w-9 shrink-0 cursor-pointer rounded border bg-transparent" />
                <Input name={`c_${k}`} value={palette[k]} onChange={set(k)} pattern="#[0-9a-fA-F]{6}" className="h-8 font-mono text-xs" aria-label={`${k} hex`} />
              </span>
            </label>
          ))}
        </div>
        <ul className="space-y-0.5 text-xs text-muted-foreground" aria-live="polite">
          <Ratio label="Text on background" a={palette.text} b={palette.background} />
          <Ratio label="Text on surface" a={palette.text} b={palette.surface} />
          <Ratio label="White on primary (buttons)" a="#ffffff" b={palette.primary} />
          <Ratio label="Muted text on background" a={palette.muted} b={palette.background} />
        </ul>
        <Input name="palette_rationale" defaultValue={brief.palette.rationale} aria-label="Palette rationale" />
      </fieldset>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Heading font" htmlFor="font_heading"><Select id="font_heading" name="font_heading" defaultValue={brief.typography.heading}>{FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}</Select></Field>
        <Field label="Body font" htmlFor="font_body"><Select id="font_body" name="font_body" defaultValue={brief.typography.body}>{FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}</Select></Field>
        <Field label="Hero layout" htmlFor="hero_layout"><Select id="hero_layout" name="hero_layout" defaultValue={brief.hero_layout}><option value="full-bleed">Full-bleed photo</option><option value="split">Split: photo beside headline</option><option value="centered">Centred headline</option></Select></Field>
      </div>
      <input type="hidden" name="type_rationale" value={brief.typography.rationale} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Hero notes" htmlFor="hero_notes"><Textarea id="hero_notes" name="hero_notes" rows={2} defaultValue={brief.hero_notes} /></Field>
        <Field label="Navigation" htmlFor="navigation"><Textarea id="navigation" name="navigation" rows={2} defaultValue={brief.navigation} /></Field>
        <Field label="Pages and sections" htmlFor="page_structure" hint="One page per line: Page: Section → Section → Section"><Textarea id="page_structure" name="page_structure" rows={5} className="font-mono text-xs" defaultValue={brief.page_structure.map((p) => `${p.page}: ${p.sections.join(" → ")}`).join("\n")} /></Field>
        <Field label="Calls to action" htmlFor="ctas" hint="One per line, most important first (up to four)."><Textarea id="ctas" name="ctas" rows={5} defaultValue={brief.ctas.map((c) => c.label).join("\n")} /></Field>
        <Field label="Image style" htmlFor="image_style"><Textarea id="image_style" name="image_style" rows={2} defaultValue={brief.image_style} /></Field>
        <Field label="Image searches" htmlFor="image_queries" hint="One per line; generic terms, no brand names."><Textarea id="image_queries" name="image_queries" rows={3} defaultValue={brief.image_queries.join("\n")} /></Field>
        <Field label="Mobile" htmlFor="mobile_recommendations" hint="One per line."><Textarea id="mobile_recommendations" name="mobile_recommendations" rows={3} defaultValue={brief.mobile_recommendations.join("\n")} /></Field>
        <Field label="Functionality" htmlFor="functionality" hint="One per line."><Textarea id="functionality" name="functionality" rows={3} defaultValue={brief.functionality.join("\n")} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save as new version"}</Button>
        {state.error && <span role="status" className="text-sm text-destructive">{state.error}</span>}
        {state.message && !state.error && <span role="status" className="text-sm text-success">{state.message}</span>}
      </div>
    </form>
  );
}
