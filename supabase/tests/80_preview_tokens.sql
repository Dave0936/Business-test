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
  ('00000000-0000-0000-0000-0000000000c1', 'preview-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'preview-other@example.test');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select public.create_organisation('Other Preview Org') as org_b \gset

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select public.create_organisation('Preview Org') as org \gset
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org', 'P', 'p', 'GB', 'p') returning id as biz \gset
insert into public.generated_websites (organisation_id, business_id, slug) values (:'org', :'biz', 'p-site') returning id as site \gset
insert into public.website_versions (organisation_id, website_id, version, spec, files, content_hash)
  values (:'org', :'site', 1, '{}', '{"index.html":"<p>hi</p>"}', 'x') returning id as ver \gset

-- A member gets a signature; anyone holding it can read that version's files, nothing else.
select public.sign_preview(:'ver') as token \gset
select pg_temp.assert(:'token' ~ '^[0-9]{10}\.[0-9a-f]{64}$', 'token format');
reset role;
set role anon;
set request.jwt.claims = '{"role":"anon"}';
select pg_temp.assert((public.preview_files(:'ver', :'token') ->> 'index.html') = '<p>hi</p>', 'signed read works without a session');
select pg_temp.assert(public.preview_files(:'ver', regexp_replace(:'token', '.$', 'x')) is null, 'tampered signature refused');
select pg_temp.assert(public.preview_files(gen_random_uuid(), :'token') is null, 'signature is bound to its version');
select pg_temp.assert(public.preview_files(:'ver', 'nonsense') is null, 'malformed token refused');
select pg_temp.expect_error(format($q$select public.sign_preview(%L)$q$, :'ver'), 'permission denied');
select pg_temp.expect_error('select * from private.settings', 'permission denied');
reset role;

-- Expired signatures are refused (built here with the key, as only the database can).
select (extract(epoch from now() - interval '1 minute')::bigint)::text || '.' ||
       encode(hmac(:'ver' || ':' || (extract(epoch from now() - interval '1 minute')::bigint)::text, (select value from private.settings where key = 'preview_hmac_key'), 'sha256'), 'hex') as expired \gset
set role anon;
select pg_temp.assert(public.preview_files(:'ver', :'expired') is null, 'expired signature refused');
reset role;

-- Another organisation cannot sign this version.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.sign_preview(%L)$q$, :'ver'), 'not allowed');
reset role;
\echo 'ALL PREVIEW TOKEN TESTS PASSED'
