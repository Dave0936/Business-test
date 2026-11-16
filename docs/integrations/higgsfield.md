# Higgsfield API — integration notes (for Phase 5)

Summary of https://docs.higgsfield.ai (read 2026-11-16). Check the docs again before building.

- **Credentials**: key ID + secret from https://console.higgsfield.ai. Server-side only.
  Header: `Authorization: Key <KEY_ID>:<KEY_SECRET>`.
- **Base URL**: `https://api.higgsfield.ai` (add this host to the network allowlist when building).
- **Submit**: `POST /<model path>` (for example `/higgsfield-ai/soul/v2/standard`) with a JSON body
  that depends on the model, plus an `Idempotency-Key` header. The response is `{status: "queued",
  request_id, status_url, cancel_url}`.
- **Poll**: `GET /requests/{request_id}/status` until a terminal state: `completed` (with
  `images: [{url}]` or video output), `failed`, `nsfw` or `canceled`. Webhooks are also available.
- **Cost estimate**: `POST /estimate/<model path>` with the same body returns `{usd}`. Show this to
  the user before every run. Failed or moderated requests are not charged.
- **Retention**: outputs are deleted after 7 days, so copy files into our own storage straight away.
  `DELETE /requests/{id}` removes them sooner.
- **Image models** (as listed): SOUL, SOUL V2, SOUL Cinema, Marketing Studio Image, Ads Studio,
  Grok Image 2.0, Recraft V4.1 (and Pro/Utility), Qwen Image 3, Ideogram 4.0, Z-Image Turbo.
  "Nano Banana Pro" (used by Venari's CLI) is not listed for the API.
- **Video models** include Seedance 2.x, Kling 2.5–3.0, Wan, Hailuo, LTX-2.5, MiniMax, PixVerse
  (image-to-video suits short looping hero clips).
- **Errors**: `401` invalid credentials; `404`/`423`/`503` when a model is unavailable to the account.
