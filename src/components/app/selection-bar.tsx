"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionStateLike } from "./action-button";

export interface SelectionOp {
  op: string;
  label: string;
  /** Ask before running. "{n}" is replaced with the number selected. */
  confirm?: string;
  /** Runs without any rows selected (for example "remove older history"). */
  noSelection?: boolean;
  variant?: "outline" | "ghost" | "destructive";
}

/**
 * A bar for the surrounding <form>: a select-all box, the number selected, and buttons that send
 * the checked rows (checkboxes named `name`) to one server action with an `op` field.
 */
export function SelectionBar({ action, name, ops, label = "With selected:" }: {
  action: (prev: ActionStateLike, form: FormData) => Promise<ActionStateLike>;
  name: string;
  ops: SelectionOp[];
  label?: string;
}) {
  const [state, run, pending] = useActionState(action, {});
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);

  // Rows can sit inside the form or point at it with form="…" (so rows may hold their own forms).
  const boxes = () => Array.from(ref.current?.closest("form")?.elements ?? []).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "checkbox" && el.name === name);
  useEffect(() => {
    const update = () => {
      const all = boxes();
      setTotal(all.length);
      setCount(all.filter((b) => b.checked).length);
    };
    update();
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Rows can disappear after an action (deleted or restored): count again.
  useEffect(() => {
    if (!state.at) return;
    const t = setTimeout(() => {
      const all = boxes();
      setTotal(all.length);
      setCount(all.filter((b) => b.checked).length);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at]);

  const go = (o: SelectionOp) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (o.confirm && !window.confirm(o.confirm.replace("{n}", String(count)))) return;
    const form = ref.current?.closest("form") ?? undefined;
    const fd = new FormData(form);
    fd.set("op", o.op);
    startTransition(() => run(fd));
  };

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-2 border-b px-3 py-2" data-testid={`selection-${name}`}>
      <input
        type="checkbox"
        className="size-4"
        aria-label="Select all"
        checked={total > 0 && count === total}
        ref={(el) => { if (el) el.indeterminate = count > 0 && count < total; }}
        onChange={(e) => {
          for (const b of boxes()) b.checked = e.currentTarget.checked;
          setCount(e.currentTarget.checked ? total : 0);
        }}
      />
      <span className="text-xs text-muted-foreground">{count ? `${count} selected` : label}</span>
      {ops.map((o) => (
        <Button key={o.op} size="sm" variant={o.variant ?? "outline"} disabled={pending || (!o.noSelection && count === 0)} onClick={go(o)}>{o.label}</Button>
      ))}
      {state.error && <span className="text-xs text-destructive" role="status">{state.error}</span>}
      {state.message && !state.error && <span className="text-xs text-success" role="status">{state.message}</span>}
    </div>
  );
}
