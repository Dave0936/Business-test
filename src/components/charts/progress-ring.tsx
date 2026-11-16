/** A single headline percentage as a ring (stat, not a chart: no hover needed). */
export function ProgressRing({ value, label, caption }: { value: number | null; label: string; caption?: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const r = 52;
  const len = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative size-36" role="img" aria-label={`${label}: ${value === null ? "no data" : `${Math.round(pct)}%`}`}>
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--grid)" strokeWidth="10" />
          {value !== null && <circle cx="60" cy="60" r={r} fill="none" stroke="var(--highlight)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * len} ${len}`} />}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-3xl font-semibold tabular-nums">{value === null ? "—" : `${Math.round(pct)}%`}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </div>
      {caption && <p className="max-w-52 text-center text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}
