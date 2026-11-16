-- Jobs whose worker stopped mid-way (for example a serverless time limit) were left
-- 'running' for ever when processed by members, which kept their run 'running' too.
-- Both claim functions now recover them first: back to the queue while attempts remain,
-- otherwise failed with a clear error, so the run can finish.

create or replace function public.recover_stale_jobs(p_org uuid default null, p_user_types_only boolean default false)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with stale as (
    update public.jobs j set
      status = case when j.attempts >= j.max_attempts then 'failed'::public.job_status else 'queued'::public.job_status end,
      locked_at = null, locked_by = null,
      finished_at = case when j.attempts >= j.max_attempts then now() else null end,
      last_error = 'The worker stopped before this job finished (time limit or restart).'
    where j.status = 'running'
      and j.locked_at < now() - interval '10 minutes'
      and (p_org is null or j.organisation_id = p_org)
      and (not p_user_types_only or j.type = any (public.user_job_types()))
    returning 1
  ) select count(*)::int into n from stale;
  return n;
end $$;
revoke all on function public.recover_stale_jobs(uuid, boolean) from public, anon, authenticated;

create or replace function public.claim_org_jobs(p_org uuid, p_worker text, p_limit int default 1)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write(p_org) then
    raise exception 'not allowed to process jobs for this organisation';
  end if;
  perform public.recover_stale_jobs(p_org, true);
  return query
  update public.jobs j set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
  where j.id in (
    select q.id from public.jobs q
    left join public.automation_runs r on r.id = q.run_id
    where q.organisation_id = p_org and q.status = 'queued' and q.run_at <= now()
      and q.type = any (public.user_job_types())
      and (r.id is null or r.status = 'running')
    order by q.run_at
    for update of q skip locked
    limit least(p_limit, 10)
  )
  returning j.*;
end $$;

create or replace function public.claim_jobs(p_worker text, p_limit int default 5)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then
    raise exception 'claim_jobs is for the worker only';
  end if;
  perform public.recover_stale_jobs(null, false);
  return query
  update public.jobs j set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
  where j.id in (
    select q.id from public.jobs q
    left join public.automation_runs r on r.id = q.run_id
    where q.status = 'queued' and q.run_at <= now()
      and (r.id is null or r.status = 'running')
    order by q.run_at
    for update of q skip locked
    limit p_limit
  )
  returning j.*;
end $$;

-- Pending work a member can move along (drives the in-app progress indicator).
create or replace function public.org_pending_jobs(p_org uuid)
returns table (queued bigint, running bigint, next_run_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not allowed';
  end if;
  return query
  select count(*) filter (where j.status = 'queued'), count(*) filter (where j.status = 'running'),
         min(j.run_at) filter (where j.status = 'queued')
  from public.jobs j
  left join public.automation_runs r on r.id = j.run_id
  where j.organisation_id = p_org and j.status in ('queued','running')
    and j.type = any (public.user_job_types())
    and (r.id is null or r.status = 'running');
end $$;
revoke all on function public.org_pending_jobs(uuid) from public, anon;
grant execute on function public.org_pending_jobs(uuid) to authenticated;
