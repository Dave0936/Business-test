-- Trend and series data for the Overview. Real counts only: each metric compares the last
-- p_days days with the p_days before that. SECURITY INVOKER, so RLS applies.

create or replace function public.dashboard_trends(
  p_org uuid, p_days int default 30, p_country text default null, p_sector text default null
) returns jsonb
language sql stable security invoker set search_path = public as $$
  with b as (
    select id, discovered_at from public.businesses
    where organisation_id = p_org
      and (p_country is null or country_code = upper(p_country))
      and (p_sector is null or sector = p_sector or industry_id = p_sector)
  ),
  w as (select now() - make_interval(days => p_days) as cur_start, now() - make_interval(days => 2 * p_days) as prev_start)
  select jsonb_build_object(
    'days', p_days,
    'discovered', jsonb_build_array(
      (select count(*) from b, w where b.discovered_at >= w.cur_start),
      (select count(*) from b, w where b.discovered_at >= w.prev_start and b.discovered_at < w.cur_start)),
    'qualified', jsonb_build_array(
      (select count(distinct s.business_id) from public.opportunity_scores s join b on b.id = s.business_id, w where s.qualified and s.created_at >= w.cur_start),
      (select count(distinct s.business_id) from public.opportunity_scores s join b on b.id = s.business_id, w where s.qualified and s.created_at >= w.prev_start and s.created_at < w.cur_start)),
    'prototypes', jsonb_build_array(
      (select count(*) from public.website_versions v join public.generated_websites g on g.id = v.website_id join b on b.id = g.business_id, w where v.version = 1 and v.created_at >= w.cur_start),
      (select count(*) from public.website_versions v join public.generated_websites g on g.id = v.website_id join b on b.id = g.business_id, w where v.version = 1 and v.created_at >= w.prev_start and v.created_at < w.cur_start)),
    'emails_sent', jsonb_build_array(
      (select count(*) from public.email_drafts e join b on b.id = e.business_id, w where e.status = 'sent' and e.sent_at >= w.cur_start),
      (select count(*) from public.email_drafts e join b on b.id = e.business_id, w where e.status = 'sent' and e.sent_at >= w.prev_start and e.sent_at < w.cur_start)),
    'replies', jsonb_build_array(
      (select count(*) from public.email_events ev join public.email_drafts e on e.id = ev.draft_id join b on b.id = e.business_id, w where ev.type = 'email.received' and ev.occurred_at >= w.cur_start),
      (select count(*) from public.email_events ev join public.email_drafts e on e.id = ev.draft_id join b on b.id = e.business_id, w where ev.type = 'email.received' and ev.occurred_at >= w.prev_start and ev.occurred_at < w.cur_start))
  );
$$;

-- Businesses discovered per ISO week for the last p_weeks weeks (zero-filled).
create or replace function public.weekly_discoveries(p_org uuid, p_weeks int default 8, p_country text default null, p_sector text default null)
returns table (week_start date, discovered bigint, qualified bigint)
language sql stable security invoker set search_path = public as $$
  with weeks as (
    select generate_series(date_trunc('week', now()) - make_interval(weeks => p_weeks - 1), date_trunc('week', now()), interval '1 week')::date as week_start
  )
  select w.week_start,
    count(b.id) as discovered,
    count(b.id) filter (where b.status not in ('new','researching','not_qualified')) as qualified
  from weeks w
  left join public.businesses b
    on b.organisation_id = p_org
   and date_trunc('week', b.discovered_at)::date = w.week_start
   and (p_country is null or b.country_code = upper(p_country))
   and (p_sector is null or b.sector = p_sector or b.industry_id = p_sector)
  group by w.week_start
  order by w.week_start;
$$;

grant execute on function public.dashboard_trends(uuid, int, text, text) to authenticated;
grant execute on function public.weekly_discoveries(uuid, int, text, text) to authenticated;
