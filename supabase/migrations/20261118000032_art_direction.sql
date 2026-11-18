-- Venari-style design: who wrote the creative brief, and each build's art direction.
alter table public.design_studios add column if not exists creative_brief_by text
  check (creative_brief_by is null or creative_brief_by in ('ai', 'person'));
alter table public.design_studios add column if not exists creative_brief_at timestamptz;
alter table public.site_builds add column if not exists direction text
  check (direction is null or char_length(direction) <= 20000);
alter table public.site_builds add column if not exists direction_summary text
  check (direction_summary is null or char_length(direction_summary) <= 400);
