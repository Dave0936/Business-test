-- Phase 4: design studio. A studio session per business holds the idea, site type, the judged
-- picks (each covering a page section), questions and answers. References gain a verdict
-- (loved / rejected), a kind (pin / site / upload) and observed design facts for added sites.

alter table public.design_references
  add column if not exists kind text not null default 'link' check (kind in ('link','pin','site','upload')),
  add column if not exists verdict text check (verdict in ('loved','rejected')),
  add column if not exists storage_path text,
  add column if not exists external_id text;
create unique index if not exists design_references_unique_url on public.design_references (organisation_id, business_id, url);

create table public.design_studios (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  idea text,
  site_type text not null default 'brochure' check (site_type in ('brochure','one_page','booking','menu','portfolio','shop')),
  round int not null default 1,
  picks jsonb not null default '[]'::jsonb,
  picked_by text check (picked_by in ('ai','rules')),
  questions jsonb not null default '[]'::jsonb,
  questions_by text check (questions_by in ('ai','preset')),
  pinterest_bookmark text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id)
);
create index design_studios_org_idx on public.design_studios (organisation_id);
create trigger design_studios_updated before update on public.design_studios
  for each row execute function public.set_updated_at();

alter table public.design_briefs add column if not exists studio_id uuid references public.design_studios (id) on delete set null;
alter table public.design_briefs add column if not exists created_by uuid references public.users (id) on delete set null;

-- Which Pinterest board feeds which sector (the agency curates boards; we only read them).
create table public.pinterest_board_links (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  sector text not null,
  board_id text not null,
  board_name text not null,
  created_at timestamptz not null default now(),
  primary key (organisation_id, sector)
);

do $$
declare t text;
begin
  foreach t in array array['design_studios','pinterest_board_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_org_member(organisation_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (public.can_write(organisation_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.can_write(organisation_id)) with check (public.can_write(organisation_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.can_write(organisation_id))', t || '_delete', t);
  end loop;
end $$;

-- A reference attached to a business must belong to the same organisation as the business.
create or replace function public.design_reference_same_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is not null and not exists (
    select 1 from public.businesses b where b.id = new.business_id and b.organisation_id = new.organisation_id
  ) then
    raise exception 'business belongs to another organisation';
  end if;
  return new;
end $$;
revoke all on function public.design_reference_same_org() from public, anon, authenticated;
create trigger design_references_same_org before insert or update on public.design_references
  for each row execute function public.design_reference_same_org();

create or replace function public.design_studio_same_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.businesses b where b.id = new.business_id and b.organisation_id = new.organisation_id) then
    raise exception 'business belongs to another organisation';
  end if;
  return new;
end $$;
revoke all on function public.design_studio_same_org() from public, anon, authenticated;
create trigger design_studios_same_org before insert or update on public.design_studios
  for each row execute function public.design_studio_same_org();
