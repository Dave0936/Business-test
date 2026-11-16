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

Put the output in `APP_ENCRYPTION_KEY`.

### 5. Run

```bash
npm run dev
```

Open http://localhost:3000, create an account, name your agency workspace, then either run a
search or click **Load demo data** on the Overview page.

---

## Credentials

| Variable | Needed for | Required in Phase 1 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Database and sign-in | **Yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | Background jobs, inviting team members | **Yes** (server only) |
| `APP_ENCRYPTION_KEY` | Encrypting per-organisation integration secrets | **Yes** (server only) |
| `ANTHROPIC_API_KEY` | AI audits, design briefs, site copy, emails | No (labelled template mode without it) |
| `GOOGLE_PLACES_API_KEY` | Google Places discovery | No |
| `OSM_CONTACT_EMAIL` | OpenStreetMap usage policy (User-Agent contact) | No |
| `PINTEREST_ACCESS_TOKEN` | Pinterest references (needs approved API access) | No |
| `UNSPLASH_ACCESS_KEY` | Licensed photos in prototypes | No |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploying approved prototypes (token needs *Cloudflare Pages: Edit*) | No |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` | Sending approved emails, delivery events (verified domain required) | No |

Without an optional credential, that feature shows as **Not connected** or **Demo mode** on the
Integrations page. Nothing is faked.

---

## Testing

```bash
npm run check
```

Runs lint, type-checking, unit tests and a production build.

```bash
npm run test:db
```

Applies all migrations to a scratch Postgres database (with a small stand-in for Supabase's
`auth` schema) and runs the SQL security tests: tenant isolation, role permissions, and that
deployments and emails cannot bypass approval. Set `TEST_DATABASE_URL` to a Postgres superuser
connection (default `postgres://postgres@127.0.0.1:54322/postgres`, the local Supabase database port).

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

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation, auth, database, navigation, dashboard | **In testing** |
| 2 | Business discovery and CRM | Backend drafted, untested |
| 3 | Website auditing and opportunity scoring | Backend drafted, untested |
| 4 | Pinterest and design research | Backend drafted, untested |
| 5 | AI website generation and live preview | Generator drafted; editor not built |
| 6 | Quality assurance and approval centre | QA drafted; approval UI not built |
| 7 | Cloudflare deployment | Service drafted, untested |
| 8 | Email generation, approval and sending | Service drafted, untested |
| 9 | Automation engine | Queue and worker drafted |
| 10 | Analytics, security hardening, production testing | Not started |

"Drafted" means code exists in `src/lib`, but the phase is not complete until it has been tested
and its UI finished.
