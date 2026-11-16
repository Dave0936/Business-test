-- Extra site languages chosen in the design studio (the main language comes from the business's
-- country). Each extra language becomes a translated copy of the site in its own folder.
alter table public.design_studios add column if not exists languages text[] not null default '{}';
alter table public.design_studios add constraint design_studios_languages_check
  check (cardinality(languages) <= 2 and languages <@ array['en','fr','de','es','it','nl','pt','pl','cy','ga']::text[]);
