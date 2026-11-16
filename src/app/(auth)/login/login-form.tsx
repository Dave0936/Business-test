"use client";
import { useActionState, useState } from "react";
import { authenticate, type FormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [state, action, pending] = useActionState<FormState, FormData>(authenticate, {});
  return (
    <form action={action} className="w-full max-w-sm space-y-5">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold">{mode === "signup" ? "Create your account" : "Sign in"}</h2>
        <p className="text-sm text-muted-foreground">{mode === "magic" ? "We'll email you a one-time sign-in link." : "Use your work email."}</p>
      </div>
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {mode !== "magic" && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={10} required />
        </div>
      )}
      {state.error && <Alert variant="destructive"><AlertDescription className="text-destructive">{state.error}</AlertDescription></Alert>}
      {state.message && <Alert variant="success"><AlertDescription>{state.message}</AlertDescription></Alert>}
      <Button className="w-full" disabled={pending}>{pending ? "Working…" : mode === "signup" ? "Create account" : mode === "magic" ? "Email me a link" : "Sign in"}</Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-primary hover:underline" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
          {mode === "signup" ? "Have an account? Sign in" : "New here? Create an account"}
        </button>
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setMode(mode === "magic" ? "signin" : "magic")}>
          {mode === "magic" ? "Use password" : "Email link"}
        </button>
      </div>
    </form>
  );
}
