-- Phase 7: deployments run as Cloudflare Workers; a deployed concept can be taken offline.

alter type public.deployment_status add value if not exists 'removed';

alter table public.deployment_records
  add column requested_by uuid references public.users (id) on delete set null,
  add column removed_at timestamptz,
  add column removed_by uuid references public.users (id) on delete set null,
  add column details jsonb not null default '{}'::jsonb;

alter table public.deployment_records alter column provider set default 'cloudflare_workers';
