\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', p_sql;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if p_like is not null and sqlerrm not ilike '%' || p_like || '%' then raise exception 'wrong error: % (wanted %)', sqlerrm, p_like; end if;
end $$;
create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'ASSERTION FAILED: %', p_msg; end if; end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'int-owner@example.test'), ('00000000-0000-0000-0000-0000000000a2', 'int-staff@example.test'), ('00000000-0000-0000-0000-0000000000a3', 'int-other@example.test');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.create_organisation('Int Org') as org \gset
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000000a2', 'staff');

select public.save_integration(:'org', 'serpapi', 'v1.ciphertext', '{"account":"x"}', 'connected');
select pg_temp.assert(public.integration_secret(:'org', 'serpapi') = 'v1.ciphertext', 'owner reads ciphertext');
select pg_temp.assert((select status from public.integration_connections where provider = 'serpapi') = 'connected', 'status visible');
select pg_temp.expect_error($q$select secret_ciphertext from public.integration_connections$q$, 'permission denied');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.save_integration(%L, 'serpapi', 'evil', '{}', 'connected')$q$, :'org'), 'only owners or administrators');
select pg_temp.assert(public.integration_secret(:'org', 'serpapi') = 'v1.ciphertext', 'staff can use the key server-side');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.integration_secret(%L, 'serpapi')$q$, :'org'), 'not allowed');

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.save_integration(:'org', 'serpapi', null, '{}', 'disconnected');
select pg_temp.assert(public.integration_secret(:'org', 'serpapi') is null, 'disconnected key is gone');
select pg_temp.assert((select count(*) from public.audit_logs where action like 'integration.%') = 2, 'audited');
reset role;
\echo 'ALL INTEGRATION TESTS PASSED'
