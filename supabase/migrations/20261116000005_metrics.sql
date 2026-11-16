-- Dashboard and analytics aggregates. SECURITY INVOKER: callers only ever see their own rows.

create or replace function public.dashboard_metrics(
  p_org uuid,
  p_country text default null,
  p_sector text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_opportunity public.opportunity_type default null,
  p_min_score int default null
) returns jsonb
language sql stable security invoker set search_path = public as $$
  with b as (
    select * from public.businesses
    where organisation_id = p_org
      and (p_country is null or country_code = upper(p_country))
      and (p_sector is null or sector = p_sector or industry_id = p_sector)
      and (p_from is null or discovered_at >= p_from)
      and (p_to is null or discovered_at < p_to)
      and (p_opportunity is null or opportunity_type = p_opportunity)
      and (p_min_score is null or lead_score >= p_min_score)
  ),
  w as (select w.* from public.generated_websites w join b on b.id = w.business_id),
  e as (select e.* from public.email_drafts e join b on b.id = e.business_id where e.kind <> 'test')
  select jsonb_build_object(
    'discovered', (select count(*) from b),
    'real_discovered', (select count(*) from b where not is_demo),
    'no_website', (select count(*) from b where opportunity_type = 'no_website'),
    'outdated', (select count(*) from b where opportunity_type in ('outdated_website','poor_mobile','weak_functionality','poor_enquiry_booking')),
    'qualified', (select count(*) from b where exists (
        select 1 from public.opportunity_scores s where s.business_id = b.id and s.qualified
        and s.created_at = (select max(created_at) from public.opportunity_scores s2 where s2.business_id = b.id))),
    'avg_score', (select round(avg(lead_score)::numeric, 1) from b where lead_score is not null),
    'designs_researched', (select count(distinct d.business_id) from public.design_briefs d join b on b.id = d.business_id),
    'prototypes_generated', (select count(*) from w where current_version_id is not null),
    'awaiting_approval', (select count(*) from w where status = 'awaiting_approval'),
    'deployments', (select count(*) from public.deployment_records d join b on b.id = d.business_id where d.status in ('succeeded','verified')),
    'emails_awaiting', (select count(*) from e where status in ('review','awaiting_approval')),
    'emails_sent', (select count(*) from e where status = 'sent'),
    'replies', (select count(distinct ev.draft_id) from public.email_events ev join e on e.id = ev.draft_id where ev.type = 'email.received'),
    'interested', (select count(*) from b where status in ('interested','meeting_requested','converted')),
    'converted', (select count(*) from b where status = 'converted'),
    'actual_revenue', (select coalesce(sum(actual_revenue), 0) from b where status = 'converted'),
    'estimated_value', (select coalesce(sum(estimated_value), 0) from b where status not in ('not_qualified','not_interested','suppressed','converted'))
  );
$$;

create or replace function public.analytics_breakdown(p_org uuid, p_dimension text, p_from timestamptz default null, p_to timestamptz default null)
returns table (label text, leads bigint, qualified bigint, avg_score numeric, contacted bigint, interested bigint, converted bigint, estimated_value numeric, actual_revenue numeric)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_dimension not in ('country_code','sector','industry_id','opportunity_type','status') then
    raise exception 'unsupported dimension %', p_dimension;
  end if;
  return query execute format($q$
    select coalesce(%1$I::text, 'unknown') as label,
      count(*) as leads,
      count(*) filter (where status not in ('new','researching','not_qualified')) as qualified,
      round(avg(lead_score)::numeric, 1) as avg_score,
      count(*) filter (where status in ('contacted','replied','interested','meeting_requested','converted','not_interested')) as contacted,
      count(*) filter (where status in ('interested','meeting_requested','converted')) as interested,
      count(*) filter (where status = 'converted') as converted,
      coalesce(sum(estimated_value) filter (where status not in ('not_qualified','not_interested','suppressed','converted')), 0) as estimated_value,
      coalesce(sum(actual_revenue) filter (where status = 'converted'), 0) as actual_revenue
    from public.businesses
    where organisation_id = $1 and ($2::timestamptz is null or discovered_at >= $2) and ($3::timestamptz is null or discovered_at < $3)
    group by 1 order by 2 desc
  $q$, p_dimension) using p_org, p_from, p_to;
end $$;

grant execute on function public.dashboard_metrics(uuid, text, text, timestamptz, timestamptz, public.opportunity_type, int) to authenticated;
grant execute on function public.analytics_breakdown(uuid, text, timestamptz, timestamptz) to authenticated;
