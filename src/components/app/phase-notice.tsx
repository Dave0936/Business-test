import Link from "next/link";
import { Construction } from "lucide-react";
import { PageHeader } from "./page-header";

/**
 * Shown for modules scheduled for a later build phase. Deliberately not a mock-up:
 * it says what is not built yet and links to what already works.
 */
export function PhaseNotice({ title, phase, summary, available }: { title: string; phase: number; summary: string; available?: { href: string; label: string }[] }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed bg-card/60 p-8">
        <Construction className="size-7 text-muted-foreground" />
        <p className="font-medium">Scheduled for Phase {phase}</p>
        <p className="max-w-2xl text-sm text-muted-foreground">{summary}</p>
        {available?.length ? (
          <div className="flex flex-wrap gap-3 pt-1 text-sm">
            {available.map((a) => <Link key={a.href} href={a.href} className="text-primary hover:underline">{a.label} →</Link>)}
          </div>
        ) : null}
      </div>
    </>
  );
}
