"use client";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ActionStateLike } from "./action-button";

/**
 * Wraps fields in a form bound to a server action. Submits without React's automatic form
 * reset, so when the server rejects a submission the person's input is kept; after a
 * successful save the form resets to its (refreshed) defaults.
 */
export function ActionForm({ action, submitLabel, children, className, disabled }: { action: (prev: ActionStateLike, form: FormData) => Promise<ActionStateLike>; submitLabel: string; children: React.ReactNode; className?: string; disabled?: boolean }) {
  const [state, run, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state.at) ref.current?.reset();
  }, [state.ok, state.at]);
  return (
    <form
      ref={ref}
      className={className ?? "space-y-4"}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
    >
      <fieldset disabled={disabled || pending} className="contents">{children}</fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || disabled}>{pending ? "Working…" : submitLabel}</Button>
        {state.error && <span role="status" className="text-sm text-destructive">{state.error}</span>}
        {state.message && !state.error && <span role="status" className="text-sm text-success">{state.message}</span>}
      </div>
    </form>
  );
}
