"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { unsubscribeAction, type UnsubscribeState } from "./actions";

export function UnsubscribeForm({ token, sender }: { token: string; sender: string }) {
  const [state, run, pending] = useActionState<UnsubscribeState, FormData>(unsubscribeAction, {});
  if (state.done) return <p role="status" className="font-medium">Done. {sender} will not email this address again.</p>;
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending}>{pending ? "Unsubscribing…" : "Unsubscribe"}</Button>
      {state.error && <p role="status" className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
