import { COUNTRIES, INDUSTRIES, OPPORTUNITY_TYPES } from "@/lib/industries";
import { Button } from "@/components/ui/button";

export interface FilterValues {
  country?: string;
  sector?: string;
  from?: string;
  to?: string;
  opportunity?: string;
  minScore?: string;
  status?: string;
  q?: string;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): FilterValues {
  const g = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() !== "" ? s.trim() : undefined;
  };
  return { country: g("country"), sector: g("sector"), from: g("from"), to: g("to"), opportunity: g("opportunity"), minScore: g("minScore"), status: g("status"), q: g("q") };
}

const field = "h-8 rounded-md border border-input bg-card px-2 text-sm";

/** GET form: filters live in the URL so views are shareable and work without JS. */
export function FilterBar({ values, showStatus, statuses, showSearch }: { values: FilterValues; showStatus?: boolean; statuses?: readonly string[]; showSearch?: boolean }) {
  return (
    <form className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3" role="search" aria-label="Filters">
      {showSearch && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Search
          <input name="q" defaultValue={values.q} placeholder="Business name" className={`${field} w-44`} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Country
        <select name="country" defaultValue={values.country ?? ""} className={field}>
          <option value="">All countries</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Sector
        <select name="sector" defaultValue={values.sector ?? ""} className={field}>
          <option value="">All sectors</option>
          {INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Opportunity
        <select name="opportunity" defaultValue={values.opportunity ?? ""} className={field}>
          <option value="">Any</option>
          {OPPORTUNITY_TYPES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Min score
        <input name="minScore" type="number" min={0} max={100} defaultValue={values.minScore} className={`${field} w-20`} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">From
        <input name="from" type="date" defaultValue={values.from} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">To
        <input name="to" type="date" defaultValue={values.to} className={field} />
      </label>
      {showStatus && statuses && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Status
          <select name="status" defaultValue={values.status ?? ""} className={field}>
            <option value="">Any status</option>
            {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      )}
      <Button size="sm" type="submit">Apply</Button>
      <Button size="sm" variant="ghost" asChild><a href="?">Reset</a></Button>
    </form>
  );
}

export function toRpcFilters(f: FilterValues) {
  return {
    p_country: f.country ?? null,
    p_sector: f.sector ?? null,
    p_from: f.from ? new Date(f.from).toISOString() : null,
    p_to: f.to ? new Date(new Date(f.to).getTime() + 86400_000).toISOString() : null,
    p_opportunity: f.opportunity ?? null,
    p_min_score: f.minScore ? Number(f.minScore) : null,
  };
}
