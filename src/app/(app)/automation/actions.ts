"use server";
import { z } from "zod";
import { guarded, kickWorker, str, type ActionState } from "@/lib/actions";
import { writeAudit } from "@/lib/audit-log";
import { startWorkflowRun, type WorkflowConfig } from "@/lib/jobs/worker";

const Id = z.string().uuid();
const PATHS = ["/automation", "/overview"];

/** Pause or resume all automation: no scheduled searches start and running runs stop picking up work. */
export async function setAutomationPausedAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const paused = str(form, "paused") === "1";
    const { data: org, error } = await ctx.supabase.from("organisations").select("settings").eq("id", ctx.organisationId).single();
    if (error) throw error;
    const { error: uErr } = await ctx.supabase.from("organisations").update({ settings: { ...((org.settings as Record<string, unknown>) ?? {}), automation_paused: paused } }).eq("id", ctx.organisationId);
    if (uErr) throw uErr;
    // Running runs hold their queued work while paused (the worker skips paused runs).
    await ctx.supabase.from("automation_runs").update({ status: paused ? "paused" : "running" }).eq("organisation_id", ctx.organisationId).eq("status", paused ? "running" : "paused");
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: paused ? "automation.paused" : "automation.resumed", entityType: "organisation", entityId: ctx.organisationId, data: {} });
    if (!paused) kickWorker(ctx);
    return paused ? "All automation is paused." : "Automation resumed.";
  }, PATHS);
}

export async function runWorkflowNowAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = Id.parse(str(form, "workflowId"));
    const { data: wf, error } = await ctx.supabase.from("automation_workflows").select("id, name, config").eq("id", id).eq("organisation_id", ctx.organisationId).single();
    if (error || !wf) throw new Error("Saved search not found.");
    const runId = await startWorkflowRun(ctx.supabase, ctx.organisationId, wf.id, wf.config as WorkflowConfig, ctx.user.id);
    await ctx.supabase.from("automation_workflows").update({ last_run_at: new Date().toISOString() }).eq("id", wf.id);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "automation.run_started", entityType: "automation_run", entityId: runId, data: { workflow_id: wf.id } });
    kickWorker(ctx);
    return `Started "${wf.name}".`;
  }, PATHS);
}

export async function updateWorkflowAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = Id.parse(str(form, "workflowId"));
    const op = z.enum(["pause", "resume", "weekly", "monthly"]).parse(str(form, "op"));
    const patch: Record<string, unknown> =
      op === "pause" ? { paused: true } :
      op === "resume" ? { paused: false } :
      { frequency_minutes: op === "weekly" ? 7 * 1440 : 28 * 1440, next_run_at: new Date(Date.now() + (op === "weekly" ? 7 : 28) * 86400_000).toISOString() };
    if (op === "resume") {
      // Resuming a long-paused search should not start it the same minute unless it is due.
      const { data: wf } = await ctx.supabase.from("automation_workflows").select("next_run_at, frequency_minutes").eq("id", id).single();
      if (wf && !wf.next_run_at && wf.frequency_minutes) patch.next_run_at = new Date(Date.now() + wf.frequency_minutes * 60_000).toISOString();
    }
    const { error, count } = await ctx.supabase.from("automation_workflows").update(patch, { count: "exact" }).eq("id", id).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    if (!count) throw new Error("Saved search not found.");
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: `automation.workflow_${op}`, entityType: "automation_workflow", entityId: id, data: {} });
    return op === "pause" ? "Paused." : op === "resume" ? "Resumed." : `Now runs every ${op === "weekly" ? "week" : "4 weeks"}.`;
  }, PATHS);
}

export async function deleteWorkflowAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const id = Id.parse(str(form, "workflowId"));
    const { error, count } = await ctx.supabase.from("automation_workflows").delete({ count: "exact" }).eq("id", id).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    if (!count) throw new Error("Saved search not found.");
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "automation.workflow_deleted", entityType: "automation_workflow", entityId: id, data: {} });
    return "Deleted. Leads it already found are kept.";
  }, PATHS);
}

/** Stop a run: its queued work is cancelled; finished work (leads, audits, prototypes) is kept. */
export async function cancelRunAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = Id.parse(str(form, "runId"));
    const { data, error } = await ctx.supabase.rpc("cancel_run", { p_run: id });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This run has already finished.");
    return "Stopped. Work already done is kept.";
  }, [...PATHS, "/automation/runs"]);
}
