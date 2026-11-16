\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', p_sql;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if p_like is not null and sqlerrm not ilike '%' || p_like || '%' then raise exception 'wrong error: % (wanted %)', sqlerrm, p_like; end if;
end $$;
create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'ASSERTION FAILED: %', p_msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'studio-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'studio-other@example.test'),
  ('00000000-0000-0000-0000-0000000000d3', 'studio-reader@example.test');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select public.create_organisation('Other Studio Org') as org_b \gset
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org_b', 'B Biz', 'b biz', 'GB', 'b') returning id as biz_b \gset

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select public.create_organisation('Studio Org') as org \gset
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000000d3', 'read_only');
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org', 'A Biz', 'a biz', 'GB', 'a') returning id as biz \gset

-- Studio: one per business, staff can write, type is constrained.
insert into public.design_studios (organisation_id, business_id, site_type) values (:'org', :'biz', 'menu') returning id as studio \gset
select pg_temp.expect_error(format($q$insert into public.design_studios (organisation_id, business_id) values (%L, %L)$q$, :'org', :'biz'), 'duplicate');
select pg_temp.expect_error(format($q$update public.design_studios set site_type = 'casino' where id = %L$q$, :'studio'), 'check');
update public.design_studios set picks = '[{"reference_id":"x","section":"Hero","reason":"r"}]', picked_by = 'rules' where id = :'studio';
select pg_temp.assert((select picked_by from public.design_studios where id = :'studio') = 'rules', 'picks saved');

-- Cannot attach a studio or reference to another organisation's business.
select pg_temp.expect_error(format($q$insert into public.design_studios (organisation_id, business_id) values (%L, %L)$q$, :'org', :'biz_b'), 'another organisation');
select pg_temp.expect_error(format($q$insert into public.design_references (organisation_id, business_id, source, kind, url) values (%L, %L, 'manual', 'site', 'https://x.example')$q$, :'org', :'biz_b'), 'another organisation');

-- References: verdicts, kinds and per-business uniqueness.
insert into public.design_references (organisation_id, business_id, source, kind, url) values (:'org', :'biz', 'manual', 'site', 'https://a.example') returning id as ref \gset
select pg_temp.expect_error(format($q$insert into public.design_references (organisation_id, business_id, source, kind, url) values (%L, %L, 'manual', 'site', 'https://a.example')$q$, :'org', :'biz'), 'duplicate');
insert into public.design_references (organisation_id, business_id, sector, source, kind, url) values (:'org', null, 'restaurant', 'manual', 'link', 'https://shared.example');
insert into public.design_references (organisation_id, business_id, sector, source, kind, url) values (:'org', null, 'cafe', 'manual', 'link', 'https://shared.example');
update public.design_references set verdict = 'loved' where id = :'ref';
select pg_temp.expect_error(format($q$update public.design_references set verdict = 'meh' where id = %L$q$, :'ref'), 'check');

-- Board links.
insert into public.pinterest_board_links (organisation_id, sector, board_id, board_name) values (:'org', 'food', '123', 'Restaurants');
select pg_temp.expect_error(format($q$insert into public.pinterest_board_links (organisation_id, sector, board_id, board_name) values (%L, 'food', '9', 'x')$q$, :'org'), 'duplicate');

-- Briefs can point at their studio.
insert into public.design_briefs (organisation_id, business_id, studio_id, brief, generated_by) values (:'org', :'biz', :'studio', '{}', 'manual');

-- Read-only member: can read, cannot write.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.design_studios) = 1, 'reader sees studio');
select pg_temp.expect_error(format($q$insert into public.pinterest_board_links (organisation_id, sector, board_id, board_name) values (%L, 'beauty', '1', 'x')$q$, :'org'), 'row-level security');
update public.design_studios set idea = 'hijack' where id = :'studio';
select pg_temp.assert((select idea from public.design_studios where id = :'studio') is null, 'reader update had no effect');
update public.design_references set verdict = 'rejected' where id = :'ref';
select pg_temp.assert((select verdict from public.design_references where id = :'ref') = 'loved', 'reader cannot change verdicts');

-- Other organisation sees nothing and cannot write into this one.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.design_studios) = 0, 'other org sees no studios');
select pg_temp.assert((select count(*) from public.pinterest_board_links) = 0, 'other org sees no board links');
select pg_temp.assert((select count(*) from public.design_references) = 0, 'other org sees no references');
select pg_temp.expect_error(format($q$insert into public.design_studios (organisation_id, business_id) values (%L, %L)$q$, :'org', :'biz'), null);
delete from public.design_studios where id = :'studio';
reset role;
select pg_temp.assert((select count(*) from public.design_studios where id = :'studio') = 1, 'other org could not delete');
\echo 'ALL DESIGN STUDIO TESTS PASSED'
