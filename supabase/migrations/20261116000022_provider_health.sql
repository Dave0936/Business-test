-- Whether a free data source is reachable from this deployment, per workspace. Updated by each
-- search and by the check on the Integrations page; the search form marks a source that is
-- known to be unreachable as unavailable until a check succeeds.
create table public.provider_health (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  provider text not null,
  ok boolean not null,
  detail text,
  checked_at timestamptz not null default now(),
  primary key (organisation_id, provider)
);
alter table public.provider_health enable row level security;
create policy provider_health_select on public.provider_health for select using (public.is_org_member(organisation_id));
create policy provider_health_insert on public.provider_health for insert with check (public.can_write(organisation_id));
create policy provider_health_update on public.provider_health for update using (public.can_write(organisation_id)) with check (public.can_write(organisation_id));
