-- Runs are now created paused, their jobs queued, then set running (see startWorkflowRun),
-- so a running run with no outstanding jobs is genuinely finished: no delay needed.
create or replace function public.finish_idle_runs(p_org uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_service() and (p_org is null or not public.can_write(p_org)) then
    raise exception 'not allowed';
  end if;
  with done as (
    update public.automation_runs r set
      status = case when exists (select 1 from public.jobs j where j.run_id = r.id and j.status = 'failed')
                     and not exists (select 1 from public.jobs j where j.run_id = r.id and j.status = 'succeeded')
                    then 'failed'::public.run_status else 'succeeded'::public.run_status end,
      finished_at = now()
    where r.status = 'running'
      and (p_org is null or r.organisation_id = p_org)
      and not exists (select 1 from public.jobs j where j.run_id = r.id and j.status in ('queued','running'))
    returning 1
  ) select count(*)::int into n from done;
  return n;
end $$;
