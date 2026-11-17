import type Anthropic from "@anthropic-ai/sdk";
import { executeBuildTool, MAX_VIEWS, type CheckOutcome, type DraftState } from "./tools";
import { NUDGE } from "./prompt";

type Msg = Anthropic.Beta.BetaMessageParam;

export type ViewPage = (path: string, device: "desktop" | "phone") => Promise<{ jpegBase64?: string; note: string; error?: string }>;

/** Screenshots kept in the conversation; older ones are replaced by a note (cost and storage). */
export const KEEP_SCREENSHOTS = 2;

/**
 * Apply one model reply: record it, run every tool call against the draft, and append the
 * matching tool results (one user message holding all of them, as the API requires), or a
 * nudge when the model stopped without calling a tool. Returns the activity lines.
 * view_page renders the draft when a renderer is given.
 */
export async function applyTurn(state: DraftState, messages: Msg[], reply: Pick<Anthropic.Beta.BetaMessage, "content" | "stop_reason">, check: (source: Record<string, string>) => CheckOutcome, view?: ViewPage): Promise<string[]> {
  const activity: string[] = [];
  messages.push({ role: "assistant", content: reply.content as Anthropic.Beta.BetaContentBlockParam[] });
  const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
  for (const block of reply.content) {
    if (block.type !== "tool_use") continue;
    const input = (block.input ?? {}) as Record<string, unknown>;
    if (block.name === "view_page" && view && state.canView) {
      const path = String(input.path ?? "");
      const device = input.device === "phone" ? "phone" : "desktop";
      const fail = (text: string) => { activity.push(text); results.push({ type: "tool_result", tool_use_id: block.id, content: text, is_error: true }); };
      if (!/\.html$/.test(path) || !state.source[path]) { fail(`There is no page ${path}.`); continue; }
      if ((state.viewed?.length ?? 0) >= MAX_VIEWS) { fail(`You have used all ${MAX_VIEWS} page views for this build. Finish with what you have learned.`); continue; }
      const r = await view(path, device);
      if (r.error || !r.jpegBase64) {
        if (r.error?.includes("not available")) state.canView = false;
        fail(r.error ?? "Could not render the page.");
        continue;
      }
      state.viewed = [...(state.viewed ?? []), `${path}:${device}`];
      activity.push(`Looked at ${path} on ${device}`);
      results.push({ type: "tool_result", tool_use_id: block.id, content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: r.jpegBase64 } },
        { type: "text", text: r.note },
      ] });
      continue;
    }
    const out = executeBuildTool(state, block.name, input, check);
    activity.push(out.activity);
    results.push({ type: "tool_result", tool_use_id: block.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
  }
  if (results.length) messages.push({ role: "user", content: results });
  else if (reply.stop_reason === "max_tokens") messages.push({ role: "user", content: "Your last reply was cut off. Write files one at a time with write_file." });
  else messages.push({ role: "user", content: NUDGE });
  pruneScreenshots(messages);
  return activity;
}

/** Keep only the newest screenshots; replace older ones with a short note. */
export function pruneScreenshots(messages: Msg[], keep = KEEP_SCREENSHOTS): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type !== "tool_result" || !Array.isArray(block.content)) continue;
      const hasImage = block.content.some((c) => c.type === "image");
      if (!hasImage) continue;
      seen++;
      if (seen > keep) {
        const text = block.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
        block.content = [{ type: "text", text: `[Earlier screenshot removed to save space.] ${text}` }];
      }
    }
  }
}
