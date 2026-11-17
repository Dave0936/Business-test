"use server";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { checklistFrom, decisionProblems, DECISION_LABEL, type Decision } from "@/lib/approvals/review";
import { recheckCurrentVersion } from "@/lib/sites/builder";
import { writeAudit } from "@/lib/audit-log";

const DecisionSchema = z.enum(["approved", "changes_requested", "rejected"]);

/**
 * Record an owner's or administrator's decision on the version they reviewed.
 * decide_approval() checks the role, the version, the checklist and the reason again,
 * and writes the approval, the activity and the audit entry in one transaction.
 */
export async function decideWebsiteAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const websiteId = z.string().uuid().parse(str(form, "websiteId"));
    const versionId = z.string().uuid().parse(str(form, "versionId"));
    const decision: Decision = DecisionSchema.parse(str(form, "decision"));
    const comment = str(form, "comment").slice(0, 2000);
    const checklist = checklistFrom(form.getAll("check").map(String));
    const problems = decisionProblems(decision, checklist, comment);
    if (problems.length) throw new Error(problems.join(" "));

    const { error } = await ctx.supabase.rpc("decide_approval", {
      p_subject_type: "website", p_subject_id: websiteId, p_decision: decision,
      p_comment: comment || null, p_version: versionId, p_checklist: checklist,
    });
    if (error) throw new Error(error.message.replace(/^.*?ERROR:\s*/i, ""));

    if (decision !== "approved") {
      // Back to the prototype stage on the lead, so it is clear work is needed.
      const { data: site } = await ctx.supabase.from("generated_websites").select("business_id").eq("id", websiteId).eq("organisation_id", ctx.organisationId).single();
      if (site) {
        await ctx.supabase.from("businesses").update({ status: "prototype_generated" })
          .eq("id", site.business_id).eq("organisation_id", ctx.organisationId).eq("status", "awaiting_deployment_approval");
      }
    }
    return `${DECISION_LABEL[decision]}.${decision === "approved" ? " Nothing is published until someone deploys it." : ""}`;
  }, ["/approvals", "/builder", "/overview"]);
}

/** Run the quality checks again on a website's current version. */
export async function recheckWebsiteAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const websiteId = z.string().uuid().parse(str(form, "websiteId"));
    const r = await recheckCurrentVersion(ctx.supabase, ctx.organisationId, websiteId, ctx.user.id);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "website.qa_rechecked", entityType: "website", entityId: websiteId, data: { passed: r.report.passed } });
    if (!r.report.passed) return "Checked again: some checks failed. Fix them in a new version.";
    return r.status === "awaiting_approval" ? "Checked again: all required checks passed. It is waiting for approval." : "Checked again: all required checks passed.";
  }, ["/approvals", "/builder"]);
}
