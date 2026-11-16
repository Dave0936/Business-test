\set ON_ERROR_STOP 1
-- Metrics functions run under the caller's RLS and only return their own organisation's data.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'm1@example.test'), ('00000000-0000-0000-0000-0000000000e2', 'm2@example.test');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select public.create_organisation('Metrics Org') as org \gset
insert into public.businesses (organisation_id, name, normalized_name, country_code, sector, dedupe_key, opportunity_type, lead_score, status)
values (:'org', 'A', 'a', 'GB', 'food', 'a', 'no_website', 80, 'qualified'),
       (:'org', 'B', 'b', 'FR', 'beauty', 'b', 'poor_mobile', 40, 'not_qualified');
do $$ declare m jsonb; begin
  m := public.dashboard_metrics((select id from public.organisations limit 1));
  if (m->>'discovered')::int <> 2 or (m->>'no_website')::int <> 1 or (m->>'outdated')::int <> 1 then raise exception 'bad metrics %', m; end if;
  m := public.dashboard_metrics((select id from public.organisations limit 1), 'gb');
  if (m->>'discovered')::int <> 1 then raise exception 'country filter failed %', m; end if;
  if (select count(*) from public.analytics_breakdown((select id from public.organisations limit 1), 'country_code')) <> 2 then raise exception 'breakdown failed'; end if;
end $$;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
do $$ begin
  if (public.dashboard_metrics('00000000-0000-0000-0000-000000000000'::uuid)->>'discovered')::int <> 0 then raise exception 'leak'; end if;
end $$;
select (public.dashboard_metrics(:'org')->>'discovered')::int = 0 as isolated \gset
\if :isolated
\else
  \echo 'CROSS-TENANT LEAK IN METRICS'
  select 1/0;
\endif
reset role;
\echo 'ALL METRICS TESTS PASSED'
