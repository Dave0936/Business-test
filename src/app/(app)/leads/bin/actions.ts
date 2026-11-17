"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { createUserClient } from "@/lib/supabase/server";

const PATHS = ["/leads", "/leads/bin", "/overview", "/opportunities"];

/** Move a lead to the recycle bin. Unsent emails and queued work for it are cancelled. */
export async function binLeadAction(_p: ActionState, form: FormData): Promise<ActionState> {
  let done = false;
  const r = await guarded("staff", async (ctx) => {
    const id = z.string().uuid().parse(str(form, "businessId"));
    const { data, error } = await ctx.supabase.rpc("bin_business", { p_business: id });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Lead not found.");
    done = true;
  }, PATHS);
  if (done) redirect("/leads?binned=1");
  return r;
}

export async function restoreLeadAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async () => {
    const id = z.string().uuid().parse(str(form, "businessId"));
    const db = await createUserClient({ includeBinned: true });
    const { data, error } = await db.rpc("bin_business", { p_business: id, p_restore: true });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Lead not found.");
    return "Restored.";
  }, PATHS);
}

/** Delete a binned lead and everything about it, now. Owners and administrators only. */
export async function purgeLeadAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const id = z.string().uuid().parse(str(form, "businessId"));
    const { data, error } = await ctx.supabase.rpc("purge_business", { p_business: id });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Lead not found.");
    return "Deleted permanently.";
  }, PATHS);
}
