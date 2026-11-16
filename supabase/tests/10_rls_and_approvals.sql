-- Database security tests. Run with: npm run test:db
-- Each section switches identity the way PostgREST does (SET ROLE + request.jwt.claims).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', p_sql;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if p_like is not null and sqlerrm not ilike '%' || p_like || '%' then
    raise exception 'wrong error for %: got "%" expected like "%"', p_sql, sqlerrm, p_like;
  end if;
end $$;

create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void
language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'ASSERTION FAILED: %', p_msg; end if; end $$;

-- Fixed identities
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'owner-b@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff-a@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'readonly-a@example.test');

select pg_temp.assert((select count(*) from public.users) = 4, 'auth trigger creates profiles');

-- ===== Owner A creates an organisation
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.create_organisation('Agency A') as org_a \gset
select pg_temp.assert((select count(*) from public.email_templates where organisation_id = :'org_a') = 2, 'templates seeded');
insert into public.organisation_members (organisation_id, user_id, role) values
  (:'org_a', '00000000-0000-0000-0000-00000000000c', 'staff'),
  (:'org_a', '00000000-0000-0000-0000-00000000000d', 'read_only');

-- ===== Owner B creates a separate organisation
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select public.create_organisation('Agency B') as org_b \gset
select pg_temp.assert((select count(*) from public.organisations) = 1, 'B sees only its own org');

-- ===== Staff A adds a business and drafts an email
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
insert into public.businesses (organisation_id, name, normalized_name, country_code, city, email, dedupe_key, status)
values (:'org_a', 'Harbour Cafe', 'harbour cafe', 'GB', 'Leith', 'hello@harbour.example', 'name:harbour cafe|gb|leith', 'qualified')
returning id as biz \gset

select pg_temp.expect_error(
  format($q$insert into public.email_drafts (organisation_id, business_id, to_email, subject, body_text, status, idempotency_key, content_hash)
          values (%L, %L, 'x@y.test', 's', 'b', 'approved', 'k0', 'x')$q$, :'org_a', :'biz'),
  'must start as draft');

insert into public.email_drafts (organisation_id, business_id, to_email, subject, body_text, status, idempotency_key, content_hash, compliance)
values (:'org_a', :'biz', 'hello@harbour.example', 'A concept', 'Hello there', 'awaiting_approval', 'k1', 'ignored', '{"allowed": false}')
returning id as email1 \gset

select pg_temp.assert((select content_hash from public.email_drafts where id = :'email1') = public.email_content_hash('hello@harbour.example','A concept','Hello there'), 'hash computed by DB, not client');

select pg_temp.expect_error(format($q$select public.decide_approval('email', %L, 'approved')$q$, :'email1'), 'only owners or administrators');
select pg_temp.expect_error(format($q$update public.email_drafts set status = 'approved' where id = %L$q$, :'email1'), 'no approval');
select pg_temp.expect_error(format($q$insert into public.approvals (organisation_id, subject_type, subject_id, content_hash, decision, decided_by) values (%L, 'email', %L, 'h', 'approved', '00000000-0000-0000-0000-00000000000c')$q$, :'org_a', :'email1'), 'only owners or administrators');

-- ===== Read-only user cannot write
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.businesses) = 1, 'read-only can read');
select pg_temp.expect_error(format($q$insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (%L, 'X', 'x', 'GB', 'x')$q$, :'org_a'), 'row-level security');

-- ===== Cross-tenant isolation
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select pg_temp.assert((select count(*) from public.businesses) = 0, 'B cannot see A businesses');
select pg_temp.assert((select count(*) from public.email_drafts) = 0, 'B cannot see A emails');
select pg_temp.expect_error(format($q$insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key) values (%L, 'X', 'x', 'GB', 'y')$q$, :'org_a'), 'row-level security');
select pg_temp.expect_error(format($q$select public.decide_approval('email', %L, 'approved')$q$, :'email1'), 'only owners or administrators');
update public.businesses set name = 'hacked' where id = :'biz';

-- ===== Owner A: compliance gate, approval, edit voids approval
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select pg_temp.assert((select name from public.businesses where id = :'biz') = 'Harbour Cafe', 'B update had no effect');
select pg_temp.expect_error(format($q$select public.decide_approval('email', %L, 'approved')$q$, :'email1'), 'failed compliance');
update public.email_drafts set compliance = '{"allowed": true}' where id = :'email1';
select public.decide_approval('email', :'email1', 'approved', 'looks good');
select pg_temp.assert((select status::text from public.email_drafts where id = :'email1') = 'approved', 'approved');
select pg_temp.expect_error(format($q$update public.email_drafts set status = 'sending' where id = %L$q$, :'email1'), 'only the sending service');
update public.email_drafts set body_text = 'Hello there, edited' where id = :'email1';
select pg_temp.assert((select status::text from public.email_drafts where id = :'email1') = 'review', 'edit resets to review');
select pg_temp.assert((select approval_id from public.email_drafts where id = :'email1') is null, 'edit clears approval');
select count(*) as audit_before from public.audit_logs \gset
delete from public.audit_logs;
select pg_temp.assert((select count(*) from public.audit_logs) = :audit_before and :audit_before > 0, 'audit log rows survive delete');
select pg_temp.expect_error($q$select secret_ciphertext from public.integration_connections$q$, 'permission denied');

-- ===== Service role: cannot send unapproved content
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
select pg_temp.expect_error(format($q$update public.email_drafts set status = 'sending' where id = %L$q$, :'email1'), 'no approval');

-- Re-approve the edited content, then the service may send
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.decide_approval('email', :'email1', 'approved');
set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
select pg_temp.expect_error(format($q$update public.email_drafts set status = 'sent' where id = %L$q$, :'email1'), 'through sending');
update public.email_drafts set status = 'sending' where id = :'email1';
update public.email_drafts set status = 'sent', sent_at = now(), provider_message_id = 'msg_1' where id = :'email1';
select pg_temp.expect_error(format($q$update public.email_drafts set body_text = 'changed' where id = %L$q$, :'email1'), 'sent emails cannot be changed');

-- Duplicate initial email to the same recipient is rejected
select pg_temp.expect_error(
  format($q$insert into public.email_drafts (organisation_id, business_id, to_email, subject, body_text, status, idempotency_key, content_hash) values (%L, %L, 'HELLO@harbour.example', 's', 'b', 'draft', 'k2', 'x')$q$, :'org_a', :'biz'),
  'duplicate key');

-- ===== Websites: QA + approval required before deployment
insert into public.generated_websites (organisation_id, business_id, slug, status) values (:'org_a', :'biz', 'harbour-cafe', 'generated') returning id as site \gset
insert into public.website_versions (organisation_id, website_id, version, spec, files, content_hash) values (:'org_a', :'site', 1, '{"a":1}', '{"index.html":"<h1>x</h1>"}', 'ignored') returning id as v1 \gset
update public.generated_websites set current_version_id = :'v1' where id = :'site';
select pg_temp.expect_error(format($q$update public.website_versions set spec = '{}' where id = %L$q$, :'v1'), 'immutable');
select pg_temp.expect_error(format($q$update public.generated_websites set status = 'awaiting_approval' where id = %L$q$, :'site'), 'passing quality report');
insert into public.quality_reports (organisation_id, website_id, version_id, passed, checks) values (:'org_a', :'site', :'v1', false, '[]');
select pg_temp.expect_error(format($q$update public.generated_websites set status = 'awaiting_approval' where id = %L$q$, :'site'), 'passing quality report');
insert into public.quality_reports (organisation_id, website_id, version_id, passed, checks) values (:'org_a', :'site', :'v1', true, '[]');
update public.generated_websites set status = 'awaiting_approval' where id = :'site';
select pg_temp.expect_error(format($q$update public.generated_websites set status = 'approved' where id = %L$q$, :'site'), 'no approval');

-- A forged approval id for another subject is rejected
select id as email_approval from public.approvals where subject_id = :'email1' order by decided_at desc limit 1 \gset
select pg_temp.expect_error(
  format($q$insert into public.deployment_records (organisation_id, business_id, website_id, version_id, approval_id, project_name) values (%L, %L, %L, %L, %L, 'p')$q$, :'org_a', :'biz', :'site', :'v1', :'email_approval'),
  'requires an approval');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.decide_approval('website', %L, 'approved')$q$, :'site'), 'only owners or administrators');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.decide_approval('website', :'site', 'approved') as site_approval \gset
select pg_temp.assert((select status::text from public.generated_websites where id = :'site') = 'approved', 'site approved');
select pg_temp.expect_error(
  format($q$insert into public.deployment_records (organisation_id, business_id, website_id, version_id, approval_id, project_name) values (%L, %L, %L, %L, %L, 'p')$q$, :'org_a', :'biz', :'site', :'v1', :'site_approval'),
  'deployment service only');

set role service_role;
set request.jwt.claims = '{"role":"service_role"}';
select pg_temp.expect_error(format($q$update public.generated_websites set status = 'deployed' where id = %L$q$, :'site'), 'no successful deployment');
insert into public.deployment_records (organisation_id, business_id, website_id, version_id, approval_id, project_name, status)
values (:'org_a', :'biz', :'site', :'v1', :'site_approval', 'wo-harbour-cafe', 'verified');
update public.generated_websites set status = 'deployed' where id = :'site';

-- A new version resets status and an old approval cannot deploy it
insert into public.website_versions (organisation_id, website_id, version, spec, files, content_hash) values (:'org_a', :'site', 2, '{"a":2}', '{}', 'x') returning id as v2 \gset
update public.generated_websites set current_version_id = :'v2' where id = :'site';
select pg_temp.assert((select status::text from public.generated_websites where id = :'site') = 'generated', 'new version resets status');
select pg_temp.expect_error(
  format($q$insert into public.deployment_records (organisation_id, business_id, website_id, version_id, approval_id, project_name) values (%L, %L, %L, %L, %L, 'p2')$q$, :'org_a', :'biz', :'site', :'v2', :'site_approval'),
  'requires an approval');

-- ===== Job queue skips paused runs
insert into public.automation_runs (organisation_id, status) values (:'org_a', 'paused') returning id as run_paused \gset
insert into public.automation_runs (organisation_id, status) values (:'org_a', 'running') returning id as run_live \gset
insert into public.jobs (organisation_id, run_id, type, idempotency_key) values (:'org_a', :'run_paused', 'noop', 'j1'), (:'org_a', :'run_live', 'noop', 'j2');
select pg_temp.assert((select count(*) from public.claim_jobs('w1', 10)) = 1, 'only the live run job is claimed');
select pg_temp.expect_error($q$insert into public.jobs (organisation_id, type, idempotency_key) select organisation_id, 'noop', 'j2' from public.jobs limit 1$q$, 'duplicate key');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select pg_temp.expect_error($q$select public.claim_jobs('x', 1)$q$, null);

-- Even the database owner cannot rewrite history
reset role;
reset request.jwt.claims;
select pg_temp.expect_error($q$delete from public.audit_logs$q$, 'append-only');
\echo 'ALL DATABASE TESTS PASSED'
