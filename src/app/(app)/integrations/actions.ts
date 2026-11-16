"use server";
import { writeAudit } from "@/lib/audit-log";
import { guarded, str, type ActionState } from "@/lib/actions";
import { checkOverpassServers } from "@/lib/providers/discovery/openstreetmap";
import { recordProviderHealth } from "@/lib/providers/discovery/health";
import { encryptSecret } from "@/lib/security/crypto";
import { credentialFields, verifyCredential } from "@/lib/integrations-verify";

/** Verify a credential with the provider, then store it encrypted for this organisation. */
export async function connectIntegration(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const provider = str(form, "provider");
    const fields = credentialFields(provider);
    if (!fields.length) throw new Error("Unknown integration.");
    const values: Record<string, string> = {};
    for (const f of fields) {
      const v = str(form, f.name);
      if (!v) throw new Error(`Enter the ${f.label.toLowerCase()}.`);
      if (v.length > 500) throw new Error(`${f.label} is too long.`);
      values[f.name] = v;
    }
    const check = await verifyCredential(provider, values);
    if (!check.ok) throw new Error(`Not saved: ${check.detail}`);
    const { error } = await ctx.supabase.rpc("save_integration", {
      p_org: ctx.organisationId, p_provider: provider, p_ciphertext: encryptSecret(JSON.stringify(values)),
      p_config: { ...(check.config ?? {}), detail: check.detail }, p_status: "connected",
    });
    if (error) throw new Error(error.message);
    return `Connected. ${check.detail}`;
  }, ["/integrations", "/opportunities"]);
}

export async function disconnectIntegration(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const provider = str(form, "provider");
    const { error } = await ctx.supabase.rpc("save_integration", { p_org: ctx.organisationId, p_provider: provider, p_ciphertext: null, p_config: {}, p_status: "disconnected" });
    if (error) throw new Error(error.message);
    if (provider === "pinterest") {
      // Pinterest content is only kept while the account is connected (see /privacy).
      const [{ count }, links] = await Promise.all([
        ctx.supabase.from("design_references").delete({ count: "exact" }).eq("organisation_id", ctx.organisationId).eq("source", "pinterest"),
        ctx.supabase.from("pinterest_board_links").delete().eq("organisation_id", ctx.organisationId),
      ]);
      if (links.error) throw new Error(links.error.message);
      await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "integration.pinterest_data_deleted", data: { references: count ?? 0 } });
      return `Disconnected. The stored token, your board assignments and ${count ?? 0} saved Pinterest references were deleted.`;
    }
    return "Disconnected. The stored key was deleted.";
  }, ["/integrations", "/opportunities"]);
}

/** Test the free OpenStreetMap servers from this deployment. */
export async function checkOsmAction(_p: ActionState, _form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const results = await checkOverpassServers();
    const ok = results.filter((r) => r.ok).length;
    await recordProviderHealth(ctx.supabase, ctx.organisationId, "openstreetmap", ok > 0, results.map((r) => `${r.host}: ${r.detail}`).join("; "));
    const lines = results.map((r) => `${r.ok ? "OK" : "Problem"}: ${r.host} ${r.ok ? r.detail : `(${r.detail})`}`).join(" · ");
    if (ok === 0) throw new Error(`No OpenStreetMap server answered from this site. ${lines}`);
    return `${ok} of ${results.length} servers working. ${lines}`;
  });
}
