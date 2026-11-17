-- Phase 9: stopping a run cancels its queued work. Jobs are written by the server only, so this
-- runs as definer with an explicit membership and role check.
create or replace function public.cancel_run(p_run uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r public.automation_runs;
begin
  select * into r from public.automation_runs where id = p_run for update;
  if r.id is null or not public.is_org_member(r.organisation_id) then return false; end if;
  if not public.can_write(r.organisation_id) then raise exception 'your role cannot stop runs'; end if;
  if r.status not in ('running', 'paused') then return false; end if;
  update public.automation_runs set status = 'cancelled', finished_at = now() where id = p_run;
  update public.jobs set status = 'cancelled', last_error = 'Run stopped by a team member'
    where run_id = p_run and status = 'queued';
  insert into public.audit_logs (organisation_id, actor_id, action, entity_type, entity_id, data)
  values (r.organisation_id, auth.uid(), 'automation.run_cancelled', 'automation_run', p_run, '{}'::jsonb);
  return true;
end $$;
revoke all on function public.cancel_run(uuid) from public, anon;
grant execute on function public.cancel_run(uuid) to authenticated;
