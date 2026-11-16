import { BasisBadge } from "./badges";
import { Progress } from "@/components/ui/progress";

interface Criterion { id: string; label: string; weight: number; points: number; basis: string; reason: string }

/** Transparent breakdown: every point of the opportunity score is explained. */
export function ScoreBreakdown({ score, breakdown, threshold, weightsVersion }: { score: number; breakdown: { criteria: Criterion[]; contactable?: boolean }; threshold: number; weightsVersion: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums">{score}</span>
        <span className="text-sm text-muted-foreground">/ 100 opportunity · qualifies at {threshold}{breakdown.contactable === false ? " · no contact route found" : ""}</span>
      </div>
      <ul className="space-y-3">
        {breakdown.criteria.map((c) => (
          <li key={c.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{c.label} <BasisBadge basis={c.basis} /></span>
              <span className="tabular-nums text-muted-foreground">+{c.points} of {c.weight}</span>
            </div>
            <Progress value={(100 * c.points) / c.weight} tone={c.basis === "ai_judgement" ? "primary" : c.points / c.weight > 0.5 ? "warning" : "success"} />
            <p className="text-xs text-muted-foreground">{c.reason}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Higher means more room for improvement. Weights version {weightsVersion}. Visual simplicity is never scored as “outdated”.</p>
    </div>
  );
}
