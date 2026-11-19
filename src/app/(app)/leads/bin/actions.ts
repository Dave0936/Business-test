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

/** The bin's selection bar: restore or delete the selected leads, or empty the bin. */
export async function binSelectionAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const op = z.enum(["restore", "purge", "empty"]).parse(str(form, "op"));
  return guarded(op === "restore" ? "staff" : "administrator", async (ctx) => {
    const db = await createUserClient({ includeBinned: true });
    let ids = form.getAll("businessId").map(String).filter((x) => z.string().uuid().safeParse(x).success);
    if (op === "empty") {
      const { data } = await db.from("businesses").select("id").eq("organisation_id", ctx.organisationId).not("deleted_at", "is", null).limit(500);
      ids = (data ?? []).map((r) => r.id);
    }
    if (!ids.length) throw new Error(op === "empty" ? "The bin is already empty." : "Select at least one lead.");
    let done = 0;
    const kept: string[] = [];
    for (const id of ids) {
      const { data, error } = op === "restore"
        ? await db.rpc("bin_business", { p_business: id, p_restore: true })
        : await db.rpc("purge_business", { p_business: id });
      if (error) kept.push(error.message);
      else if (data) done++;
    }
    const verb = op === "restore" ? "Restored" : "Deleted permanently:";
    return `${verb} ${done} lead${done === 1 ? "" : "s"}.${kept.length ? ` ${kept.length} kept (${kept[0]}).` : ""}`;
  }, PATHS);
}
