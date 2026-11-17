import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/app/badges";
import { humanise } from "@/lib/industries";
import { formatDate } from "@/lib/utils";
import { canWrite } from "@/lib/auth";
import { ActionButton } from "@/components/app/action-button";
import { cancelRunAction } from "../../actions";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getOrgContext();
  const [{ data: run }, { data: jobs }] = await Promise.all([
    ctx.supabase.from("automation_runs").select("*").eq("id", id).eq("organisation_id", ctx.organisationId).maybeSingle(),
    ctx.supabase.from("jobs").select("id, type, status, attempts, max_attempts, last_error, created_at, finished_at, payload").eq("run_id", id).order("created_at", { ascending: true }).limit(500),
  ]);
  if (!run) notFound();
  const stats = Object.entries(run.stats as Record<string, number>);
  const queued = jobs?.filter((j) => j.status === "queued" || j.status === "running").length ?? 0;

  return (
    <>
      <PageHeader title="Search run" actions={canWrite(ctx.role) && (run.status === "running" || run.status === "paused") ? <ActionButton action={cancelRunAction} hidden={{ runId: id }} label="Stop run" variant="outline" confirm="Stop this run? Queued work is cancelled; leads, audits and prototypes already made are kept." /> : undefined} description={<span className="flex items-center gap-2">Started {formatDate(run.started_at, true)} <StatusBadge status={run.status} /> {queued ? `· ${queued} jobs in progress (updates while this page is open)` : ""}</span>} />
      {run.error && <p className="mb-4 text-sm text-destructive">{run.error}</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader><CardTitle>Results</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {stats.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{humanise(k)}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Jobs</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead><TableHead>Error</TableHead><TableHead>Finished</TableHead></TableRow></TableHeader>
              <TableBody>
                {jobs?.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-sm">{humanise(j.type)}</TableCell>
                    <TableCell><StatusBadge status={j.status} /></TableCell>
                    <TableCell className="text-sm tabular-nums">{j.attempts}/{j.max_attempts}</TableCell>
                    <TableCell className="max-w-72 truncate text-xs text-destructive" title={j.last_error ?? ""}>{j.last_error ?? ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(j.finished_at, true)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
