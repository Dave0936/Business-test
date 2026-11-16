import "server-only";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getOrgContext, roleAtLeast, type OrgContext, type Role } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { runWorkerSlice } from "@/lib/jobs/worker";

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Changes on every call so client components can react to repeat results. */
  at?: number;
}

/** Run a server action with a role check; errors become user-facing messages. */
export async function guarded(min: Role, fn: (ctx: OrgContext) => Promise<string | void>, revalidate?: string | string[]): Promise<ActionState> {
  let ctx: OrgContext;
  try {
    ctx = await getOrgContext();
  } catch (e) {
    throw e; // redirects
  }
  if (!roleAtLeast(ctx.role, min)) return { error: `Your role (${ctx.role.replace("_", " ")}) cannot do this.`, at: Date.now() };
  try {
    const message = await fn(ctx);
    for (const p of [revalidate ?? []].flat()) revalidatePath(p);
    return { ok: true, message: message ?? "Done.", at: Date.now() };
  } catch (e) {
    const err = e as { message?: string; digest?: string };
    if (err.digest?.startsWith("NEXT_REDIRECT")) throw e;
    return { error: err.message ?? "Something went wrong.", at: Date.now() };
  }
}

/**
 * Process queued jobs right after the response is sent, so work starts without
 * waiting for the standalone worker. Needs the service role key; otherwise the
 * jobs wait for `npm run worker` or the cron endpoint.
 */
export function kickWorker() {
  if (!env.supabaseServiceRoleKey) return;
  after(async () => {
    try {
      await runWorkerSlice(createServiceClient(), { deadlineMs: 55_000, maxJobs: 25 });
    } catch (e) {
      console.error("worker slice failed", e);
    }
  });
}

export function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}
