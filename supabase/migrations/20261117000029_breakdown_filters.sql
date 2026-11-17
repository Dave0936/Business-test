-- Phase 10: the analytics breakdowns honour the same filters as the rest of the page.
drop function if exists public.analytics_breakdown(uuid, text, timestamptz, timestamptz);

create or replace function public.analytics_breakdown(
  p_org uuid, p_dimension text, p_from timestamptz default null, p_to timestamptz default null,
  p_country text default null, p_sector text default null, p_opportunity public.opportunity_type default null, p_min_score int default null
)
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
    where organisation_id = $1
      and ($2::timestamptz is null or discovered_at >= $2) and ($3::timestamptz is null or discovered_at < $3)
      and ($4::text is null or country_code = upper($4))
      and ($5::text is null or sector = $5 or industry_id = $5)
      and ($6::public.opportunity_type is null or opportunity_type = $6)
      and ($7::int is null or lead_score >= $7)
    group by 1 order by 2 desc
  $q$, p_dimension) using p_org, p_from, p_to, p_country, p_sector, p_opportunity, p_min_score;
end $$;

revoke all on function public.analytics_breakdown(uuid, text, timestamptz, timestamptz, text, text, public.opportunity_type, int) from public, anon;
grant execute on function public.analytics_breakdown(uuid, text, timestamptz, timestamptz, text, text, public.opportunity_type, int) to authenticated;
