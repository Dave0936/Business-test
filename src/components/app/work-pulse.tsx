"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Keeps queued searches, audits and other work moving while the app is open, and shows
 * how much is left. Background work also runs right after each action; this picks up
 * whatever did not fit in that window. Pauses while the tab is hidden.
 */
export function WorkPulse({ initialPending, canProcess }: { initialPending: number; canProcess: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(initialPending);
  const busy = useRef(false);

  // A server render (for example after starting a search) brings a fresh count.
  const [seenInitial, setSeenInitial] = useState(initialPending);
  if (seenInitial !== initialPending) {
    setSeenInitial(initialPending);
    setPending(initialPending);
  }

  useEffect(() => {
    if (!canProcess || pending === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState !== "visible" || busy.current) {
        timer = setTimeout(tick, 5000);
        return;
      }
      busy.current = true;
      try {
        const res = await fetch("/api/work", { method: "POST", cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = (await res.json()) as { queued: number; running: number; nextInSeconds: number | null; processed: number };
        if (stopped) return;
        setPending(r.queued + r.running);
        if (r.processed > 0) router.refresh();
        if (r.queued + r.running === 0) return;
        const wait = r.processed > 0 ? 1000 : Math.min(60, Math.max(5, r.nextInSeconds ?? 10)) * 1000;
        timer = setTimeout(tick, wait);
      } catch {
        timer = setTimeout(tick, 30_000);
      } finally {
        busy.current = false;
      }
    };
    timer = setTimeout(tick, 4000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [canProcess, pending === 0, router]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pending === 0) return null;
  return (
    <span className="hidden items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs text-muted-foreground sm:inline-flex" role="status" aria-live="polite">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {pending} {pending === 1 ? "task" : "tasks"} in progress
    </span>
  );
}
