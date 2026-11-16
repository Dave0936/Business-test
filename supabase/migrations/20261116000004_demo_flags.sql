-- Demo records are visibly fictional and can never be emailed.
alter table public.businesses add column is_demo boolean not null default false;
alter table public.businesses add column has_own_website boolean generated always as (website_domain is not null) stored;
create index businesses_org_demo_idx on public.businesses (organisation_id, is_demo);

create or replace function public.email_no_demo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('approved','sending','sent') and new.status is distinct from old.status then
    if exists (select 1 from public.businesses b where b.id = new.business_id and b.is_demo)
       or new.to_email ~* '\.(invalid|example|test|localhost)$' then
      raise exception 'demo or reserved-domain recipients cannot be approved or sent';
    end if;
  end if;
  return new;
end $$;

create trigger email_no_demo_guard before update on public.email_drafts
  for each row execute function public.email_no_demo_guard();

-- Catalogue industry id (src/lib/industries.ts) used by scoring, research and generation.
alter table public.businesses add column industry_id text;
create index businesses_org_industry_idx on public.businesses (organisation_id, industry_id);
