import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdmin, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Per-request client acting as the signed-in user. Row-level security applies,
 * so this is the default for everything a person does in the UI.
 */
export async function createUserClient(): Promise<SupabaseClient> {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; proxy.ts refreshes sessions.
        }
      },
    },
  });
}

let adminClient: SupabaseClient | undefined;

/**
 * Service-role client. Bypasses RLS, so callers MUST scope every query by
 * organisation_id. Used only by the worker, webhooks and the deployment/sending
 * services, which the database additionally guards with approval triggers.
 */
export function createServiceClient(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for background jobs and webhooks.");
  }
  adminClient ??= createAdmin(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}
