-- Row-level security, column privileges and approval enforcement.
--
-- Defence in depth: the application checks approvals before deploying or sending,
-- and these triggers check again inside the database, so a bug in application
-- code (or a hand-written SQL update) still cannot bypass approval.

-- True for service-role API requests (background worker, webhooks) and for direct
-- administrative connections with no request JWT (migrations, psql).
-- Uses the request JWT rather than current_user, because current_user is the
-- function owner inside SECURITY DEFINER functions and triggers.
create or replace function public.is_service() returns boolean
language sql stable as $$
  select
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or (
      coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
      and session_user in ('postgres', 'supabase_admin')
      and current_setting('role', true) in ('none', 'postgres', '')
    );
$$;

-- ---------------------------------------------------------------------------
-- Content hashing (computed in the database, never trusted from clients)
-- ---------------------------------------------------------------------------
create or replace function public.email_content_hash(p_to text, p_subject text, p_body text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(lower(coalesce(p_to,'')) || E'\x1f' || coalesce(p_subject,'') || E'\x1f' || coalesce(p_body,''), 'sha256'), 'hex');
$$;

create or replace function public.website_version_hash(p_spec jsonb, p_files jsonb) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(coalesce(p_spec::text,'') || E'\x1f' || coalesce(p_files::text,''), 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Website versions are immutable once written
-- ---------------------------------------------------------------------------
create or replace function public.website_versions_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.content_hash := public.website_version_hash(new.spec, new.files);
    return new;
  end if;
  raise exception 'website versions are immutable; create a new version instead';
end $$;

create trigger website_versions_guard before insert or update on public.website_versions
  for each row execute function public.website_versions_guard();

-- Latest decision for a subject, only if it still matches the current content.
create or replace function public.current_approval(p_type public.approval_subject, p_subject uuid, p_hash text)
returns public.approvals
language sql stable security definer set search_path = public as $$
  select a.* from public.approvals a
  where a.subject_type = p_type and a.subject_id = p_subject
  order by a.decided_at desc, a.id desc
  limit 1
$$;

create or replace function public.is_approved(p_type public.approval_subject, p_subject uuid, p_hash text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select a.decision = 'approved' and a.content_hash = p_hash
    from public.current_approval(p_type, p_subject, p_hash) a
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- Approvals: only owners/administrators, recorded as themselves
-- ---------------------------------------------------------------------------
create or replace function public.approvals_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'approvals are append-only';
  end if;
  if not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = new.organisation_id
      and m.user_id = new.decided_by
      and m.role in ('owner','administrator')
  ) then
    raise exception 'only owners or administrators can record approval decisions';
  end if;
  if not public.is_service() and new.decided_by is distinct from auth.uid() then
    raise exception 'approval must be recorded by the deciding user';
  end if;
  return new;
end $$;

create trigger approvals_guard before insert or update or delete on public.approvals
  for each row execute function public.approvals_guard();

-- ---------------------------------------------------------------------------
-- Website status transitions
-- ---------------------------------------------------------------------------
create or replace function public.generated_websites_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_qc boolean;
begin
  -- A new version voids earlier QA and approval.
  if tg_op = 'UPDATE' and new.current_version_id is distinct from old.current_version_id
     and new.status = old.status
     and old.status in ('quality_checked','awaiting_approval','approved','deployed') then
    new.status := 'generated';
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    select content_hash into v_hash from public.website_versions where id = new.current_version_id;

    if new.status in ('quality_checked','awaiting_approval','approved') then
      select q.passed into v_qc from public.quality_reports q
      where q.version_id = new.current_version_id
      order by q.created_at desc limit 1;
      if not coalesce(v_qc, false) then
        raise exception 'website % cannot move to % without a passing quality report for its current version', new.id, new.status;
      end if;
    end if;

    if new.status = 'approved' and not public.is_approved('website', new.id, v_hash) then
      raise exception 'website % has no approval for its current version', new.id;
    end if;

    if new.status = 'deployed' then
      if not public.is_service() then
        raise exception 'only the deployment service can mark a website deployed';
      end if;
      if not exists (
        select 1 from public.deployment_records d
        where d.website_id = new.id and d.version_id = new.current_version_id
          and d.status in ('succeeded','verified')
      ) then
        raise exception 'website % has no successful deployment for its current version', new.id;
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger generated_websites_guard before update on public.generated_websites
  for each row execute function public.generated_websites_guard();

-- ---------------------------------------------------------------------------
-- Deployments require an approval for exactly that version
-- ---------------------------------------------------------------------------
create or replace function public.deployment_records_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  a public.approvals;
begin
  if not public.is_service() then
    raise exception 'deployment records are written by the deployment service only';
  end if;
  if tg_op = 'INSERT' then
    select content_hash into v_hash from public.website_versions
      where id = new.version_id and website_id = new.website_id;
    if v_hash is null then
      raise exception 'version does not belong to website';
    end if;
    select * into a from public.approvals where id = new.approval_id;
    if a.id is null or a.subject_type <> 'website' or a.subject_id <> new.website_id
       or a.decision <> 'approved' or a.content_hash <> v_hash then
      raise exception 'deployment requires an approval of this exact website version';
    end if;
    if not public.is_approved('website', new.website_id, v_hash) then
      raise exception 'approval has been superseded by a later decision';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.approval_id <> old.approval_id or new.version_id <> old.version_id) then
    raise exception 'deployment approval and version cannot be changed';
  end if;
  return new;
end $$;

create trigger deployment_records_guard before insert or update on public.deployment_records
  for each row execute function public.deployment_records_guard();

-- ---------------------------------------------------------------------------
-- Email drafts: hash, approval and send guards
-- ---------------------------------------------------------------------------
create or replace function public.email_drafts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.content_hash := public.email_content_hash(new.to_email, new.subject, new.body_text);

  if tg_op = 'INSERT' then
    if new.status not in ('draft','review','awaiting_approval','blocked') then
      raise exception 'new emails must start as draft, review or awaiting approval';
    end if;
    new.approval_id := null;
    return new;
  end if;

  -- Sent emails are a record and cannot be edited.
  if old.status = 'sent' and (new.content_hash <> old.content_hash or new.status <> 'sent') then
    raise exception 'sent emails cannot be changed';
  end if;

  -- Editing content voids any earlier approval.
  if new.content_hash <> old.content_hash then
    new.approval_id := null;
    if new.status in ('approved','sending') then
      new.status := 'review';
    end if;
  end if;

  if new.status in ('approved','sending','sent') and new.status is distinct from old.status then
    if new.approval_id is null or not exists (
      select 1 from public.approvals a
      where a.id = new.approval_id and a.subject_type = 'email' and a.subject_id = new.id
        and a.decision = 'approved' and a.content_hash = new.content_hash
    ) or not public.is_approved('email', new.id, new.content_hash) then
      raise exception 'email % has no approval for its current content', new.id;
    end if;
  end if;

  if new.status in ('sending','sent') and new.status is distinct from old.status and not public.is_service() then
    raise exception 'only the sending service can mark an email as sending or sent';
  end if;

  if new.status = 'sent' and new.status is distinct from old.status and old.status <> 'sending' then
    raise exception 'emails must pass through sending before sent';
  end if;

  return new;
end $$;

create trigger email_drafts_guard before insert or update on public.email_drafts
  for each row execute function public.email_drafts_guard();

-- ---------------------------------------------------------------------------
-- Approval RPC: the only path that sets approved/rejected statuses
-- ---------------------------------------------------------------------------
create or replace function public.decide_approval(
  p_subject_type public.approval_subject,
  p_subject_id uuid,
  p_decision public.approval_decision,
  p_comment text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_hash text;
  v_status text;
  v_business uuid;
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_subject_type = 'website' then
    select w.organisation_id, v.content_hash, w.status::text, w.business_id
      into v_org, v_hash, v_status, v_business
    from public.generated_websites w
    join public.website_versions v on v.id = w.current_version_id
    where w.id = p_subject_id
    for update of w;
    if v_org is null then raise exception 'website not found'; end if;
    if v_status <> 'awaiting_approval' then
      raise exception 'website is %, not awaiting approval', v_status;
    end if;
  else
    select e.organisation_id, e.content_hash, e.status::text, e.business_id
      into v_org, v_hash, v_status, v_business
    from public.email_drafts e where e.id = p_subject_id
    for update;
    if v_org is null then raise exception 'email not found'; end if;
  end if;

  if not public.can_approve(v_org) then
    raise exception 'only owners or administrators can approve';
  end if;

  if p_subject_type = 'email' then
    if v_status not in ('review','awaiting_approval') then
      raise exception 'email is %, not awaiting approval', v_status;
    end if;
    if p_decision = 'approved' and exists (
      select 1 from public.email_drafts e where e.id = p_subject_id
        and coalesce((e.compliance ->> 'allowed')::boolean, false) = false
    ) then
      raise exception 'email failed compliance checks and cannot be approved';
    end if;
  end if;

  insert into public.approvals (organisation_id, subject_type, subject_id, content_hash, decision, comment, decided_by)
  values (v_org, p_subject_type, p_subject_id, v_hash, p_decision, p_comment, auth.uid())
  returning id into v_approval;

  if p_subject_type = 'website' then
    update public.generated_websites set status = case p_decision
      when 'approved' then 'approved'::public.website_status
      when 'rejected' then 'rejected'::public.website_status
      else 'changes_requested'::public.website_status end
    where id = p_subject_id;
  else
    update public.email_drafts set
      approval_id = case when p_decision = 'approved' then v_approval else null end,
      status = case p_decision
        when 'approved' then 'approved'::public.email_status
        when 'rejected' then 'cancelled'::public.email_status
        else 'review'::public.email_status end
    where id = p_subject_id;
  end if;

  insert into public.crm_activities (organisation_id, business_id, type, summary, data, actor_id)
  values (v_org, v_business, p_subject_type || '_' || p_decision,
          initcap(p_subject_type::text) || ' ' || replace(p_decision::text, '_', ' '),
          jsonb_build_object('approval_id', v_approval, 'comment', p_comment), auth.uid());

  insert into public.audit_logs (organisation_id, actor_id, action, entity_type, entity_id, data)
  values (v_org, auth.uid(), 'approval.' || p_decision, p_subject_type::text, p_subject_id,
          jsonb_build_object('approval_id', v_approval, 'content_hash', v_hash, 'comment', p_comment));

  return v_approval;
end $$;

-- ---------------------------------------------------------------------------
-- Audit log is append-only for everyone
-- ---------------------------------------------------------------------------
create or replace function public.audit_logs_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'audit log is append-only';
end $$;
create trigger audit_logs_no_change before update or delete on public.audit_logs
  for each row execute function public.audit_logs_guard();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'organisations','users','organisation_members','businesses','business_sources',
    'website_audits','opportunity_scores','design_references','design_briefs',
    'generated_websites','website_versions','quality_reports','approvals',
    'deployment_records','email_templates','email_drafts','email_events',
    'suppression_lists','unsubscribe_tokens','compliance_rules','crm_activities',
    'automation_workflows','automation_runs','jobs','integration_connections',
    'api_usage','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Organisations
create policy org_select on public.organisations for select using (public.is_org_member(id));
create policy org_update on public.organisations for update using (public.can_approve(id)) with check (public.can_approve(id));

-- Users: see yourself and colleagues
create policy users_select on public.users for select using (
  id = auth.uid() or exists (
    select 1 from public.organisation_members a
    join public.organisation_members b on a.organisation_id = b.organisation_id
    where a.user_id = auth.uid() and b.user_id = users.id
  )
);
create policy users_update_self on public.users for update using (id = auth.uid()) with check (id = auth.uid());

-- Membership: members can see the roster; owners manage it
create policy members_select on public.organisation_members for select using (public.is_org_member(organisation_id));
create policy members_insert on public.organisation_members for insert with check (public.has_org_role(organisation_id, array['owner']::public.org_role[]));
create policy members_update on public.organisation_members for update using (public.has_org_role(organisation_id, array['owner']::public.org_role[]));
create policy members_delete on public.organisation_members for delete using (public.has_org_role(organisation_id, array['owner']::public.org_role[]) and user_id <> auth.uid());

-- Standard tenant tables: members read, staff+ write, admins delete
do $$
declare t text;
begin
  foreach t in array array[
    'businesses','business_sources','website_audits','opportunity_scores',
    'design_references','design_briefs','generated_websites','website_versions',
    'quality_reports','email_templates','email_drafts','suppression_lists',
    'crm_activities','automation_workflows','automation_runs'
  ] loop
    execute format('create policy %I on public.%I for select using (public.is_org_member(organisation_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (public.can_write(organisation_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.can_write(organisation_id)) with check (public.can_write(organisation_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.can_approve(organisation_id))', t || '_delete', t);
  end loop;
end $$;

-- Read-only to members; written by the server (service role) only
do $$
declare t text;
begin
  foreach t in array array['deployment_records','email_events','jobs','api_usage','unsubscribe_tokens'] loop
    execute format('create policy %I on public.%I for select using (public.is_org_member(organisation_id))', t || '_select', t);
  end loop;
end $$;

-- Approvals: read by members; inserted only through decide_approval / by approvers as themselves
create policy approvals_select on public.approvals for select using (public.is_org_member(organisation_id));
create policy approvals_insert on public.approvals for insert with check (public.can_approve(organisation_id) and decided_by = auth.uid());

-- Compliance rules: global defaults readable by all signed-in users, org overrides by members
create policy compliance_select on public.compliance_rules for select using (organisation_id is null or public.is_org_member(organisation_id));
create policy compliance_write on public.compliance_rules for all using (organisation_id is not null and public.can_approve(organisation_id))
  with check (organisation_id is not null and public.can_approve(organisation_id));

-- Integrations: admins see status/config; secrets never leave the server
create policy integrations_select on public.integration_connections for select using (public.is_org_member(organisation_id));

-- Audit log: members read; members append as themselves
create policy audit_select on public.audit_logs for select using (public.is_org_member(organisation_id));
create policy audit_insert on public.audit_logs for insert with check (public.is_org_member(organisation_id) and actor_id = auth.uid());

-- Column privilege: clients can never read encrypted secrets.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke select on public.integration_connections from authenticated, anon';
    execute 'grant select (id, organisation_id, provider, status, config, last_checked_at, last_error, created_at, updated_at) on public.integration_connections to authenticated';
    execute 'revoke insert, update, delete on public.integration_connections from authenticated, anon';
    execute 'revoke all on public.unsubscribe_tokens from anon';
  end if;
end $$;

grant execute on function public.decide_approval(public.approval_subject, uuid, public.approval_decision, text) to authenticated;
grant execute on function public.create_organisation(text) to authenticated;
