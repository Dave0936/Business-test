-- Harden function exposure (Supabase security advisor 0011 / 0028 / 0029).
-- Supabase grants EXECUTE on new public functions to anon and authenticated, which would
-- expose internal helpers at /rest/v1/rpc/*. Revoke everything, then grant only what
-- clients genuinely call. Future migrations must grant EXECUTE explicitly.

alter function public.is_service() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.website_versions_guard() set search_path = public;
alter function public.audit_logs_guard() set search_path = public;

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- RLS policy helpers: evaluated as the querying role, so they must stay executable.
-- They only ever report on the caller's own memberships (auth.uid()).
grant execute on function public.is_org_member(uuid) to anon, authenticated;
grant execute on function public.has_org_role(uuid, public.org_role[]) to anon, authenticated;
grant execute on function public.can_write(uuid) to anon, authenticated;
grant execute on function public.can_approve(uuid) to anon, authenticated;

-- Hash helpers run with definer rights so triggers work whatever the caller's privileges
-- (pgcrypto may live in public or extensions). They only hash their arguments.
alter function public.website_version_hash(jsonb, jsonb) security definer;
alter function public.email_content_hash(text, text, text) security definer;
grant execute on function public.website_version_hash(jsonb, jsonb) to authenticated;
grant execute on function public.email_content_hash(text, text, text) to authenticated;

-- Client-callable RPCs (each checks the caller's role itself).
grant execute on function public.create_organisation(text) to authenticated;
grant execute on function public.decide_approval(public.approval_subject, uuid, public.approval_decision, text) to authenticated;
grant execute on function public.dashboard_metrics(uuid, text, text, timestamptz, timestamptz, public.opportunity_type, int) to authenticated;
grant execute on function public.analytics_breakdown(uuid, text, timestamptz, timestamptz) to authenticated;

-- Worker-only RPCs.
grant execute on function public.claim_jobs(text, int) to service_role;
grant execute on function public.bump_run_stat(uuid, text, int) to service_role;
grant execute on function public.finish_idle_runs() to service_role;
