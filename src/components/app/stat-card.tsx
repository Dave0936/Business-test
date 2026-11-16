import Link from "next/link";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "attention" | "good" }) {
  const body = (
    <div className={cn("h-full rounded-xl border bg-card p-4 shadow-xs transition-colors", href && "hover:border-primary/40", tone === "attention" && "border-warning/60 bg-warning/5")}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
