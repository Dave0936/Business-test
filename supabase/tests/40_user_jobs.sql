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
  ('00000000-0000-0000-0000-0000000000f1', 'jobs-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'jobs-other@example.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'jobs-reader@example.test');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select public.create_organisation('Other Org') as org_b \gset

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select public.create_organisation('Jobs Org') as org \gset
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000000f3', 'read_only');
insert into public.automation_runs (organisation_id, status) values (:'org', 'running') returning id as run \gset

-- Staff+ can enqueue user-safe jobs; duplicates are ignored; keys are namespaced per org.
select pg_temp.assert(public.enqueue_job(:'org', :'run', 'discover', '{"x":1}', 'discover:k1'), 'first enqueue creates');
select pg_temp.assert(not public.enqueue_job(:'org', :'run', 'discover', '{"x":1}', 'discover:k1'), 'duplicate ignored');
select pg_temp.expect_error(format($q$select public.enqueue_job(%L, null, 'deploy', '{}', 'd1')$q$, :'org'), 'can only be queued by the system');
select pg_temp.expect_error(format($q$select public.enqueue_job(%L, null, 'send_email', '{}', 's1')$q$, :'org'), 'can only be queued by the system');
select pg_temp.expect_error(format($q$select public.enqueue_job(%L, null, 'discover', '{}', 'x')$q$, :'org_b'), 'not allowed');
select pg_temp.expect_error(format($q$select public.enqueue_job(%L, %L, 'discover', '{}', 'x2')$q$, :'org_b', :'run'), 'not allowed');

-- Claim and complete own jobs only.
select id as job from public.claim_org_jobs(:'org', 'w1', 5) \gset
select pg_temp.assert(:'job' is not null, 'claimed own job');
select pg_temp.expect_error(format($q$select public.claim_org_jobs(%L, 'w1', 5)$q$, :'org_b'), 'not allowed');
select public.complete_job(:'job', 'succeeded', '{"ok":true}');
select pg_temp.assert((select status::text from public.jobs where id = :'job') = 'succeeded', 'completed');
select pg_temp.expect_error(format($q$select public.complete_job(%L, 'queued')$q$, :'job'), 'not allowed');
select public.bump_run_stat(:'run', 'found', 3);
select pg_temp.assert((select (stats->>'found')::int from public.automation_runs where id = :'run') = 3, 'stat bumped');

-- Read-only members cannot queue, claim or bump.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.enqueue_job(%L, null, 'audit', '{}', 'r1')$q$, :'org'), 'not allowed');
select pg_temp.expect_error(format($q$select public.claim_org_jobs(%L, 'w', 1)$q$, :'org'), 'not allowed');
select pg_temp.expect_error(format($q$select public.bump_run_stat(%L, 'x', 1)$q$, :'run'), 'not allowed');

-- The other organisation cannot complete or bump this organisation's work.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.bump_run_stat(%L, 'x', 1)$q$, :'run'), 'not allowed');
select pg_temp.assert((select count(*) from public.jobs) = 0, 'other org sees no jobs');

-- Runs finish once idle (owner).
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select pg_temp.assert(public.finish_idle_runs(:'org') = 1, 'idle run finished');
select pg_temp.assert((select status::text from public.automation_runs where id = :'run') = 'succeeded', 'run succeeded');

-- The service worker can queue privileged jobs.
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
select pg_temp.assert(public.enqueue_job(:'org', null, 'deploy', '{}', 'deploy:1'), 'service can queue deploy');
reset role;
\echo 'ALL USER JOB TESTS PASSED'
