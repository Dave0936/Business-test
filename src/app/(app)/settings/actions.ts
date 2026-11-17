"use server";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { createServiceClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit-log";
import { env } from "@/lib/env";

const OrgSchema = z.object({
  name: z.string().min(2).max(120),
  agency_name: z.string().max(120).optional(),
  agency_postal_address: z.string().max(400).optional(),
  agency_reply_email: z.string().email().optional().or(z.literal("")),
  agency_website: z.string().url().optional().or(z.literal("")),
  default_country_code: z.string().regex(/^[A-Z]{2}$/).optional().or(z.literal("")),
  daily_email_limit: z.coerce.number().int().min(0).max(5000),
  monthly_ai_budget_usd: z.coerce.number().min(0).max(100000),
});

export async function saveOrganisation(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const d = OrgSchema.parse(Object.fromEntries(["name", "agency_name", "agency_postal_address", "agency_reply_email", "agency_website", "default_country_code", "daily_email_limit", "monthly_ai_budget_usd"].map((k) => [k, str(form, k)])));
    const patch = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === "" ? null : v]));
    const { error } = await ctx.supabase.from("organisations").update(patch).eq("id", ctx.organisationId);
    if (error) throw error;
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "organisation.updated", entityType: "organisation", entityId: ctx.organisationId, data: { fields: Object.keys(patch) } });
    return "Settings saved.";
  }, "/settings");
}

const Role = z.enum(["owner", "administrator", "staff", "read_only"]);

export async function inviteMember(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("owner", async (ctx) => {
    const email = z.string().email().parse(str(form, "email").toLowerCase());
    const role = Role.parse(str(form, "role"));
    const admin = createServiceClient();
    // Find an existing account, or send a Supabase invitation.
    let userId: string | undefined;
    const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (existing) userId = existing.id;
    else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl}/auth/callback?next=/overview` });
      if (error) throw new Error(`Invitation failed: ${error.message}`);
      userId = data.user.id;
    }
    // Insert as the owner (RLS: only owners may add members).
    const { error } = await ctx.supabase.from("organisation_members").upsert({ organisation_id: ctx.organisationId, user_id: userId, role }, { onConflict: "organisation_id,user_id" });
    if (error) throw error;
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "member.invited", entityType: "user", entityId: userId, data: { email, role } });
    return existing ? `${email} added as ${role.replace("_", " ")}.` : `Invitation sent to ${email}.`;
  }, "/settings");
}

export async function changeRole(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("owner", async (ctx) => {
    const userId = z.string().uuid().parse(str(form, "userId"));
    const role = Role.parse(str(form, "role"));
    if (userId === ctx.user.id && role !== "owner") {
      const { count } = await ctx.supabase.from("organisation_members").select("user_id", { count: "exact", head: true }).eq("organisation_id", ctx.organisationId).eq("role", "owner");
      if ((count ?? 0) <= 1) throw new Error("You are the only owner. Make someone else an owner first.");
    }
    const { error } = await ctx.supabase.from("organisation_members").update({ role }).eq("organisation_id", ctx.organisationId).eq("user_id", userId);
    if (error) throw error;
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "member.role_changed", entityType: "user", entityId: userId, data: { role } });
    return "Role updated.";
  }, "/settings");
}

export async function removeMember(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("owner", async (ctx) => {
    const userId = z.string().uuid().parse(str(form, "userId"));
    if (userId === ctx.user.id) throw new Error("You cannot remove yourself.");
    const { error } = await ctx.supabase.from("organisation_members").delete().eq("organisation_id", ctx.organisationId).eq("user_id", userId);
    if (error) throw error;
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "member.removed", entityType: "user", entityId: userId });
    return "Member removed.";
  }, "/settings");
}

/** Change the signed-in user's own password (any role). */
export async function changePassword(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("read_only", async (ctx) => {
    const password = str(form, "password");
    if (password.length < 10) throw new Error("Use at least 10 characters.");
    if (password !== str(form, "confirm")) throw new Error("The two passwords do not match.");
    const { error } = await ctx.supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "account.password_changed", entityType: "user", entityId: ctx.user.id });
    return "Password changed. Use it next time you sign in.";
  });
}

/**
 * Change the signed-in user's email. Supabase sends a confirmation link to the new
 * address (and, with "secure email change" on, to the old one); the change applies once confirmed.
 */
export async function changeEmail(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("read_only", async (ctx) => {
    const email = z.string().trim().toLowerCase().email("Enter a valid email address.").parse(str(form, "email"));
    if (email === ctx.user.email) throw new Error("That is already your email address.");
    const { error } = await ctx.supabase.auth.updateUser({ email }, { emailRedirectTo: `${env.appUrl}/auth/callback?next=/settings` });
    if (error) throw new Error(error.message);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "account.email_change_requested", entityType: "user", entityId: ctx.user.id, data: { to: email } });
    return `Check ${email} for a confirmation link. Your sign-in email changes once you open it.`;
  });
}

const LiaSchema = z.object({
  purpose: z.string().min(30, "Describe the purpose in a little more detail.").max(2000),
  necessity: z.string().min(30, "Explain why email is necessary in a little more detail.").max(2000),
  balancing: z.string().min(30, "Explain the balance with recipients' interests in a little more detail.").max(2000),
  safeguards: z.string().min(10).max(2000),
});

/**
 * Record the organisation's legitimate interests assessment (UK/EU GDPR). Emails relying on
 * legitimate interests are blocked until one exists. Owners and administrators only.
 */
export async function saveLia(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const d = LiaSchema.parse({ purpose: str(form, "purpose"), necessity: str(form, "necessity"), balancing: str(form, "balancing"), safeguards: str(form, "safeguards") });
    if (form.get("confirm") !== "on") throw new Error("Confirm that this reflects how you will use email.");
    const { data: org, error } = await ctx.supabase.from("organisations").select("settings").eq("id", ctx.organisationId).single();
    if (error) throw error;
    const now = new Date();
    const lia = { ...d, completed_at: now.toISOString(), completed_by: ctx.user.id, review_by: new Date(now.getTime() + 365 * 86400_000).toISOString() };
    const { error: uErr } = await ctx.supabase.from("organisations").update({ settings: { ...((org.settings as Record<string, unknown>) ?? {}), lia } }).eq("id", ctx.organisationId);
    if (uErr) throw uErr;
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "compliance.lia_recorded", entityType: "organisation", entityId: ctx.organisationId, data: { review_by: lia.review_by } });
    return "Assessment saved. Re-check any blocked emails so they pick it up.";
  }, ["/settings", "/emails"]);
}

/** The agency's house style: design guidance the site builder follows on every build. */
export async function saveHouseStyle(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const text = String(form.get("houseStyle") ?? "").replace(/\r\n/g, "\n").trim();
    if (text.length > 20000) throw new Error("Keep the house style under 20,000 characters.");
    const { data: org, error } = await ctx.supabase.from("organisations").select("settings").eq("id", ctx.organisationId).single();
    if (error) throw error;
    const { error: uErr } = await ctx.supabase.from("organisations").update({ settings: { ...((org.settings as Record<string, unknown>) ?? {}), house_style: text || null } }).eq("id", ctx.organisationId);
    if (uErr) throw uErr;
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "design.house_style_saved", entityType: "organisation", entityId: ctx.organisationId, data: { length: text.length } });
    return text ? "Saved. Every build from now on follows it." : "Cleared.";
  }, "/settings");
}
