-- WebOpportunity AI: core schema
-- Every tenant-owned table carries organisation_id and is protected by RLS.
-- Server-side code uses the service role only for background jobs and webhooks,
-- and always scopes queries by organisation_id explicitly.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'administrator', 'staff', 'read_only');

create type public.lead_status as enum (
  'new', 'researching', 'qualified', 'not_qualified', 'prototype_generated',
  'awaiting_deployment_approval', 'deployed', 'awaiting_email_approval',
  'contacted', 'replied', 'interested', 'meeting_requested', 'converted',
  'not_interested', 'suppressed'
);

create type public.opportunity_type as enum (
  'no_website', 'outdated_website', 'poor_mobile', 'weak_functionality',
  'poor_enquiry_booking', 'unknown'
);

create type public.subscriber_type as enum ('corporate', 'individual', 'unknown');

create type public.website_status as enum (
  'draft', 'generated', 'quality_checked', 'awaiting_approval', 'approved',
  'deployed', 'rejected', 'changes_requested', 'failed'
);

create type public.email_status as enum (
  'draft', 'review', 'awaiting_approval', 'approved', 'sending', 'sent',
  'failed', 'cancelled', 'blocked'
);

create type public.approval_subject as enum ('website', 'email');
create type public.approval_decision as enum ('approved', 'rejected', 'changes_requested');

create type public.deployment_status as enum ('pending', 'uploading', 'succeeded', 'verified', 'failed');

create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create type public.run_status as enum ('running', 'paused', 'succeeded', 'failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Helper: updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Organisations, users, membership
-- ---------------------------------------------------------------------------
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  agency_name text,
  agency_postal_address text,
  agency_reply_email text,
  agency_website text,
  sender_from_email text,
  daily_email_limit int not null default 50 check (daily_email_limit between 0 and 5000),
  monthly_ai_budget_usd numeric(10,2) not null default 100,
  default_country_code text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organisations_updated before update on public.organisations
  for each row execute function public.set_updated_at();

-- Profile row mirroring auth.users
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on public.users
  for each row execute function public.set_updated_at();

create table public.organisation_members (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.org_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);
create index organisation_members_user_idx on public.organisation_members (user_id);

-- Membership helpers. SECURITY DEFINER so RLS policies can call them without recursion.
create or replace function public.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organisation_members m
    where m.organisation_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org uuid, roles public.org_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organisation_members m
    where m.organisation_id = org and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

create or replace function public.can_write(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_org_role(org, array['owner','administrator','staff']::public.org_role[]);
$$;

create or replace function public.can_approve(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_org_role(org, array['owner','administrator']::public.org_role[]);
$$;

-- New auth user -> profile row
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Creating an organisation makes the caller its owner (called via RPC).
create or replace function public.create_organisation(org_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.organisations (name) values (org_name) returning id into new_id;
  insert into public.organisation_members (organisation_id, user_id, role)
  values (new_id, auth.uid(), 'owner');
  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Businesses and sources
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  category text,
  sector text,
  country_code text not null check (char_length(country_code) = 2),
  region text,
  city text,
  address text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  website_url text,
  website_domain text,
  email text,
  phone text,
  phone_e164 text,
  contact_page_url text,
  opportunity_type public.opportunity_type not null default 'unknown',
  status public.lead_status not null default 'new',
  lead_score int check (lead_score between 0 and 100),
  subscriber_type public.subscriber_type not null default 'unknown',
  language text,
  follow_up_at timestamptz,
  notes text,
  estimated_value numeric(12,2),
  actual_revenue numeric(12,2),
  dedupe_key text not null,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, dedupe_key)
);
create index businesses_org_status_idx on public.businesses (organisation_id, status);
create index businesses_org_country_idx on public.businesses (organisation_id, country_code);
create index businesses_org_sector_idx on public.businesses (organisation_id, sector);
create index businesses_org_score_idx on public.businesses (organisation_id, lead_score desc);
create index businesses_org_domain_idx on public.businesses (organisation_id, website_domain);
create index businesses_org_phone_idx on public.businesses (organisation_id, phone_e164);
create trigger businesses_updated before update on public.businesses
  for each row execute function public.set_updated_at();

create table public.business_sources (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null,
  external_id text not null,
  source_url text,
  attribution text,
  licence text,
  -- Raw payload is only stored when the provider's terms allow it.
  raw jsonb,
  retention_expires_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (organisation_id, provider, external_id)
);
create index business_sources_business_idx on public.business_sources (business_id);
create index business_sources_retention_idx on public.business_sources (retention_expires_at)
  where retention_expires_at is not null;

-- ---------------------------------------------------------------------------
-- Audits and scoring
-- ---------------------------------------------------------------------------
create table public.website_audits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  url text,
  status text not null default 'completed' check (status in ('queued','running','completed','failed')),
  -- Measured facts (HTTP status, timings, tags found, etc.)
  observed jsonb not null default '{}'::jsonb,
  -- AI opinions, kept separate and labelled
  judgements jsonb not null default '{}'::jsonb,
  audit_score int check (audit_score between 0 and 100),
  problems jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index website_audits_business_idx on public.website_audits (business_id, created_at desc);

create table public.opportunity_scores (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  audit_id uuid references public.website_audits (id) on delete set null,
  score int not null check (score between 0 and 100),
  qualified boolean not null,
  threshold int not null,
  breakdown jsonb not null,
  weights_version text not null,
  created_at timestamptz not null default now()
);
create index opportunity_scores_business_idx on public.opportunity_scores (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Design research
-- ---------------------------------------------------------------------------
create table public.design_references (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid references public.businesses (id) on delete cascade,
  sector text,
  source text not null check (source in ('pinterest','gallery','manual','search_link')),
  url text not null,
  image_url text,
  title text,
  attribution text,
  licence_note text,
  analysis jsonb,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index design_references_business_idx on public.design_references (business_id);

create table public.design_briefs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  brief jsonb not null,
  generated_by text not null default 'ai' check (generated_by in ('ai','demo','manual')),
  created_at timestamptz not null default now()
);
create index design_briefs_business_idx on public.design_briefs (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Generated websites
-- ---------------------------------------------------------------------------
create table public.generated_websites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  brief_id uuid references public.design_briefs (id) on delete set null,
  slug text not null,
  status public.website_status not null default 'draft',
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, slug)
);
create index generated_websites_business_idx on public.generated_websites (business_id);
create index generated_websites_status_idx on public.generated_websites (organisation_id, status);
create trigger generated_websites_updated before update on public.generated_websites
  for each row execute function public.set_updated_at();

create table public.website_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  website_id uuid not null references public.generated_websites (id) on delete cascade,
  version int not null,
  spec jsonb not null,
  files jsonb not null default '{}'::jsonb,
  content_hash text not null,
  generated_by text not null default 'ai' check (generated_by in ('ai','demo','manual')),
  change_note text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (website_id, version)
);

alter table public.generated_websites
  add constraint generated_websites_current_version_fk
  foreign key (current_version_id) references public.website_versions (id) on delete set null;

create table public.quality_reports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  website_id uuid not null references public.generated_websites (id) on delete cascade,
  version_id uuid not null references public.website_versions (id) on delete cascade,
  passed boolean not null,
  checks jsonb not null,
  created_at timestamptz not null default now()
);
create index quality_reports_version_idx on public.quality_reports (version_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Approvals (shared by websites and emails)
-- ---------------------------------------------------------------------------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  subject_type public.approval_subject not null,
  subject_id uuid not null,
  -- Hash of exactly what was approved. Any later edit changes the hash and voids the approval.
  content_hash text not null,
  decision public.approval_decision not null,
  comment text,
  decided_by uuid not null references public.users (id),
  decided_at timestamptz not null default now()
);
create index approvals_subject_idx on public.approvals (subject_type, subject_id, decided_at desc);

-- ---------------------------------------------------------------------------
-- Deployments
-- ---------------------------------------------------------------------------
create table public.deployment_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  website_id uuid not null references public.generated_websites (id) on delete cascade,
  version_id uuid not null references public.website_versions (id) on delete restrict,
  approval_id uuid not null references public.approvals (id) on delete restrict,
  provider text not null default 'cloudflare_pages',
  project_name text not null,
  provider_deployment_id text,
  url text,
  status public.deployment_status not null default 'pending',
  verified_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (approval_id)
);
create index deployment_records_website_idx on public.deployment_records (website_id, created_at desc);
create trigger deployment_records_updated before update on public.deployment_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Email
-- ---------------------------------------------------------------------------
create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  purpose text not null default 'initial' check (purpose in ('initial','follow_up','other')),
  locale text not null default 'en',
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger email_templates_updated before update on public.email_templates
  for each row execute function public.set_updated_at();

create table public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  website_id uuid references public.generated_websites (id) on delete set null,
  deployment_id uuid references public.deployment_records (id) on delete set null,
  template_id uuid references public.email_templates (id) on delete set null,
  kind text not null default 'initial' check (kind in ('initial','follow_up','test')),
  to_email text not null,
  subject text not null,
  body_text text not null,
  status public.email_status not null default 'draft',
  compliance jsonb not null default '{}'::jsonb,
  content_hash text not null,
  approval_id uuid references public.approvals (id) on delete set null,
  provider_message_id text,
  idempotency_key text not null,
  generated_by text not null default 'ai' check (generated_by in ('ai','demo','manual')),
  sent_at timestamptz,
  follow_up_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);
create index email_drafts_org_status_idx on public.email_drafts (organisation_id, status);
create index email_drafts_business_idx on public.email_drafts (business_id);
create index email_drafts_provider_msg_idx on public.email_drafts (provider_message_id);
-- At most one live initial email per business per recipient.
create unique index email_drafts_one_initial_idx on public.email_drafts (organisation_id, business_id, lower(to_email))
  where kind = 'initial' and status not in ('cancelled','failed','blocked');
create trigger email_drafts_updated before update on public.email_drafts
  for each row execute function public.set_updated_at();

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  draft_id uuid references public.email_drafts (id) on delete set null,
  provider text not null default 'resend',
  provider_event_id text not null,
  provider_message_id text,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index email_events_draft_idx on public.email_events (draft_id, occurred_at desc);

create table public.suppression_lists (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  email text,
  domain text,
  reason text not null check (reason in ('unsubscribed','bounced','complained','manual','do_not_contact')),
  source text,
  created_at timestamptz not null default now(),
  check (email is not null or domain is not null)
);
create unique index suppression_email_idx on public.suppression_lists (organisation_id, lower(email)) where email is not null;
create unique index suppression_domain_idx on public.suppression_lists (organisation_id, lower(domain)) where domain is not null;

-- Unsubscribe tokens are opaque and single-purpose.
create table public.unsubscribe_tokens (
  token text primary key,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  email text not null,
  draft_id uuid references public.email_drafts (id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Configurable per-country direct-marketing rules (org override or global default when organisation_id is null)
create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete cascade,
  country_code text not null,
  rule jsonb not null,
  updated_at timestamptz not null default now()
);
create unique index compliance_rules_scope_idx on public.compliance_rules (coalesce(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid), country_code);

-- ---------------------------------------------------------------------------
-- CRM activity
-- ---------------------------------------------------------------------------
create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  type text not null,
  summary text not null,
  data jsonb not null default '{}'::jsonb,
  actor_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index crm_activities_business_idx on public.crm_activities (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Automation
-- ---------------------------------------------------------------------------
create table public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  config jsonb not null,
  frequency_minutes int check (frequency_minutes is null or frequency_minutes >= 60),
  enabled boolean not null default true,
  paused boolean not null default false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_workflows_due_idx on public.automation_workflows (next_run_at)
  where enabled and not paused;
create trigger automation_workflows_updated before update on public.automation_workflows
  for each row execute function public.set_updated_at();

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  workflow_id uuid references public.automation_workflows (id) on delete set null,
  status public.run_status not null default 'running',
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index automation_runs_workflow_idx on public.automation_runs (workflow_id, started_at desc);

-- Postgres-backed job queue (claimed with SKIP LOCKED by the worker).
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  run_id uuid references public.automation_runs (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (idempotency_key)
);
create index jobs_claim_idx on public.jobs (run_at) where status = 'queued';
create index jobs_run_idx on public.jobs (run_id);

-- ---------------------------------------------------------------------------
-- Integrations, usage, audit log
-- ---------------------------------------------------------------------------
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected' check (status in ('connected','disconnected','error')),
  -- Non-secret settings only
  config jsonb not null default '{}'::jsonb,
  -- AES-256-GCM ciphertext produced server-side; never selectable by clients (see column grants)
  secret_ciphertext text,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, provider)
);
create trigger integration_connections_updated before update on public.integration_connections
  for each row execute function public.set_updated_at();

create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  provider text not null,
  operation text not null,
  input_units int not null default 0,
  output_units int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index api_usage_org_time_idx on public.api_usage (organisation_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  actor_id uuid references public.users (id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user','system','webhook')),
  action text not null,
  entity_type text,
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_time_idx on public.audit_logs (organisation_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
