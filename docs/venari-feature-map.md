# Venari feature map

How the 42-step "Venari" studio workflow maps onto WebOpportunity AI. The Venari source text is
licensed for personal use only and is not reproduced here; this file describes features in our own
words.

**Architecture stays as specified for WebOpportunity AI**: Next.js on Vercel, Supabase, the Claude
API, Cloudflare for prototypes, Resend for email, with row-level security and human approval for
every deployment and email. Venari is a single-user local Python server driven by a local agent
CLI; we adopt its *workflow and features*, not its runtime.

Legend: ✅ built · 🟡 partly built · ⬜ planned · ⛔ deliberately not adopted (reason given)

| # | Venari feature | WebOpportunity AI | Phase |
|---|---|---|---|
| 1–2 | Local server, studio page, PWA icons/manifest | ✅ hosted web app; ⬜ PWA manifest + home-screen icons | 10 |
| 3–4 | One AI gateway, model chooser, connections with key checks | ✅ `runAgent` (Claude); ⬜ model choice in Settings; ✅ connect/verify/disconnect per workspace (encrypted) | 2 / 10 |
| 5–6 | Design searches with an idea, type, stages; AI-planned "scouts" per page section | ✅ per-business design studio with idea, site type and sections; picks cover one section each | 4 |
| 7 | Pinterest scraping via Pinterest's internal web endpoint | ⛔ breaks Pinterest's terms. We use the official Pinterest API (needs approved access), staff-added references, and named websites | — |
| 8 | Research: find the best sites of this kind, screenshot, rate | 🟡 designers add sites and we read their fonts, colours and preview image → ⬜ automatic discovery (needs a decision on giving the research agent a web-search tool) and screenshots (Cloudflare Browser Rendering, Phase 7 credentials) | 4 / 7 |
| 9 | Mobbin via Mobbin's own sign-in tokens | ⛔ no official Mobbin API; reusing session tokens breaks their terms. Revisit if Mobbin offers an API | — |
| 10–11 | Judge picks 5 references covering the page; love/reject; own pictures; add a site; more rounds; re-pick | ✅ Claude or rule-based picks, validated; love/reject; uploads; add a site; collect more pins; new round | 4 |
| 12–13 | Questions about the picks; editable creative brief; change type | ✅ questions (Claude or standard), answers enforced, editable brief with versions and live contrast checks, change type | 4 |
| 14 | Versions on disk, cover image | ✅ immutable versions in the database; ⬜ cover screenshots | 5 |
| 15–16 | Art director "direction" + agentic builder that writes bespoke code and checks its own screenshots | 🟡 Claude writes content, our renderer lays it out → ⬜ art-director step + agentic builder (Claude Managed Agents) with a screenshot tool; template renderer kept as the fast, cheap option | 5 |
| 17 | Self-hosted fonts (Fontsource) | 🟡 Google Fonts CDN → ⬜ self-hosted woff2 (also avoids the German GDPR Google Fonts issue) | 5 |
| 18 | Design review as suggestions, never auto-rebuild | ⬜ | 5 |
| 19 | Rebuild an uploaded design | ⬜ only with a rights confirmation; never logos or text | 5 |
| 20 | Copy check for AI-sounding text | 🟡 claim checks exist → ⬜ add AI-phrase check and targeted rewrite | 5–6 |
| 21 | Photos: none / own / AI (Higgsfield) | 🟡 Unsplash + uploads → ⬜ Higgsfield adapter (needs API access, cost shown before running) | 5 |
| 22 | Multiple languages with a switcher | ⬜ | 5 |
| 23 | 21st.dev interactive components | ⬜ optional, later | 10 |
| 24 | Short looping video (Higgsfield) | ⬜ optional | 5 |
| 25 | All versions, saved designs, zip download | 🟡 builder list → ⬜ saved designs, zip | 5 |
| 26 | Change a version (text, motion, components), apply suggestions, add photos | 🟡 edit + regenerate section → ⬜ revision window | 5 |
| 27 | Watch a build live, activity, stop | 🟡 run/job status → ⬜ build activity feed + stop | 5 / 9 |
| 28 | Trash with 30-day restore | ⬜ | 9 |
| 29 | Publish preview link (Netlify) | ✅ Cloudflare Pages, only after approval (per our spec) | 7 |
| 30 | Email to the client with price; copy, never send | ✅ drafting + approval + Resend → ⬜ add price and a "copy only" mode | 8 |
| 31 | Reuse a design for another client | ⬜ | 5 |
| 32 | Story of a website | 🟡 CRM activity → ⬜ story view | 9 |
| 33 | Countries and towns (GeoNames) | ✅ 245 countries, 70,000 towns, town autocomplete | 2 |
| 34 | Find clients via SerpAPI Google Maps, chains removed, website analyst, email found | ✅ SerpAPI provider (1–3 pages, credits shown), chain and kind filters, de-duplication, analyst | 2 |
| 35 | Client list with rating, reviews, problems | ✅ rating, reviews, opening hours, problems, CRM board, follow-ups, CSV export | 2 |
| 36 | Design a website for a client using their real facts | 🟡 generate from lead → ⬜ start a Design Studio search from a lead | 4 |
| 37 | Activity page | ⬜ | 9 |
| 38 | More rounds with other sources, re-pick | ⬜ | 4 |
| 39 | Studio assistant chat | ⬜ Claude assistant with read access to the organisation's data | 10 |
| 40–41 | systemd service, Tailscale | ✅ replaced by Vercel hosting | — |
| 42 | Final end-to-end check | ✅ per-phase E2E tests | all |

## Decisions (16 Nov 2026)

- **Builder:** bespoke agentic builder only (no template builder for client prototypes).
- **Client discovery:** SerpAPI (Google Maps) added as a provider, alongside OpenStreetMap,
  Google Places and CSV import.
- **Imagery:** Higgsfield via its official API (see `docs/integrations/higgsfield.md`), with the
  cost estimate shown before each run.

## Where WebOpportunity AI already goes further

Multi-user organisations with roles and row-level security; approvals enforced by the database;
an append-only audit log; per-country direct-marketing compliance; suppression and unsubscribe
handling; transparent, weighted opportunity scoring with observed facts kept apart from AI opinions;
SSRF-safe website fetching; provider data-retention rules.
