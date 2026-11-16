\set ON_ERROR_STOP 1
-- Internal helpers are not callable by clients; intended RPCs are.
do $$
begin
  if has_function_privilege('authenticated', 'public.current_approval(public.approval_subject, uuid, text)', 'execute') then raise exception 'current_approval exposed'; end if;
  if has_function_privilege('authenticated', 'public.claim_jobs(text, int)', 'execute') then raise exception 'claim_jobs exposed'; end if;
  if has_function_privilege('anon', 'public.create_organisation(text)', 'execute') then raise exception 'create_organisation exposed to anon'; end if;
  if has_function_privilege('authenticated', 'public.bump_run_stat(uuid, text, int)', 'execute') then raise exception 'bump_run_stat exposed'; end if;
  if not has_function_privilege('authenticated', 'public.decide_approval(public.approval_subject, uuid, public.approval_decision, text)', 'execute') then raise exception 'decide_approval missing'; end if;
  if not has_function_privilege('authenticated', 'public.dashboard_metrics(uuid, text, text, timestamptz, timestamptz, public.opportunity_type, int)', 'execute') then raise exception 'dashboard_metrics missing'; end if;
  if not has_function_privilege('service_role', 'public.claim_jobs(text, int)', 'execute') then raise exception 'worker cannot claim'; end if;
end $$;
\echo 'ALL FUNCTION PRIVILEGE TESTS PASSED'
