-- User-scoped job processing.
-- Work a person starts (searches, audits, research, generation, drafting) is queued and
-- processed with that person's own permissions, so row-level security applies throughout.
-- Privileged jobs (deploy, send_email, retention_sweep) remain service-role only.

create or replace function public.user_job_types() returns text[]
language sql immutable as $$ select array['discover','audit','research','generate','draft_email'] $$;

-- Enqueue; returns true if a new job was created (false if the same work already exists).
-- Idempotency keys are namespaced per organisation, so tenants can never collide.
create or replace function public.enqueue_job(
  p_org uuid, p_run uuid, p_type text, p_payload jsonb, p_key text,
  p_run_at timestamptz default now(), p_max_attempts int default 3
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_service() then
    if not public.can_write(p_org) then
      raise exception 'not allowed to queue work for this organisation';
    end if;
    if not (p_type = any (public.user_job_types())) then
      raise exception 'job type % can only be queued by the system', p_type;
    end if;
  end if;
  if p_run is not null and not exists (select 1 from public.automation_runs r where r.id = p_run and r.organisation_id = p_org) then
    raise exception 'run does not belong to this organisation';
  end if;
  insert into public.jobs (organisation_id, run_id, type, payload, idempotency_key, run_at, max_attempts)
  values (p_org, p_run, p_type, coalesce(p_payload, '{}'::jsonb), p_org::text || ':' || p_key, p_run_at, p_max_attempts)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

-- Claim the caller's organisation's due user-safe jobs (skips paused runs).
create or replace function public.claim_org_jobs(p_org uuid, p_worker text, p_limit int default 1)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write(p_org) then
    raise exception 'not allowed to process jobs for this organisation';
  end if;
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

-- Record a job outcome. Members may only complete running user-safe jobs of their organisation.
create or replace function public.complete_job(
  p_job uuid, p_status public.job_status, p_result jsonb default null, p_error text default null,
  p_run_at timestamptz default null, p_refund_attempt boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'job not found'; end if;
  if not public.is_service() then
    if not public.can_write(j.organisation_id) or not (j.type = any (public.user_job_types())) or j.status <> 'running' then
      raise exception 'not allowed to complete this job';
    end if;
  end if;
  if p_status not in ('queued','succeeded','failed','cancelled') then
    raise exception 'invalid job status %', p_status;
  end if;
  update public.jobs set
    status = p_status,
    result = coalesce(p_result, result),
    last_error = p_error,
    run_at = coalesce(p_run_at, run_at),
    attempts = case when p_refund_attempt then greatest(attempts - 1, 0) else attempts end,
    locked_at = null,
    locked_by = null,
    finished_at = case when p_status in ('succeeded','failed','cancelled') then now() else null end
  where id = p_job;
end $$;

-- Run statistics may be bumped by members for their own organisation's runs.
create or replace function public.bump_run_stat(p_run uuid, p_key text, p_by int default 1)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() and not exists (
    select 1 from public.automation_runs r where r.id = p_run and public.can_write(r.organisation_id)
  ) then
    raise exception 'not allowed';
  end if;
  update public.automation_runs
  set stats = jsonb_set(stats, array[p_key], to_jsonb(coalesce((stats ->> p_key)::int, 0) + p_by))
  where id = p_run;
end $$;

-- Finish idle runs: all of them for the service worker, or the caller's organisation's.
drop function if exists public.finish_idle_runs();
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
      and r.started_at < now() - interval '2 seconds'
      and not exists (select 1 from public.jobs j where j.run_id = r.id and j.status in ('queued','running'))
    returning 1
  ) select count(*)::int into n from done;
  return n;
end $$;

revoke execute on function public.user_job_types() from public, anon, authenticated;
revoke execute on function public.enqueue_job(uuid, uuid, text, jsonb, text, timestamptz, int) from public, anon;
revoke execute on function public.claim_org_jobs(uuid, text, int) from public, anon;
revoke execute on function public.complete_job(uuid, public.job_status, jsonb, text, timestamptz, boolean) from public, anon;
revoke execute on function public.bump_run_stat(uuid, text, int) from public, anon;
revoke execute on function public.finish_idle_runs(uuid) from public, anon;
grant execute on function public.enqueue_job(uuid, uuid, text, jsonb, text, timestamptz, int) to authenticated, service_role;
grant execute on function public.claim_org_jobs(uuid, text, int) to authenticated;
grant execute on function public.complete_job(uuid, public.job_status, jsonb, text, timestamptz, boolean) to authenticated, service_role;
grant execute on function public.bump_run_stat(uuid, text, int) to authenticated, service_role;
grant execute on function public.finish_idle_runs(uuid) to authenticated, service_role;

-- AI usage rows are written by whoever ran the agent (member or worker); they are append-only
-- cost records used for budgets, so members may insert for their own organisation.
create policy api_usage_insert on public.api_usage for insert with check (public.can_write(organisation_id));
