# WebOpportunity AI

An AI-assisted platform for web agencies. It finds small and medium-sized businesses worldwide
that have no website or a weak one, audits them, scores the opportunity transparently, researches a
design direction, builds an original website concept, and helps you contact the business.
**Every deployment and every prospecting email needs a person's approval. The database enforces this.**

Stack: Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · shadcn/ui conventions (Radix) ·
Supabase (Postgres, Auth, Storage, row-level security) · Anthropic Claude · Cloudflare Pages ·
Resend.

---

## Setup

### 1. Requirements

- Node.js 20.9+ (22 recommended) and npm
- A Supabase project: hosted (free tier works) **or** local via the Supabase CLI and Docker

### 2. Install

```bash
npm install
```

```bash
cp .env.example .env.local
```

### 3. Database

**Option A: hosted Supabase**

1. Create a project at https://supabase.com/dashboard.
2. In *Project Settings → API*, copy the project URL, `anon` key and `service_role` key into `.env.local`.
3. Push the migrations:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

4. In *Authentication → URL Configuration*, set the Site URL to `http://localhost:3000` and add
   `http://localhost:3000/auth/callback` to the redirect URLs.
5. Sign-up emails: Supabase's built-in email service only delivers to members of your Supabase
   organisation and is heavily rate-limited. Sign up with your own (team member) address, or set up
   custom SMTP in *Authentication → Emails* before inviting other people.

**Option B: local Supabase (Docker)**

```bash
npx supabase start
```

`supabase start` prints the API URL, anon key and service role key; put them in `.env.local`.
Migrations in `supabase/migrations` are applied automatically. Local auth emails (magic links,
invites) appear in Inbucket at http://127.0.0.1:54324.

### 4. Encryption key

```bash
openssl rand -base64 32
```

Put the output in `APP_ENCRYPTION_KEY`. Any random value of at least 32 characters also works (for example a 64-character hex secret); the app derives the AES-256 key from it. Keep it unchanged once keys are stored, or they can no longer be read.

### 5. Run

```bash
npm run dev
```

Open http://localhost:3000, create an account, name your agency workspace, then either run a
search or click **Load demo data** on the Overview page.

If your server reaches the internet through an outbound proxy, set `HTTPS_PROXY` (and `NO_PROXY`);
`src/instrumentation.ts` routes server-side requests through it. `GET /api/health` reports whether
the server can reach Supabase.

---

## Credentials

| Variable | Needed for | Required in Phase 1 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Database and sign-in | **Yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | Background jobs, inviting team members | **Yes** (server only) |
| `APP_ENCRYPTION_KEY` | Encrypting per-organisation integration secrets | **Yes** (server only) |
| `ANTHROPIC_API_KEY` | AI audits, design briefs, site copy, emails | No (labelled template mode without it) |
| `GOOGLE_PLACES_API_KEY` | Google Places discovery | No |
| `SERPAPI_API_KEY` | Google Maps discovery via SerpAPI (or connect per workspace in Integrations) | No |
| `HIGGSFIELD_API_KEY_ID`, `HIGGSFIELD_API_KEY_SECRET` | AI photos and video for prototypes (Phase 5) | No |
| `OSM_CONTACT_EMAIL` | OpenStreetMap usage policy (User-Agent contact) | No |
| `PINTEREST_ACCESS_TOKEN` | Pinterest references (needs approved API access) | No |
| `UNSPLASH_ACCESS_KEY` | Licensed photos in prototypes | No |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploying approved prototypes (token needs *Cloudflare Pages: Edit*) | No |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` | Sending approved emails, delivery events (verified domain required) | No |

Without an optional credential, that feature shows as **Not connected** or **Demo mode** on the
Integrations page. Nothing is faked. Owners and administrators can also connect keys per workspace
on the Integrations page: each key is checked with the provider first, then stored encrypted with
`APP_ENCRYPTION_KEY` and never shown again.

---

## Testing

```bash
npm run check
```

Runs lint, type-checking, unit tests and a production build.

```bash
E2E_OWNER_EMAIL=owner@… E2E_STAFF_EMAIL=staff@… E2E_PASSWORD=… node tests/e2e/phase1.mjs
```

`tests/e2e/phase2.mjs` takes the same variables and tests discovery, de-duplication, CSV
import/export, the CRM board, follow-ups and integrations.

`tests/e2e/phase3.mjs` (owner account, plus `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) tests audits and scoring with fictional businesses: a business
with no website, one with no contact route (high score, not qualified, explained), an unreachable
site, the score breakdown, and queued audits finishing while the app is open. Behind an HTTPS
proxy, run Node with `NODE_USE_ENV_PROXY=1`.

`tests/e2e/phase4.mjs` (owner account) walks through the design studio with a fictional business:
idea and site type, adding sites and pictures (including a disguised file that must be refused),
love and reject, picks, a new round, questions, the brief, editing with live contrast checks,
versions, and the phone layout.

Phase 1 acceptance test against a running app (`npm run build && npm start`) and a real Supabase
project: sign-in, onboarding, settings, demo data, every module, filters, mobile layout, sign-out
and staff restrictions. Both accounts must exist and be confirmed, and the staff account must be a
staff member of the owner's workspace.

```bash
npm run test:db
```

Applies all migrations to a scratch Postgres database (with a small stand-in for Supabase's
`auth` schema) and runs the SQL security tests: tenant isolation, role permissions, and that
deployments and emails cannot bypass approval. Set `TEST_DATABASE_URL` to a Postgres superuser
connection (default `postgres://postgres@127.0.0.1:54322/postgres`, the local Supabase database port).

### How background work runs

Work a person starts (searches, audits, research, generation, drafting) is queued in Postgres and
processed straight after the request, **with that person's own session**, so row-level security
applies to everything it touches. Anything that does not fit in that window keeps going in short
slices while anyone with staff access has the app open (the header shows "N tasks in progress").
A job interrupted by a time limit is retried after 10 minutes, or marked failed with a clear error
once its attempts are used up, so runs always finish. Privileged jobs (deployment, sending) and scheduled runs are only
processed by the system worker with the service role key (Phases 7–9).

Town search uses GeoNames data bundled in `data/geonames` (Places: GeoNames, CC BY 4.0), rebuilt
with `scripts/build-geonames.py`.

---

## Project structure

```
src/app/(auth)/          Sign-in, sign-up, magic link, onboarding
src/app/(app)/<module>/  One folder per sidebar module (page + server actions)
src/app/api/             Route handlers (sandboxed prototype preview, …)
src/components/ui/       UI primitives in shadcn/ui style (components.json included)
src/components/app/      App components: sidebar, filters, badges, action forms
src/lib/                 Domain logic (audit, ai, crm, design, sites, qa, deploy, email, jobs, providers)
src/proxy.ts             Session refresh + sign-in redirect (Next.js 16 "proxy")
supabase/migrations/     Schema, RLS, approval guards, job queue, metrics functions
supabase/tests/          SQL tests
tests/unit/              Vitest tests
```

`CLAUDE.md` holds the engineering rules for this repository.

---

## Security model (summary)

- **Tenancy:** every table carries `organisation_id` with row-level security. Members read; staff
  write; owners and administrators delete and approve.
- **Approvals in the database:** triggers block approving a site without a passing quality report,
  recording a deployment without an approval of that exact version (content hash), and marking an
  email approved or sent without an approval of its exact content. Editing content voids approval.
  Demo and reserved-domain recipients can never be approved.
- **Append-only audit log**, including against the database owner.
- **Secrets** stay on the server; per-organisation secrets are AES-256-GCM encrypted and their
  column is not readable by signed-in users.
- **Untrusted web content:** prospect sites are fetched through an SSRF-guarded client (public IPs
  only, checked at connect time; redirects re-checked; size and time limits). Scraped text reaches
  Claude only inside clearly delimited untrusted blocks; agents have no tools.
- **Generated prototypes** are previewed inside a sandboxed iframe with a strict CSP, so their code
  can never touch the app's session.

---

## How audits and scores work

Each audit fetches the home page (and, if it has no form, the contact page) through `safeFetch`,
which refuses private and internal addresses at connection time. It honours robots.txt for link
checks. Everything measured is stored in `website_audits.observed`; AI opinions (only when
Claude is connected) go in `.judgements` and are labelled "AI judgement" wherever they appear.

The opportunity score (0–100, higher = more room to improve) is a weighted sum of explained
criteria in `src/lib/audit/score.ts` (weights version `2026-11-v2`): website presence 40, mobile 15,
enquiry and booking 15, performance 8, security 8, outdated technology 6, AI design judgement 6,
and 4 each for contact information, SEO, accessibility and broken links. Plain or minimal design
is never scored as outdated; only concrete signals count (no responsive viewport, obsolete tags,
Flash, old jQuery, years-old copyright, plain HTTP).

A lead **qualifies** when its score reaches the threshold *and* the business has published a way
to contact it (an email on its own site or a mailto link, a contact page, or a phone number). A
high score without a contact route shows as "Not qualified · No contact route found".

## Design studio

Each business has a design studio (Design Research → a business):

1. **Idea and site type** (brochure, one-page, booking-led, menu-led, portfolio, shop). The type
   sets the page sections that picks should cover.
2. **References**: pins from the Pinterest board you assign to the sector (12 at a time, linked,
   never copied), websites you add (we read their fonts, colours and preview image through the
   same SSRF-safe fetcher as audits), and pictures you upload (PNG/JPEG/WebP up to 2 MB, checked
   by content, stored in the private `site-assets` bucket and shown through signed links that
   expire after an hour). Love or reject each one; rejected references are never picked.
3. **Picks**: up to five references, one per section. Claude picks when connected; otherwise
   simple rules do (loved first, then your own pictures and sites, newest first), and the page
   says which. Claude's picks are checked: unknown, rejected or duplicate picks are replaced.
4. **Questions**: Claude writes questions about the picks, or five standard ones are used. Answers
   are the designer's decisions and override the brief's defaults.
5. **Brief**: Claude writes it from the picks and answers, or it is built from the sector preset
   plus your answers. Edit any field; every save is a new version, and colours that fail WCAG AA
   are adjusted (the editor warns as you type).

Automation and the builder use the same studio in the background, so a brief produced without a
designer still respects any picks and answers already made.

Pinterest: a standard token reads your own boards; assign one board per sector on the Design
Research page. Public pin search needs Pinterest's approval and is used only if the token has it.

## Website builder

Claude writes each prototype from scratch (HTML, CSS and a small script) in a loop of short
turns: it writes files, runs the same quality checks used for approval, fixes what they find and
finishes only when they pass. Each turn is saved, so a build carries on across serverless time
limits while anyone has the app open; the site's page shows the activity and a Stop button.

- Claude never writes a phone number, email or address: it uses placeholders that are filled from
  the verified business record, and anything that needs a missing detail is removed.
- Every page gets the concept notice ("not commissioned or endorsed by …").
- Revisions: describe a change (or apply one of the builder's suggestions) and a new version is
  made from the current one. Every version can be previewed, restored or downloaded as a zip.
- Without an Anthropic key, a clearly labelled template demo is made so the workflow can be
  tried. For a real business it can't be sent for approval; only fictional demo businesses can.

`tests/e2e/phase5.mjs` (owner account) covers the template path, preview, quality checks,
versions, restore, zip download and sign-in protection. The Claude build loop is covered by
`tests/unit/bespoke.test.ts`, including a scripted multi-turn build.

`tests/e2e/phase6.mjs` (owner and staff accounts) tests the approval centre with the fictional
`[Demo]` businesses (load demo data in the test workspace first): staff can view but not decide,
requesting changes needs a reason, a rebuilt version returns to the queue, approving needs every
checklist item, and the history records each decision against its version. Approvals are written
only by `decide_approval()`, which checks the role, the reviewed version, the checklist
(`website_review_items()`) and the reason in the database.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation, auth, database, navigation, dashboard | **Complete and tested** |
| 2 | Business discovery and CRM (incl. SerpAPI, GeoNames towns, chain filter) | **Complete and tested** |
| 3 | Website auditing and opportunity scoring | **Complete and tested** |
| 4 | Design studio: Pinterest boards, references, picks, questions, editable brief | **Complete and tested** |
| 5 | Bespoke website builder, preview, revisions, versions, self-hosted fonts, Higgsfield photos, extra languages | **Complete and tested** (real Claude and Higgsfield runs need their keys) |
| 6 | Quality assurance and approval centre: review queue, checklist, decisions with reasons, history, re-run checks | **Complete and tested** |
| 7 | Cloudflare deployment | Service drafted, untested |
| 8 | Email generation, approval and sending | Service drafted, untested |
| 9 | Automation engine | Queue and worker drafted |
| 10 | Analytics, security hardening, production testing | Not started |

"Drafted" means code exists in `src/lib`, but the phase is not complete until it has been tested
and its UI finished.
