-- AI-generated photos for prototypes (Higgsfield). The cost is estimated and shown before a
-- run; each finished image is copied into the private site-assets bucket and deleted at
-- Higgsfield. Sites that use them say so.

create table public.generated_images (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  slot text not null,
  prompt text not null,
  aspect text not null default '3:2',
  provider text not null default 'higgsfield',
  status text not null default 'queued' check (status in ('queued','submitted','completed','failed')),
  request_id text,
  quoted_usd numeric(10,4),
  storage_path text,
  error text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index generated_images_business_idx on public.generated_images (business_id, created_at desc);
create trigger generated_images_updated before update on public.generated_images
  for each row execute function public.set_updated_at();

alter table public.generated_images enable row level security;
create policy generated_images_select on public.generated_images for select using (public.is_org_member(organisation_id));
create policy generated_images_insert on public.generated_images for insert with check (public.can_write(organisation_id));
create policy generated_images_update on public.generated_images for update using (public.can_write(organisation_id)) with check (public.can_write(organisation_id));
create policy generated_images_delete on public.generated_images for delete using (public.can_approve(organisation_id));

create or replace function public.generated_image_same_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.businesses b where b.id = new.business_id and b.organisation_id = new.organisation_id) then
    raise exception 'business belongs to another organisation';
  end if;
  return new;
end $$;
revoke all on function public.generated_image_same_org() from public, anon, authenticated;
create trigger generated_images_same_org before insert or update on public.generated_images
  for each row execute function public.generated_image_same_org();

-- Members may queue image generation as a user-safe job.
create or replace function public.user_job_types() returns text[]
language sql immutable as $$ select array['discover','audit','research','generate','draft_email','image'] $$;
