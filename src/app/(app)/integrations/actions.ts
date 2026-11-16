"use server";
import { guarded, str, type ActionState } from "@/lib/actions";
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
    const { error } = await ctx.supabase.rpc("save_integration", { p_org: ctx.organisationId, p_provider: str(form, "provider"), p_ciphertext: null, p_config: {}, p_status: "disconnected" });
    if (error) throw new Error(error.message);
    return "Disconnected. The stored key was deleted.";
  }, ["/integrations", "/opportunities"]);
}
