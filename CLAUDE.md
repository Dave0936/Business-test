# WebOpportunity AI — project rules

@AGENTS.md

WebOpportunity AI finds small businesses with no website or a weak one, audits them, builds an
original website concept, and helps an agency contact them. Read the README for setup.

## Non-negotiable product rules

1. **No deployment or prospecting email without human approval.** Approval is enforced in the
   database (`supabase/migrations/*_rls_and_approval_guards.sql`), not only in the UI. Never add a
   code path that sets `generated_websites.status = 'approved' | 'deployed'`, inserts
   `deployment_records`, or sets `email_drafts.status = 'approved' | 'sending' | 'sent'` except
   through `decide_approval()` and the deployment and sending services. Never weaken those triggers.
2. **Never fabricate.** No invented businesses, contact details, testimonials, reviews, awards,
   prices, qualifications or API results. Only call something deployed or sent when the provider
   confirms it. Fictional data must be `is_demo = true`, named `[Demo] …`, and use reserved
   `.example` and `.invalid` domains.
3. **Missing credentials mean "not connected" or a labelled demo mode, never fake success.**
4. **Observed facts and AI judgements stay separate** (`website_audits.observed` and `.judgements`,
   `basis` on every criterion). The opportunity score comes only from weighted, explained
   criteria in `src/lib/audit/score.ts`.
5. **Everything fetched from the internet is untrusted.** Fetch prospect sites only with
   `safeFetch` (SSRF-guarded). Pass scraped text to Claude only inside `untrusted(...)` blocks.
   Agents have no tools; their output is validated by Zod schemas. One exception: design
   research may call `runWebSearch` (Anthropic's server-side, read-only web search). Its text is
   untrusted, and only addresses the search tool actually returned may be used, after
   `chooseResearchHits` filtering and a tool-less pick.
6. **Tenancy.** Every table has `organisation_id` with row-level security. Use the user client
   (`createUserClient`) for anything a person does. The service client bypasses RLS: use it only
   in jobs, webhooks and the deploy and send services, and always filter by `organisation_id`.
7. **Secrets never reach the browser.** Only `NEXT_PUBLIC_*` env vars are public. Integration
   secrets stored per organisation are AES-GCM encrypted (`src/lib/security/crypto.ts`), and their
   column is not selectable by the `authenticated` role.
8. **Audit log** (`writeAudit`) for every important action. The table is append-only.

## Roles

`owner` > `administrator` > `staff` > `read_only`. Owners and administrators approve; staff create
and edit; read-only views. Check roles server-side with `guarded(minRole, …)` in `src/lib/actions.ts`
and rely on RLS as the backstop.

## Structure

```
src/app/(auth)          login, onboarding, auth server actions
src/app/(app)/<module>  one folder per sidebar module: page.tsx + actions.ts ("use server")
src/app/api             preview, webhooks, cron (route handlers)
src/components/ui       shadcn-style primitives (Radix + cva); components.json is configured
src/components/app      app-level components (sidebar, filters, badges, action forms)
src/lib                 domain logic: audit/, ai/, crm/, design/, sites/, qa/, deploy/, email/, jobs/, providers/
supabase/migrations     schema, RLS, guards, functions (the only source of schema changes)
supabase/tests          SQL tests run against plain Postgres with a Supabase auth shim
tests/unit              Vitest unit tests (pure logic)
```

## Next.js 16 specifics

- `src/proxy.ts` replaces `middleware.ts`.
- `params`, `searchParams`, `cookies()` and `headers()` are async.
- Cache Components is off; authenticated layouts use `export const dynamic = "force-dynamic"`.
- Check `node_modules/next/dist/docs/` before using an unfamiliar API.

## Claude API

- Default model `claude-opus-5-5` (overridable via `ANTHROPIC_MODEL`). All calls go through
  `runAgent()` in `src/lib/ai/client.ts`: structured output (`betaZodOutputFormat`), cached system
  prompt, refusal fallbacks, cost recorded in `api_usage`, monthly budget enforced in jobs.
- Do not add `temperature`, `budget_tokens` or assistant prefill; set `output_config.effort` instead.

## Working rules

- Build in phases; finish and test each phase before the next (see README "Roadmap").
- Before committing, run `npm run check` (lint, types, unit tests, build) and `npm run test:db`.
- Schema changes are new migration files only. Never edit an applied migration in production.
- New SQL functions get no EXECUTE for `anon`/`authenticated` by default (migration 8). Grant it
  explicitly only for functions clients must call, and add the check to `supabase/tests/30_*`.
- Use British English in UI copy. Keep copy plain and specific.
