-- Phase 5: bespoke builds. Claude writes each prototype's files in a loop of short turns; the
-- conversation, draft files and activity are kept here between turns so a build survives
-- serverless time limits and can be watched and stopped.

create table public.site_builds (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  website_id uuid not null references public.generated_websites (id) on delete cascade,
  kind text not null default 'new' check (kind in ('new','revision')),
  instruction text,
  base_version_id uuid references public.website_versions (id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','stopped')),
  stop_requested boolean not null default false,
  turns int not null default 0,
  messages jsonb not null default '[]'::jsonb,
  source jsonb not null default '{}'::jsonb,
  activity jsonb not null default '[]'::jsonb,
  last_check jsonb,
  summary text,
  suggestions jsonb not null default '[]'::jsonb,
  result_version_id uuid references public.website_versions (id) on delete set null,
  cost_usd numeric(10,4) not null default 0,
  error text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index site_builds_website_idx on public.site_builds (website_id, created_at desc);
create index site_builds_org_idx on public.site_builds (organisation_id, status);
create trigger site_builds_updated before update on public.site_builds
  for each row execute function public.set_updated_at();

-- One active build per website at a time.
create unique index site_builds_one_active on public.site_builds (website_id) where status in ('queued','running');

alter table public.site_builds enable row level security;
create policy site_builds_select on public.site_builds for select using (public.is_org_member(organisation_id));
create policy site_builds_insert on public.site_builds for insert with check (public.can_write(organisation_id));
create policy site_builds_update on public.site_builds for update using (public.can_write(organisation_id)) with check (public.can_write(organisation_id));
create policy site_builds_delete on public.site_builds for delete using (public.can_approve(organisation_id));

create or replace function public.site_build_same_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.generated_websites w where w.id = new.website_id and w.organisation_id = new.organisation_id and w.business_id = new.business_id) then
    raise exception 'website belongs to another organisation or business';
  end if;
  return new;
end $$;
revoke all on function public.site_build_same_org() from public, anon, authenticated;
create trigger site_builds_same_org before insert or update on public.site_builds
  for each row execute function public.site_build_same_org();
