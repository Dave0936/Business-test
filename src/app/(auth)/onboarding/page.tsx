import type { Metadata } from "next";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your agency" };

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Set up your agency workspace</h1>
          <p className="text-sm text-muted-foreground">You'll be its owner. You can invite colleagues and set their roles afterwards.</p>
        </div>
        <OnboardingForm />
      </div>
    </main>
  );
}
