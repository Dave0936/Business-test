import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-brand p-12 text-brand-foreground lg:flex">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-brand-foreground">
          <span className="grid size-7 place-items-center rounded-md bg-highlight text-xs text-highlight-foreground">WO</span> WebOpportunity AI
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="text-4xl font-semibold leading-tight text-brand-foreground">Find the businesses the web left behind. Show them what better looks like.</h1>
          <p className="text-brand-foreground/70">Discovery, audits, design research and site concepts run on their own. Every deployment and every email waits for your approval.</p>
        </div>
        <p className="text-xs text-brand-foreground/70">Nothing is deployed or sent without a person approving it.</p>
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-highlight/25 blur-3xl" />
      </section>
      <section className="flex items-center justify-center p-6">
        <LoginForm next={next} />
      </section>
    </main>
  );
}
