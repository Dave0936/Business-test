-- Design quality: a free-text creative brief per site, written by the agency's designer.
-- (The agency-wide house style lives in organisations.settings.house_style.)
alter table public.design_studios add column if not exists creative_brief text
  check (creative_brief is null or char_length(creative_brief) <= 20000);
