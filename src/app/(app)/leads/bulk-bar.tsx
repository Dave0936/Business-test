"use client";
import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { queueAction } from "./actions";

/** Submits the surrounding #bulk form's checked rows to a job-queue action. */
export function BulkBar() {
  const [state, run, pending] = useActionState(queueAction, {});
  const act = (type: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = (e.currentTarget.closest("form") as HTMLFormElement) ?? undefined;
    const fd = new FormData(form);
    fd.set("type", type);
    e.preventDefault();
    startTransition(() => run(fd));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <span className="text-xs text-muted-foreground">With selected:</span>
      <Button size="sm" variant="outline" disabled={pending} onClick={act("audit")}>Audit &amp; score</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={act("research")}>Research design</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={act("generate")}>Generate prototype</Button>
      {state.error && <span className="text-xs text-destructive" role="status">{state.error}</span>}
      {state.message && !state.error && <span className="text-xs text-success" role="status">{state.message}</span>}
    </div>
  );
}
