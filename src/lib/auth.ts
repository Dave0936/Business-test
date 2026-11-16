import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createUserClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";

export type Role = "owner" | "administrator" | "staff" | "read_only";

export interface OrgContext {
  supabase: SupabaseClient;
  user: User;
  organisationId: string;
  organisationName: string;
  role: Role;
  memberships: { organisation_id: string; role: Role; name: string }[];
}

const ROLE_RANK: Record<Role, number> = { read_only: 0, staff: 1, administrator: 2, owner: 3 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export const canWrite = (r: Role) => roleAtLeast(r, "staff");
export const canApprove = (r: Role) => roleAtLeast(r, "administrator");

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

/** Resolve the signed-in user and their active organisation, or redirect. */
export async function getOrgContext(): Promise<OrgContext> {
  if (!supabaseConfigured()) redirect("/setup");
  const supabase = await createUserClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: rows, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, organisations(name)")
    .eq("user_id", auth.user.id);
  if (error) throw error;
  if (!rows || rows.length === 0) redirect("/onboarding");

  const memberships = rows.map((r) => ({
    organisation_id: r.organisation_id as string,
    role: r.role as Role,
    name: ((r.organisations as unknown as { name: string } | null)?.name ?? "Organisation") as string,
  }));
  const preferred = (await cookies()).get("wo_org")?.value;
  const active = memberships.find((m) => m.organisation_id === preferred) ?? memberships[0];

  return {
    supabase,
    user: auth.user,
    organisationId: active.organisation_id,
    organisationName: active.name,
    role: active.role,
    memberships,
  };
}

export async function requireRole(min: Role): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!roleAtLeast(ctx.role, min)) throw new ForbiddenError();
  return ctx;
}
