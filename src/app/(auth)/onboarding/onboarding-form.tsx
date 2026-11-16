"use client";
import { useActionState } from "react";
import { createOrganisation, type FormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OnboardingForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createOrganisation, {});
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Agency name</Label>
        <Input id="name" name="name" required minLength={2} maxLength={120} placeholder="Northlight Web Studio" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</Button>
    </form>
  );
}
