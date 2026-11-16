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
  ('00000000-0000-0000-0000-0000000000b1', 'build-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'build-other@example.test'),
  ('00000000-0000-0000-0000-0000000000b3', 'build-reader@example.test');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select public.create_organisation('Other Build Org') as org_b \gset
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org_b', 'B', 'b', 'GB', 'b') returning id as biz_b \gset
insert into public.generated_websites (organisation_id, business_id, slug) values (:'org_b', :'biz_b', 'b-site') returning id as site_b \gset

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select public.create_organisation('Build Org') as org \gset
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000000b3', 'read_only');
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org', 'A', 'a', 'GB', 'a') returning id as biz \gset
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org', 'A2', 'a2', 'GB', 'a2') returning id as biz2 \gset
insert into public.generated_websites (organisation_id, business_id, slug) values (:'org', :'biz', 'a-site') returning id as site \gset

-- One active build per website; finished builds do not block a new one.
insert into public.site_builds (organisation_id, business_id, website_id, status) values (:'org', :'biz', :'site', 'running') returning id as build \gset
select pg_temp.expect_error(format($q$insert into public.site_builds (organisation_id, business_id, website_id) values (%L, %L, %L)$q$, :'org', :'biz', :'site'), 'duplicate');
update public.site_builds set status = 'succeeded' where id = :'build';
insert into public.site_builds (organisation_id, business_id, website_id) values (:'org', :'biz', :'site');
select pg_temp.expect_error(format($q$update public.site_builds set status = 'paused' where id = %L$q$, :'build'), 'check');

-- Builds must match the website's organisation and business.
select pg_temp.expect_error(format($q$insert into public.site_builds (organisation_id, business_id, website_id) values (%L, %L, %L)$q$, :'org', :'biz', :'site_b'), 'another organisation');
select pg_temp.expect_error(format($q$insert into public.site_builds (organisation_id, business_id, website_id) values (%L, %L, %L)$q$, :'org', :'biz2', :'site'), 'another organisation or business');

-- Read-only member: sees builds, cannot stop them.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.site_builds) = 2, 'reader sees builds');
update public.site_builds set stop_requested = true;
select pg_temp.assert((select count(*) from public.site_builds where stop_requested) = 0, 'reader cannot stop builds');

-- Other organisation: nothing visible, nothing writable.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.site_builds) = 0, 'other org sees no builds');
update public.site_builds set stop_requested = true;
reset role;
select pg_temp.assert((select count(*) from public.site_builds where stop_requested) = 0, 'other org cannot stop builds');
\echo 'ALL SITE BUILD TESTS PASSED'
