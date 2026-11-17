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
  ('00000000-0000-0000-0000-0000000096a1', 'bin-owner@example.test'),
  ('00000000-0000-0000-0000-0000000096a2', 'bin-staff@example.test');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000096a1","role":"authenticated"}';
select public.create_organisation('Bin Org') as org \gset
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000096a2', 'staff');
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org', 'Old Mill', 'old mill', 'GB', 'om') returning id as biz \gset
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (:'org', 'Keep Me', 'keep me', 'GB', 'km') returning id as keep \gset

-- Staff move a lead to the bin; it disappears from normal reads.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000096a2","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.purge_business(%L)$q$, :'biz'), 'only owners or administrators');
insert into public.email_drafts (organisation_id, business_id, to_email, subject, body_text, status, content_hash, idempotency_key)
values (:'org', :'biz', 'a@old-mill.co.uk', 's', 'b', 'awaiting_approval', 'x', 'bin-test-k1') returning id as draft \gset
select pg_temp.assert(public.bin_business(:'biz'), 'binned');
select pg_temp.assert((select count(*) from public.businesses where organisation_id = :'org') = 1, 'binned lead hidden');
select pg_temp.assert((select status::text from public.email_drafts where id = :'draft') = 'cancelled', 'unsent email cancelled');
-- The bin page asks for binned leads explicitly.
select set_config('request.headers', '{"x-include-binned":"1"}', false);
select pg_temp.assert((select count(*) from public.businesses where organisation_id = :'org' and deleted_at is not null) = 1, 'bin shows it');
-- Restoring brings it back.
select pg_temp.assert(public.bin_business(:'biz', true), 'restored');
select set_config('request.headers', '', false);
select pg_temp.assert((select count(*) from public.businesses where organisation_id = :'org') = 2, 'restored');

-- Owners delete permanently, only from the bin, and never while a concept is online.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000096a1","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.purge_business(%L)$q$, :'keep'), 'recycle bin first');
select public.bin_business(:'biz');
insert into public.crm_activities (organisation_id, business_id, type, summary) values (:'org', :'biz', 'note', 'x');
select pg_temp.assert(public.purge_business(:'biz'), 'purged');
reset role;
select pg_temp.assert((select count(*) from public.businesses where id = :'biz') = 0, 'gone');
select pg_temp.assert((select count(*) from public.crm_activities where business_id = :'biz') = 0, 'related records gone');
select pg_temp.assert((select count(*) from public.audit_logs where entity_id = :'biz' and action = 'lead.purged') = 1, 'purge audited');

-- The retention sweep (service role) may purge too.
select public.bin_business(:'keep');
reset role;
update public.businesses set deleted_at = now() - interval '31 days' where id = :'keep';
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
select pg_temp.assert(public.purge_business(:'keep'), 'service purges');
reset role;
-- Stopping a run cancels its queued work; read-only members cannot.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000096a3', 'bin-reader@example.test');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000096a1","role":"authenticated"}';
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000096a3', 'read_only');
insert into public.automation_runs (organisation_id, status) values (:'org', 'running') returning id as run \gset
reset role;
insert into public.jobs (organisation_id, run_id, type, idempotency_key) values (:'org', :'run', 'audit', 'bin-run-j1');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000096a3","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.cancel_run(%L)$q$, :'run'), 'cannot stop runs');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000096a2","role":"authenticated"}';
select pg_temp.assert(public.cancel_run(:'run'), 'staff stop the run');
select pg_temp.assert(not public.cancel_run(:'run'), 'stopping twice is a no-op');
reset role;
select pg_temp.assert((select status::text from public.jobs where idempotency_key = 'bin-run-j1') = 'cancelled', 'queued job cancelled');
\echo 'ALL RECYCLE BIN TESTS PASSED'
