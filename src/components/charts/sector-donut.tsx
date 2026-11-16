"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useThemeColors } from "./use-theme-colors";

export interface Slice { key: string; label: string; value: number }

/**
 * Leads by sector. At most five named slices in fixed colour order (by entity, not rank),
 * the rest folded into "Other". Legend with values is always shown, so identity is never colour alone.
 */
export function SectorDonut({ slices, total, palette }: { slices: Slice[]; total: number; palette: Record<string, number> }) {
  const c = useThemeColors();
  if (!total) return <p className="py-10 text-center text-sm text-muted-foreground">No leads yet.</p>;
  const colour = (s: Slice) => (s.key === "other" ? c?.["series-other"] : c?.[`series-${(palette[s.key] ?? 0) + 1}` as "series-1"]) ?? "#999";
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto size-44">
        {c && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={1.5} stroke={c.card} strokeWidth={2} isAnimationActive={false}>
                {slices.map((s) => <Cell key={s.key} fill={colour(s)} />)}
              </Pie>
              <Tooltip
                cursor={false}
                content={({ active, payload }) => active && payload?.[0] ? (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="font-medium text-foreground">{payload[0].name}</p>
                    <p className="text-muted-foreground">{Number(payload[0].value)} leads · {Math.round((100 * Number(payload[0].value)) / total)}%</p>
                  </div>
                ) : null}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><p className="text-2xl font-semibold tabular-nums">{total}</p><p className="text-xs text-muted-foreground">leads</p></div>
        </div>
      </div>
      <ul className="space-y-2 text-sm" aria-label="Leads by sector">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: colour(s) }} aria-hidden />
            <span className="flex-1 truncate text-foreground">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">{Math.round((100 * s.value) / total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
