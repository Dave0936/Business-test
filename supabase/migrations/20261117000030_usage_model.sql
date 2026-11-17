-- Record which Claude model actually answered each call (fallbacks can switch models).
alter table public.api_usage add column if not exists model text;
