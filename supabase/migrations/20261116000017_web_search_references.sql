-- References found by Claude's web search (design research) get their own source label.
alter table public.design_references drop constraint if exists design_references_source_check;
alter table public.design_references add constraint design_references_source_check
  check (source in ('pinterest','gallery','manual','search_link','web_search'));
