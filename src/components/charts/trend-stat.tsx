import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Headline number with a real period comparison. With no previous-period data
 * the change line is omitted rather than invented.
 */
export function TrendStat({ label, value, current, previous, days, href, icon: Icon, tone }: { label: string; value: number | string; current?: number; previous?: number; days?: number; href?: string; icon: LucideIcon; tone: string }) {
  let change: React.ReactNode = null;
  if (current !== undefined && previous !== undefined && days) {
    if (previous > 0) {
      const pct = Math.round(((current - previous) / previous) * 100);
      const up = pct >= 0;
      change = (
        <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-success" : "text-destructive")}>
          {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {Math.abs(pct)}% <span className="font-normal text-muted-foreground">vs previous {days} days</span>
        </span>
      );
    } else if (current > 0) {
      change = <span className="text-xs text-muted-foreground">+{current} in the last {days} days</span>;
    }
  }
  const body = (
    <div className="h-full rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgba(27,42,58,0.04),0_8px_24px_-12px_rgba(27,42,58,0.08)] transition-colors hover:border-ring/40">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-8 place-items-center rounded-lg", tone)}><Icon className="size-4" /></span>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
      <div className="mt-1 min-h-4">{change}</div>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
