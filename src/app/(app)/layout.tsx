// Per-user, per-request: never prerender (auth state and env are read at request time).
export const dynamic = "force-dynamic";

import Link from "next/link";
import { cookies } from "next/headers";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LogOut } from "lucide-react";
import { getOrgContext } from "@/lib/auth";
import { Sidebar } from "@/components/app/sidebar";
import { Badge } from "@/components/ui/badge";
import { signOut, switchOrganisation } from "../(auth)/actions";
import { integrationStatus } from "@/lib/integrations";
import { humanise } from "@/lib/industries";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOrgContext();
  const theme = (await cookies()).get("wo_theme")?.value;
  const { supabase, organisationId } = ctx;

  const [sites, emails, status] = await Promise.all([
    supabase.from("generated_websites").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("status", "awaiting_approval"),
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).in("status", ["awaiting_approval", "review"]),
    integrationStatus(supabase, organisationId),
  ]);
  const demoParts = [
    status.anthropic.mode !== "live" && "AI",
    status.cloudflare.mode !== "live" && "deployment",
    status.resend.mode !== "live" && "email sending",
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen">
      <Sidebar counts={{ "/approvals": sites.count ?? 0, "/emails": emails.count ?? 0 }} organisationName={ctx.organisationName} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b bg-background/85 px-4 pl-14 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            {ctx.memberships.length > 1 ? (
              <form action={switchOrganisation} className="flex items-center gap-2">
                <select name="organisation_id" defaultValue={organisationId} className="h-8 rounded-md border bg-card px-2 text-sm" aria-label="Organisation">
                  {ctx.memberships.map((m) => (
                    <option key={m.organisation_id} value={m.organisation_id}>{m.name}</option>
                  ))}
                </select>
                <button className="text-xs text-primary hover:underline">Switch</button>
              </form>
            ) : (
              <span className="truncate text-sm font-medium">{ctx.organisationName}</span>
            )}
            <Badge variant="outline">{humanise(ctx.role)}</Badge>
          </div>
          <div className="flex items-center gap-3">
            {demoParts.length > 0 && (
              <Link href="/integrations" className="hidden sm:block">
                <Badge variant="demo" title="Missing credentials. Nothing in these areas is faked; see Integrations.">Not connected: {demoParts.join(", ")}</Badge>
              </Link>
            )}
            <span className="hidden rounded-lg border bg-card px-3 py-1.5 text-xs text-muted-foreground md:inline">{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</span>
            <ThemeToggle initial={theme === "dark" ? "dark" : theme === "light" ? "light" : "system"} />
            <span className="hidden text-sm text-muted-foreground xl:inline">{ctx.user.email}</span>
            <form action={signOut}>
              <button className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-[1480px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
