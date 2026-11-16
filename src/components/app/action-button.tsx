"use client";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";
import type { buttonVariants } from "@/components/ui/button";

export interface ActionStateLike {
  ok?: boolean;
  error?: string;
  message?: string;
  at?: number;
}

/** A button bound to a server action, with pending state and inline result. */
export function ActionButton({
  action, label, pendingLabel, confirm, hidden, variant, size, disabled, title,
}: {
  action: (prev: ActionStateLike, form: FormData) => Promise<ActionStateLike>;
  label: string;
  pendingLabel?: string;
  confirm?: string;
  hidden?: Record<string, string>;
  disabled?: boolean;
  title?: string;
} & VariantProps<typeof buttonVariants>) {
  const [state, run, pending] = useActionState(action, {});
  const [dismissedAt, setDismissedAt] = useState<number | undefined>();
  const shown = Boolean(state.at) && state.at !== dismissedAt;
  useEffect(() => {
    if (!state.at) return;
    const t = setTimeout(() => setDismissedAt(state.at), 6000);
    return () => clearTimeout(t);
  }, [state.at]);
  return (
    <form
      action={run}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Button type="submit" variant={variant} size={size ?? "sm"} disabled={pending || disabled} title={title}>
        {pending ? pendingLabel ?? "Working…" : label}
      </Button>
      {shown && (state.error || state.message) && (
        <span role="status" className={`max-w-xs text-xs ${state.error ? "text-destructive" : "text-success"}`}>{state.error ?? state.message}</span>
      )}
    </form>
  );
}
