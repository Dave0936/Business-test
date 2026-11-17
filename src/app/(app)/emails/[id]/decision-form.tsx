"use client";
import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionStateLike } from "@/components/app/action-button";

/** Approve, request changes or reject an email. Approve needs the "read it all" box ticked. */
export function EmailDecisionForm({ action, draftId, canApprove }: { action: (prev: ActionStateLike, form: FormData) => Promise<ActionStateLike>; draftId: string; canApprove: boolean }) {
  const [state, run, pending] = useActionState(action, {});
  const [read, setRead] = useState(false);
  return (
    <form
      className="space-y-3"
      data-testid="email-decision"
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => run(data));
      }}
    >
      <input type="hidden" name="draftId" value={draftId} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="read" className="mt-0.5 size-4" checked={read} onChange={(e) => setRead(e.target.checked)} disabled={pending} />
        <span>I have read the whole email, including the footer, and everything it says about the business is true.</span>
      </label>
      <div className="space-y-1.5">
        <label htmlFor="decision-comment" className="text-sm font-medium">Comment</label>
        <Textarea id="decision-comment" name="comment" rows={2} maxLength={2000} disabled={pending} placeholder="Optional when approving. Say what to change, or why you are rejecting it." />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approved" disabled={pending || !read || !canApprove} title={!canApprove ? "Its checks must pass first" : !read ? "Tick the box first" : undefined}>{pending ? "Working…" : "Approve"}</Button>
        <Button type="submit" name="decision" value="changes_requested" variant="outline" disabled={pending}>Request changes</Button>
        <Button type="submit" name="decision" value="rejected" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending}>Reject</Button>
      </div>
      {state.error && <p role="status" className="text-sm text-destructive">{state.error}</p>}
      {state.message && !state.error && <p role="status" className="text-sm text-success">{state.message}</p>}
    </form>
  );
}
