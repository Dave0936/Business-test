import type { Metadata } from "next";
import { supabaseConfigured } from "@/lib/env";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Setup required" };

export default function SetupPage() {
  if (supabaseConfigured()) redirect("/overview");
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-10">
      <h1 className="text-2xl font-semibold">WebOpportunity AI needs a database</h1>
      <p className="text-muted-foreground">Supabase is not configured yet. Add these to <code className="rounded bg-muted px-1">.env.local</code> (see <code className="rounded bg-muted px-1">.env.example</code>) and restart the server:</p>
      <pre className="overflow-x-auto rounded-lg border bg-card p-4 text-sm">{`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)`}</pre>
      <p className="text-sm text-muted-foreground">Then apply the migrations in <code>supabase/migrations</code> with <code>npx supabase db push</code>. Full steps are in the README under “Setup”.</p>
    </main>
  );
}
