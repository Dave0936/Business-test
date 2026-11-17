-- Phase 10: fixes from the Supabase security and performance advisors.

-- Fixed search path for every function.
alter function public.user_job_types() set search_path = public;

-- Membership helpers are used inside policies and definer functions; nobody signed out needs them.
revoke execute on function public.can_approve(uuid) from anon;
revoke execute on function public.can_write(uuid) from anon;
revoke execute on function public.has_org_role(uuid, public.org_role[]) from anon;
revoke execute on function public.is_org_member(uuid) from anon;

-- (The content-hash functions stay callable by members: they only compute a hash, and the
-- website version trigger runs as the member saving it. See migration 8.)

-- Evaluate auth.uid() once per statement, not once per row.
drop policy users_select on public.users;
create policy users_select on public.users for select using (
  id = (select auth.uid()) or exists (
    select 1 from public.organisation_members a
    join public.organisation_members b on a.organisation_id = b.organisation_id
    where a.user_id = (select auth.uid()) and b.user_id = users.id
  )
);
drop policy users_update_self on public.users;
create policy users_update_self on public.users for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy members_delete on public.organisation_members;
create policy members_delete on public.organisation_members for delete
  using (public.has_org_role(organisation_id, array['owner']::public.org_role[]) and user_id <> (select auth.uid()));
drop policy audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs for insert
  with check (public.is_org_member(organisation_id) and actor_id = (select auth.uid()));

-- One policy per action on compliance rules (reading is covered by compliance_select).
drop policy compliance_write on public.compliance_rules;
create policy compliance_insert on public.compliance_rules for insert to authenticated
  with check (organisation_id is not null and public.can_approve(organisation_id));
create policy compliance_update on public.compliance_rules for update to authenticated
  using (organisation_id is not null and public.can_approve(organisation_id))
  with check (organisation_id is not null and public.can_approve(organisation_id));
create policy compliance_delete on public.compliance_rules for delete to authenticated
  using (organisation_id is not null and public.can_approve(organisation_id));

-- Indexes for the lists and reports the app actually runs.
create index if not exists crm_activities_org_time_idx on public.crm_activities (organisation_id, created_at desc);
create index if not exists approvals_org_time_idx on public.approvals (organisation_id, decided_at desc);
create index if not exists automation_runs_org_time_idx on public.automation_runs (organisation_id, started_at desc);
create index if not exists automation_workflows_org_idx on public.automation_workflows (organisation_id);
create index if not exists jobs_org_status_idx on public.jobs (organisation_id, status);
create index if not exists deployment_records_business_idx on public.deployment_records (business_id);
create index if not exists deployment_records_org_time_idx on public.deployment_records (organisation_id, created_at desc);
create index if not exists email_events_org_idx on public.email_events (organisation_id);
create index if not exists generated_images_org_idx on public.generated_images (organisation_id);
create index if not exists quality_reports_website_idx on public.quality_reports (website_id);
create index if not exists site_builds_business_idx on public.site_builds (business_id);
create index if not exists site_builds_result_version_idx on public.site_builds (result_version_id);
create index if not exists website_versions_org_idx on public.website_versions (organisation_id);
create index if not exists website_audits_org_idx on public.website_audits (organisation_id);
create index if not exists opportunity_scores_org_idx on public.opportunity_scores (organisation_id);
create index if not exists design_briefs_org_idx on public.design_briefs (organisation_id, created_at desc);
create index if not exists unsubscribe_tokens_org_idx on public.unsubscribe_tokens (organisation_id);
