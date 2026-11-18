-- Homepage first: build and agree the home page, then build the rest in the same design.
alter table public.site_builds add column if not exists scope text not null default 'full'
  check (scope in ('home', 'full', 'rest'));
alter table public.site_builds add column if not exists planned_pages jsonb not null default '[]'::jsonb;
