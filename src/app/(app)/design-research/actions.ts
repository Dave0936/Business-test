"use server";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { UPLOAD_BUCKET } from "@/lib/design/studio";
import { assertSafeUrl } from "@/lib/security/safe-fetch";

const RefSchema = z.object({
  businessId: z.string().uuid().optional(),
  sector: z.string().max(40).optional(),
  url: z.string().url(),
  imageUrl: z.string().url().optional(),
  title: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  attribution: z.string().max(200).optional(),
});

/** Manual reference submission. Stored as a link only; images are not copied or re-hosted. */
export async function addReference(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const d = RefSchema.parse({
      businessId: str(form, "businessId") || undefined, sector: str(form, "sector") || undefined, url: str(form, "url"),
      imageUrl: str(form, "imageUrl") || undefined, title: str(form, "title") || undefined, notes: str(form, "notes") || undefined, attribution: str(form, "attribution") || undefined,
    });
    assertSafeUrl(d.url);
    if (d.imageUrl) assertSafeUrl(d.imageUrl);
    if (!d.businessId && !d.sector) throw new Error("Attach the reference to a business or a sector.");
    const source = /pinterest\./i.test(d.url) ? "pinterest" : /dribbble|behance|awwwards|land-book|siteinspire/i.test(d.url) ? "gallery" : "manual";
    const { error } = await ctx.supabase.from("design_references").insert({
      organisation_id: ctx.organisationId, business_id: d.businessId ?? null, sector: d.sector ?? null, source, url: d.url, image_url: d.imageUrl ?? null,
      title: d.title ?? null, attribution: d.attribution ?? new URL(d.url).hostname, licence_note: "Reference only. Do not reproduce layouts, imagery or logos.",
      analysis: d.notes ? { notes: d.notes } : null, created_by: ctx.user.id,
    });
    if (error) throw error;
    return "Reference saved.";
  }, "/design-research");
}

export async function removeReference(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const { error } = await ctx.supabase.from("design_references").delete().eq("id", z.string().uuid().parse(str(form, "id"))).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    return "Removed.";
  }, "/design-research");
}

const SECTOR_KEYS = ["hospitality", "food", "beauty", "healthcare", "trades", "automotive", "property", "fitness", "professional", "services", "retail", "other"] as const;

/** Assign one of the agency's own Pinterest boards to each sector (or none). */
export async function saveBoardLinks(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    let saved = 0;
    for (const sector of SECTOR_KEYS) {
      const raw = str(form, `board_${sector}`);
      if (!raw) {
        await ctx.supabase.from("pinterest_board_links").delete().eq("organisation_id", ctx.organisationId).eq("sector", sector);
        continue;
      }
      const [boardId, ...nameParts] = raw.split("|");
      if (!/^[0-9]{1,30}$/.test(boardId)) throw new Error("Invalid board.");
      const { error } = await ctx.supabase.from("pinterest_board_links").upsert({ organisation_id: ctx.organisationId, sector, board_id: boardId, board_name: nameParts.join("|").slice(0, 200) || boardId }, { onConflict: "organisation_id,sector" });
      if (error) throw error;
      saved++;
    }
    return `Saved: ${saved} sector${saved === 1 ? "" : "s"} linked to a board.`;
  }, "/design-research");
}

/** Delete the selected businesses' design work, or older brief versions. Owners and administrators. */
export async function designSelectionAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const op = z.enum(["delete", "prune"]).parse(str(form, "op"));
    if (op === "prune") {
      const { data, error } = await ctx.supabase.rpc("prune_history", { p_org: ctx.organisationId, p_kind: "briefs" });
      if (error) throw new Error(error.message);
      return data ? `Removed ${data} older brief version${data === 1 ? "" : "s"}. Each business keeps its latest.` : "Nothing to remove: each business has only its latest brief.";
    }
    const ids = form.getAll("businessId").map(String).filter((x) => z.string().uuid().safeParse(x).success);
    if (!ids.length) throw new Error("Select at least one business.");
    let done = 0;
    const kept: string[] = [];
    for (const id of ids.slice(0, 100)) {
      const { data, error } = await ctx.supabase.rpc("delete_design_work", { p_business: id });
      if (error) { kept.push(error.message); continue; }
      done++;
      const paths = (data as string[] | null) ?? [];
      // Uploaded pictures are removed from storage too (best effort: a leftover file is harmless).
      if (paths.length) await ctx.supabase.storage.from(UPLOAD_BUCKET).remove(paths.filter((p) => p.startsWith(`${ctx.organisationId}/`)));
    }
    return `Deleted the design work for ${done} business${done === 1 ? "" : "es"}.${kept.length ? ` ${kept.length} kept (${kept[0]}).` : ""}`;
  }, ["/design-research"]);
}
