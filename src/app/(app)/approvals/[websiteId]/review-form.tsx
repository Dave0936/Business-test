"use client";
import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WEBSITE_REVIEW_ITEMS } from "@/lib/approvals/review";
import type { ActionStateLike } from "@/components/app/action-button";

/**
 * The reviewer's checklist, comment and decision. Approve stays disabled until every item is
 * ticked; the server and the database check the same rules again.
 */
export function ReviewForm({ action, websiteId, versionId, versionLabel }: { action: (prev: ActionStateLike, form: FormData) => Promise<ActionStateLike>; websiteId: string; versionId: string; versionLabel: string }) {
  const [state, run, pending] = useActionState(action, {});
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const all = ticked.size === WEBSITE_REVIEW_ITEMS.length;

  return (
    <form
      className="space-y-4"
      data-testid="review-form"
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => run(data));
      }}
    >
      <input type="hidden" name="websiteId" value={websiteId} />
      <input type="hidden" name="versionId" value={versionId} />
      <fieldset disabled={pending} className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Before approving {versionLabel}, confirm:</legend>
        {WEBSITE_REVIEW_ITEMS.map((item) => (
          <label key={item.key} className="flex items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
            <input
              type="checkbox"
              name="check"
              value={item.key}
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={ticked.has(item.key)}
              onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(item.key); else n.delete(item.key); return n; })}
            />
            <span><span className="font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.hint}</span></span>
          </label>
        ))}
        <div className="space-y-1.5">
          <label htmlFor="comment" className="text-sm font-medium">Comment</label>
          <Textarea id="comment" name="comment" rows={3} maxLength={2000} placeholder="Optional when approving. When requesting changes or rejecting, say what needs to change or why." />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="decision" value="approved" disabled={pending || !all} title={all ? undefined : "Tick every checklist item first"}>{pending ? "Working…" : "Approve"}</Button>
        <Button type="submit" name="decision" value="changes_requested" variant="outline" disabled={pending}>Request changes</Button>
        <Button type="submit" name="decision" value="rejected" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending}>Reject</Button>
      </div>
      {state.error && <p role="status" className="text-sm text-destructive">{state.error}</p>}
      {state.message && !state.error && <p role="status" className="text-sm text-success">{state.message}</p>}
      <p className="text-xs text-muted-foreground">Approving does not publish anything. Deployment is a separate step, and only this exact version can be deployed.</p>
    </form>
  );
}
