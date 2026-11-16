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
  ('00000000-0000-0000-0000-0000000009a1', 'img-owner@example.test'),
  ('00000000-0000-0000-0000-0000000009a2', 'img-other@example.test'),
  ('00000000-0000-0000-0000-0000000009a3', 'img-reader@example.test');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a2","role":"authenticated"}';
select public.create_organisation('Other Image Org') as org_b \gset
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org_b', 'B', 'b', 'GB', 'b') returning id as biz_b \gset

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}';
select public.create_organisation('Image Org') as org \gset
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000009a3', 'read_only');
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org', 'A', 'a', 'GB', 'a') returning id as biz \gset

insert into public.generated_images (organisation_id, business_id, slot, prompt) values (:'org', :'biz', 'cafe counter', 'p') returning id as img \gset
select pg_temp.expect_error(format($q$update public.generated_images set status = 'charged' where id = %L$q$, :'img'), 'check');
select pg_temp.expect_error(format($q$insert into public.generated_images (organisation_id, business_id, slot, prompt) values (%L, %L, 's', 'p')$q$, :'org', :'biz_b'), 'another organisation');

-- Members may queue image jobs; they are user-safe.
select pg_temp.assert(public.enqueue_job(:'org', null, 'image', '{}', 'image:1'), 'staff can queue image jobs');

-- Read-only: sees, cannot change or queue.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a3","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.generated_images) = 1, 'reader sees images');
update public.generated_images set prompt = 'changed';
select pg_temp.expect_error(format($q$select public.enqueue_job(%L, null, 'image', '{}', 'image:2')$q$, :'org'), 'not allowed');

-- Other organisation: nothing.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a2","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.generated_images) = 0, 'other org sees no images');
reset role;
select pg_temp.assert((select prompt from public.generated_images where id = :'img') = 'p', 'reader could not change the prompt');
\echo 'ALL GENERATED IMAGE TESTS PASSED'
