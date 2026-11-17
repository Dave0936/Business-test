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
  ('00000000-0000-0000-0000-0000000095a1', 'mail-owner@example.test'),
  ('00000000-0000-0000-0000-0000000095a2', 'mail-reader@example.test');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000095a1","role":"authenticated"}';
select public.create_organisation('Mail Org') as org \gset
insert into public.organisation_members (organisation_id, user_id, role) values (:'org', '00000000-0000-0000-0000-0000000095a2', 'read_only');
insert into public.businesses (organisation_id, name, normalized_name, country_code, dedupe_key, email, email_source, status)
values (:'org', 'Harbour Cafe', 'harbour cafe', 'GB', 'hc', 'Hello@Harbour-Cafe.co.uk', 'business_website', 'deployed') returning id as biz \gset
insert into public.email_drafts (organisation_id, business_id, to_email, subject, body_text, status, content_hash, idempotency_key)
values (:'org', :'biz', 'hello@harbour-cafe.co.uk', 'A concept', 'Body', 'awaiting_approval', 'x', 'mail-test-k1') returning id as draft \gset

-- Staff create the token with the draft; read-only members cannot.
insert into public.unsubscribe_tokens (token, organisation_id, email, draft_id) values (repeat('a', 43), :'org', 'hello@harbour-cafe.co.uk', :'draft');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000095a2","role":"authenticated"}';
select pg_temp.expect_error(format($q$insert into public.unsubscribe_tokens (token, organisation_id, email) values (%L, %L, 'x@y.z')$q$, repeat('b', 43), :'org'), 'row-level security');

-- The public page sees only the sender and a masked address.
set role anon;
set request.jwt.claims = '{"role":"anon"}';
select pg_temp.assert((select masked_email = 'h•••@harbour-cafe.co.uk' and agency_name = 'Mail Org' and not already_done from public.unsubscribe_token_info(repeat('a', 43))), 'masked info');
select pg_temp.assert((select count(*) from public.unsubscribe_token_info('short')) = 0, 'short tokens reveal nothing');
select pg_temp.expect_error($q$select * from public.unsubscribe_tokens$q$, 'permission denied');

-- Unsubscribing suppresses the address, cancels unsent email and marks the lead.
select pg_temp.assert(public.unsubscribe_with_token(repeat('a', 43), 'link'), 'unsubscribe works');
select pg_temp.assert(not public.unsubscribe_with_token(repeat('c', 43)), 'unknown token is refused');
select pg_temp.assert(public.unsubscribe_with_token(repeat('a', 43), 'link'), 'repeating is harmless');
reset role;
select pg_temp.assert((select count(*) from public.suppression_lists where organisation_id = :'org' and email = 'hello@harbour-cafe.co.uk' and reason = 'unsubscribed') = 1, 'suppressed once');
select pg_temp.assert((select status::text from public.email_drafts where id = :'draft') = 'cancelled', 'draft cancelled');
select pg_temp.assert((select status::text from public.businesses where id = :'biz') = 'suppressed', 'lead suppressed');
select pg_temp.assert((select count(*) from public.crm_activities where business_id = :'biz' and type = 'unsubscribed') = 1, 'activity recorded once');
select pg_temp.assert((select count(*) from public.audit_logs where organisation_id = :'org' and action = 'email.unsubscribed') = 1, 'audited once');
\echo 'ALL EMAIL OUTREACH TESTS PASSED'
