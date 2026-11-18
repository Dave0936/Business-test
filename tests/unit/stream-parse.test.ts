import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// runAgent streams (long answers must); this checks a streamed reply still comes back parsed.
function sse(events: Record<string, unknown>[]) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

describe("streamed structured output", () => {
  it("returns parsed_output from a streamed reply", async () => {
    const json = JSON.stringify({ markdown: "# Bold blue" });
    const body = sse([
      { type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(0, 10) } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: json.slice(10) } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } },
      { type: "message_stop" },
    ]);
    const client = new Anthropic({ apiKey: "test", fetch: (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch });
    const schema = z.object({ markdown: z.string() });
    const msg = await client.beta.messages.stream({
      model: "claude-opus-5-5", max_tokens: 24000, messages: [{ role: "user", content: "x" }],
      output_config: { effort: "high", format: betaZodOutputFormat(schema) },
    }).finalMessage();
    expect(msg.parsed_output).toEqual({ markdown: "# Bold blue" });
  });
});
