"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useThemeColors } from "./use-theme-colors";

/** Businesses discovered per week. One series: the title names it, so no legend box. */
export function WeeklyBars({ data }: { data: { label: string; discovered: number }[] }) {
  const c = useThemeColors();
  const empty = data.every((d) => d.discovered === 0);
  if (empty) return <p className="py-10 text-center text-sm text-muted-foreground">Nothing discovered in the last 8 weeks.</p>;
  return (
    <div className="h-48">
      {c && (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c["muted-foreground"], fontSize: 11 }} interval={0} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: c["muted-foreground"], fontSize: 11 }} width={32} />
            <Tooltip
              cursor={{ fill: c.grid, opacity: 0.6 }}
              content={({ active, payload, label }) => active && payload?.[0] ? (
                <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                  <p className="font-medium text-foreground">Week of {label}</p>
                  <p className="text-muted-foreground">{Number(payload[0].value)} discovered</p>
                </div>
              ) : null}
            />
            <Bar dataKey="discovered" fill={c["series-1"]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
