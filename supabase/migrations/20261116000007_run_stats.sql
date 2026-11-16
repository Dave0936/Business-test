-- Atomic counters for automation run statistics (avoids read-modify-write races between workers).
create or replace function public.bump_run_stat(p_run uuid, p_key text, p_by int default 1)
returns void language sql security definer set search_path = public as $$
  update public.automation_runs
  set stats = jsonb_set(stats, array[p_key], to_jsonb(coalesce((stats ->> p_key)::int, 0) + p_by))
  where id = p_run;
$$;
revoke execute on function public.bump_run_stat(uuid, text, int) from public, anon, authenticated;

-- Finish runs that have no outstanding jobs.
create or replace function public.finish_idle_runs() returns int
language sql security definer set search_path = public as $$
  with done as (
    update public.automation_runs r set status = case when exists (select 1 from public.jobs j where j.run_id = r.id and j.status = 'failed') and not exists (select 1 from public.jobs j where j.run_id = r.id and j.status = 'succeeded') then 'failed'::public.run_status else 'succeeded'::public.run_status end,
      finished_at = now()
    where r.status = 'running'
      and r.started_at < now() - interval '5 seconds'
      and not exists (select 1 from public.jobs j where j.run_id = r.id and j.status in ('queued','running'))
    returning 1
  ) select count(*)::int from done;
$$;
revoke execute on function public.finish_idle_runs() from public, anon, authenticated;
