import { Badge } from "@/components/ui/badge";
import { humanise } from "@/lib/industries";

const STATUS_TONE: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  new: "secondary", researching: "secondary", qualified: "default", not_qualified: "outline",
  prototype_generated: "default", awaiting_deployment_approval: "warning", deployed: "success",
  awaiting_email_approval: "warning", contacted: "default", replied: "success", interested: "success",
  meeting_requested: "success", converted: "success", not_interested: "outline", suppressed: "destructive",
  draft: "secondary", generated: "default", quality_checked: "default", awaiting_approval: "warning", approved: "success",
  rejected: "destructive", changes_requested: "warning", failed: "destructive", review: "warning", sending: "default",
  sent: "success", cancelled: "outline", blocked: "destructive", pending: "secondary", uploading: "default",
  succeeded: "success", verified: "success", running: "default", paused: "warning", queued: "secondary",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_TONE[status] ?? "secondary"}>{humanise(status)}</Badge>;
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground">—</span>;
  const tone = score >= 70 ? "bg-success/12 text-success" : score >= 45 ? "bg-warning/18 text-[oklch(0.45_0.12_70)]" : "bg-muted text-muted-foreground";
  return <span className={`inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>{score}</span>;
}

export function DemoBadge({ show = true }: { show?: boolean }) {
  return show ? <Badge variant="demo" title="Fictional demo data — never contacted">Demo</Badge> : null;
}

export function BasisBadge({ basis }: { basis: string }) {
  if (basis === "observed") return <Badge variant="secondary" title="Measured by our crawler">Observed</Badge>;
  if (basis === "ai_judgement") return <Badge variant="default" title="Opinion produced by AI">AI judgement</Badge>;
  return <Badge variant="outline">{humanise(basis)}</Badge>;
}
