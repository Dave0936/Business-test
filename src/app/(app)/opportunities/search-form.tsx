"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { runSearch } from "./actions";

interface Town { id: number; name: string; regionName: string; population: number; lat: number; lng: number }
interface ProviderOpt { id: string; label: string; available: boolean; reason?: string; paid: boolean }

export function SearchForm({ providers, countries, industries, disabled, defaultCountry }: {
  providers: ProviderOpt[];
  countries: { code: string; name: string }[];
  industries: { id: string; label: string }[];
  disabled: boolean;
  defaultCountry: string;
}) {
  const [state, action, pending] = useActionState(runSearch, {});
  const [provider, setProvider] = useState(providers.find((p) => p.available && p.id !== "demo")?.id ?? "demo");
  const [country, setCountry] = useState(defaultCountry);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<Town[]>([]);
  const [towns, setTowns] = useState<{ name: string; region?: string; lat?: number; lng?: number }[]>([]);
  const [industryIds, setIndustryIds] = useState<string[]>(["restaurant"]);
  const [pages, setPages] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paid = providers.find((p) => p.id === provider)?.paid ?? false;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) return;
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/places/towns?country=${country}&q=${encodeURIComponent(q)}&limit=8`);
      const json = (await res.json()) as { towns: Town[] };
      setSuggestions(json.towns);
    }, 180);
  }, [q, country]);

  const addTown = (t: { name: string; region?: string; lat?: number; lng?: number }) => {
    if (!towns.some((x) => x.name === t.name && x.region === t.region)) setTowns([...towns, t].slice(0, 20));
    setQ("");
    setSuggestions([]);
  };

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="towns" value={JSON.stringify(towns)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="provider">Data source</Label>
          <Select id="provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? "" : ` (${p.reason ?? "not connected"})`}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="countryCode">Country</Label>
          <Select id="countryCode" name="countryCode" value={country} onChange={(e) => { setCountry(e.target.value); setTowns([]); setSuggestions([]); }}>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
        </div>
        <div className="relative space-y-1.5">
          <Label htmlFor="town">Towns</Label>
          <Input
            id="town" value={q} autoComplete="off" placeholder="Start typing a town…" role="combobox" aria-expanded={suggestions.length > 0} aria-controls="town-list"
            onChange={(e) => { setQ(e.target.value); if (!e.target.value.trim()) setSuggestions([]); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (suggestions[0]) addTown({ name: suggestions[0].name, region: suggestions[0].regionName, lat: suggestions[0].lat, lng: suggestions[0].lng });
                else if (q.trim()) addTown({ name: q.trim() });
              }
            }}
          />
          {suggestions.length > 0 && (
            <ul id="town-list" role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
              {suggestions.map((t) => (
                <li key={t.id} role="option" aria-selected={false}>
                  <button type="button" className="flex w-full justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => addTown({ name: t.name, region: t.regionName, lat: t.lat, lng: t.lng })}>
                    <span>{t.name}<span className="text-muted-foreground">{t.regionName ? `, ${t.regionName}` : ""}</span></span>
                    <span className="text-xs text-muted-foreground">{t.population.toLocaleString("en-GB")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {towns.map((t) => (
              <span key={`${t.name}|${t.region}`} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs">
                {t.name}{t.region ? `, ${t.region}` : ""}
                <button type="button" aria-label={`Remove ${t.name}`} onClick={() => setTowns(towns.filter((x) => x !== t))}><X className="size-3" /></button>
              </span>
            ))}
            {towns.length === 0 && <span className="text-xs text-muted-foreground">Pick from the list, or press Enter to use what you typed. Places: GeoNames.</span>}
          </div>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">Industries</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-3">
            {industries.map((i) => (
              <label key={i.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="industryIds" value={i.id} checked={industryIds.includes(i.id)} onChange={(e) => setIndustryIds(e.target.checked ? [...industryIds, i.id] : industryIds.filter((x) => x !== i.id))} className="size-4" />
                {i.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5"><Label htmlFor="businessType">Business type (optional)</Label><Input id="businessType" name="businessType" placeholder="e.g. vegan restaurant" /></div>
        <div className="space-y-1.5"><Label htmlFor="limit">Businesses per town and industry</Label><Input id="limit" name="limit" type="number" min={1} max={200} defaultValue={paid ? 20 : 50} /></div>
        {paid ? (
          <div className="space-y-1.5">
            <Label htmlFor="pages">Result pages (20 each)</Label>
            <Select id="pages" name="pages" value={pages} onChange={(e) => setPages(Number(e.target.value))}><option value={1}>1 page</option><option value={2}>2 pages</option><option value={3}>3 pages</option></Select>
          </div>
        ) : (
          <div className="space-y-1.5"><Label htmlFor="radiusKm">Search radius (km)</Label><Input id="radiusKm" name="radiusKm" type="number" min={1} max={50} defaultValue={5} /></div>
        )}
        <div className="space-y-1.5"><Label htmlFor="minScore">Minimum lead score to qualify</Label><Input id="minScore" name="minScore" type="number" min={0} max={100} defaultValue={55} /></div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="excludeChains" defaultChecked className="size-4" />Leave out chains and franchises</label>
        <fieldset className="space-y-2 rounded-lg border p-3 sm:col-span-2">
          <legend className="px-1 text-sm font-medium">Then automatically</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="audit" defaultChecked className="size-4" />Audit websites and score every lead</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="research" defaultChecked className="size-4" />Research design direction for qualified leads</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="generate" className="size-4" />Generate prototypes, up to <input name="prototypeLimit" type="number" min={0} max={100} defaultValue={5} className="h-7 w-16 rounded border px-1" aria-label="Prototype limit" /> per search</label>
          <p className="text-xs text-muted-foreground">Prototypes stop at the approval centre. Nothing is deployed or emailed without approval.</p>
        </fieldset>
        <fieldset className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Repeat</legend>
          <div className="space-y-1.5"><Label htmlFor="repeat">Run this search again</Label>
            <select id="repeat" name="repeat" defaultValue="off" className="h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="off">Just this once</option><option value="weekly">Every week</option><option value="monthly">Every 4 weeks</option></select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="workflowName">Name (for a repeating search)</Label><Input id="workflowName" name="workflowName" maxLength={80} placeholder="e.g. Aberdeen restaurants" /></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Repeating searches appear in the Automation Centre, where you can pause, change or delete them. New businesses are added; ones already found are merged.</p>
        </fieldset>
      </div>
      {paid && towns.length > 0 && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm" role="note">
          This search uses about <strong>{towns.length * industryIds.length * pages}</strong> SerpAPI credit{towns.length * industryIds.length * pages === 1 ? "" : "s"} ({towns.length} town{towns.length === 1 ? "" : "s"} × {industryIds.length} industr{industryIds.length === 1 ? "y" : "ies"} × {pages} page{pages === 1 ? "" : "s"}).
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || disabled || towns.length === 0 || industryIds.length === 0}>{pending ? "Starting…" : "Start search"}</Button>
        {state.error && <span role="status" className="text-sm text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}
