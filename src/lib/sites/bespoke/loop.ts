import type Anthropic from "@anthropic-ai/sdk";
import { executeBuildTool, type CheckOutcome, type DraftState } from "./tools";
import { NUDGE } from "./prompt";

type Msg = Anthropic.Beta.BetaMessageParam;

/**
 * Apply one model reply: record it, run every tool call against the draft, and append the
 * matching tool results (one user message holding all of them, as the API requires), or a
 * nudge when the model stopped without calling a tool. Returns the activity lines.
 */
export function applyTurn(state: DraftState, messages: Msg[], reply: Pick<Anthropic.Beta.BetaMessage, "content" | "stop_reason">, check: (source: Record<string, string>) => CheckOutcome): string[] {
  const activity: string[] = [];
  messages.push({ role: "assistant", content: reply.content as Anthropic.Beta.BetaContentBlockParam[] });
  const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
  for (const block of reply.content) {
    if (block.type !== "tool_use") continue;
    const out = executeBuildTool(state, block.name, (block.input ?? {}) as Record<string, unknown>, check);
    activity.push(out.activity);
    results.push({ type: "tool_result", tool_use_id: block.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
  }
  if (results.length) messages.push({ role: "user", content: results });
  else if (reply.stop_reason === "max_tokens") messages.push({ role: "user", content: "Your last reply was cut off. Write files one at a time with write_file." });
  else messages.push({ role: "user", content: NUDGE });
  return activity;
}
