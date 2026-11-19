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
  ('00000000-0000-0000-0000-0000000097a1', 'tidy-owner@example.test'),
  ('00000000-0000-0000-0000-0000000097a2', 'tidy-staff@example.test'),
  ('00000000-0000-0000-0000-0000000097a3', 'tidy-other@example.test');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000097a1","role":"authenticated"}';
select public.create_organisation('Tidy Org') as org \gset
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000097a2', 'staff');
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key, status) values (:'org', 'Tidy Cafe', 'tidy cafe', 'GB', 'tc', 'prototype_generated') returning id as biz \gset
insert into public.website_audits (organisation_id, business_id, created_at) values (:'org', :'biz', now() - interval '2 days'), (:'org', :'biz', now() - interval '1 day');
insert into public.website_audits (organisation_id, business_id) values (:'org', :'biz') returning id as latest_audit \gset
insert into public.design_briefs (organisation_id, business_id, brief, generated_by, created_at) values (:'org', :'biz', '{}', 'ai', now() - interval '1 day');
insert into public.design_briefs (organisation_id, business_id, brief, generated_by) values (:'org', :'biz', '{}', 'ai') returning id as latest_brief \gset
insert into public.design_studios (organisation_id, business_id) values (:'org', :'biz');
insert into public.design_references (organisation_id, business_id, source, url, kind, storage_path) values (:'org', :'biz', 'manual', 'upload:1', 'upload', 'x/uploads/1.png');
insert into public.design_references (organisation_id, sector, source, url) values (:'org', 'cafe', 'manual', 'https://example.com/shared');
insert into public.generated_websites (organisation_id, business_id, slug, status) values (:'org', :'biz', 'tidy-cafe', 'generated') returning id as site \gset
insert into public.website_versions (organisation_id, website_id, version, spec, files, content_hash) values (:'org', :'site', 1, '{"a":1}', '{}', 'x') returning id as v1 \gset

-- Staff cannot delete or prune.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000097a2","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.delete_website(%L)$q$, :'site'), 'only owners or administrators');
select pg_temp.expect_error(format($q$select public.delete_design_work(%L)$q$, :'biz'), 'only owners or administrators');
select pg_temp.expect_error(format($q$select public.prune_history(%L, 'audits')$q$, :'org'), 'only owners or administrators');

-- Another organisation sees nothing and changes nothing.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000097a3","role":"authenticated"}';
select pg_temp.assert(not public.delete_website(:'site'), 'other org: not found');
select pg_temp.assert(public.delete_design_work(:'biz') is null, 'other org: not found');
select pg_temp.expect_error(format($q$select public.prune_history(%L, 'audits')$q$, :'org'), 'only owners or administrators');

-- Older history goes; the latest per business stays.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000097a1","role":"authenticated"}';
select pg_temp.assert(public.prune_history(:'org', 'audits') = 2, 'two older audits removed');
select pg_temp.assert((select array_agg(id) from public.website_audits where business_id = :'biz') = array[:'latest_audit'::uuid], 'latest audit kept');
select pg_temp.assert(public.prune_history(:'org', 'briefs') = 1, 'older brief removed');
select pg_temp.assert((select count(*) from public.design_briefs where business_id = :'biz') = 1, 'latest brief kept');

-- A prototype that is online, or being built, cannot be deleted.
reset role;
set session_replication_role = replica;
insert into public.approvals (organisation_id, subject_type, subject_id, content_hash, decision, decided_by)
values (:'org', 'website', :'site', 'h', 'approved', '00000000-0000-0000-0000-0000000097a1') returning id as appr \gset
insert into public.deployment_records (organisation_id, business_id, website_id, version_id, approval_id, project_name, status)
values (:'org', :'biz', :'site', :'v1', :'appr', 'p', 'verified');
set session_replication_role = origin;
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000097a1","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.delete_website(%L)$q$, :'site'), 'take it offline first');
reset role;
set session_replication_role = replica;
update public.deployment_records set status = 'removed', removed_at = now() where website_id = :'site';
set session_replication_role = origin;
insert into public.site_builds (organisation_id, business_id, website_id, kind, status) values (:'org', :'biz', :'site', 'new', 'running') returning id as build \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000097a1","role":"authenticated"}';
select pg_temp.expect_error(format($q$select public.delete_website(%L)$q$, :'site'), 'stop it first');
select pg_temp.expect_error(format($q$select public.delete_design_work(%L)$q$, :'biz'), 'stop it first');
reset role;
update public.site_builds set status = 'stopped' where id = :'build';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000097a1","role":"authenticated"}';

-- Owners delete the prototype with its history; the lead goes back to qualified.
select pg_temp.assert(public.delete_website(:'site'), 'prototype deleted');
reset role;
select pg_temp.assert((select count(*) from public.generated_websites where id = :'site') = 0, 'site gone');
select pg_temp.assert((select count(*) from public.website_versions where website_id = :'site') = 0, 'versions gone');
select pg_temp.assert((select count(*) from public.site_builds where website_id = :'site') = 0, 'builds gone');
select pg_temp.assert((select status::text from public.businesses where id = :'biz') = 'qualified', 'lead back to qualified');
select pg_temp.assert((select count(*) from public.approvals where subject_id = :'site') = 1, 'approval history kept');
select pg_temp.assert((select count(*) from public.audit_logs where entity_id = :'site' and action = 'website.deleted') = 1, 'deletion audited');

-- Design work: briefs, studio and the business's own references go; shared references stay.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000097a1","role":"authenticated"}';
select pg_temp.assert(public.delete_design_work(:'biz') = array['x/uploads/1.png'], 'returns upload paths');
reset role;
select pg_temp.assert((select count(*) from public.design_briefs where business_id = :'biz') = 0, 'briefs gone');
select pg_temp.assert((select count(*) from public.design_studios where business_id = :'biz') = 0, 'studio gone');
select pg_temp.assert((select count(*) from public.design_references where business_id = :'biz') = 0, 'own references gone');
select pg_temp.assert((select count(*) from public.design_references where organisation_id = :'org' and business_id is null) = 1, 'shared reference kept');
\echo 'ALL CLEANUP TESTS PASSED'
