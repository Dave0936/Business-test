-- Phase 6: approval centre.
-- A website approval now records exactly which version was reviewed and the reviewer's
-- checklist. Approving needs every checklist item confirmed; rejecting or requesting
-- changes needs a reason. Approvals are written only by decide_approval().

alter table public.approvals
  add column version_id uuid,          -- the website version that was reviewed (no FK: approvals are append-only)
  add column checklist jsonb;          -- {"item_key": true, ...} as confirmed by the reviewer

-- The checklist a reviewer must confirm before approving a website.
create or replace function public.website_review_items() returns text[]
language sql immutable set search_path = public as $$
  select array['facts_checked', 'no_invented_claims', 'concept_notice', 'images_ok', 'pages_checked']
$$;

-- Only decide_approval() (security definer) records decisions.
drop policy if exists approvals_insert on public.approvals;

drop function if exists public.decide_approval(public.approval_subject, uuid, public.approval_decision, text);

create or replace function public.decide_approval(
  p_subject_type public.approval_subject,
  p_subject_id uuid,
  p_decision public.approval_decision,
  p_comment text default null,
  p_version uuid default null,
  p_checklist jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_hash text;
  v_status text;
  v_business uuid;
  v_version uuid;
  v_approval uuid;
  v_missing text[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_subject_type = 'website' then
    select w.organisation_id, v.content_hash, w.status::text, w.business_id, w.current_version_id
      into v_org, v_hash, v_status, v_business, v_version
    from public.generated_websites w
    join public.website_versions v on v.id = w.current_version_id
    where w.id = p_subject_id
    for update of w;
    if v_org is null then raise exception 'website not found'; end if;
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

  if p_decision <> 'approved' and length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception 'give a reason when rejecting or requesting changes';
  end if;

  if p_subject_type = 'website' then
    if v_status <> 'awaiting_approval' then
      raise exception 'website is %, not awaiting approval', v_status;
    end if;
    -- The reviewer must have been looking at the current version.
    if p_version is not null and p_version <> v_version then
      raise exception 'a newer version of this website has been saved; review that version instead';
    end if;
    if p_decision = 'approved' then
      if p_version is null then
        raise exception 'say which version you reviewed';
      end if;
      select array_agg(k) into v_missing
      from unnest(public.website_review_items()) k
      where coalesce((p_checklist ->> k)::boolean, false) = false;
      if v_missing is not null then
        raise exception 'confirm every review checklist item before approving (missing: %)', array_to_string(v_missing, ', ');
      end if;
    end if;
  else
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

  insert into public.approvals (organisation_id, subject_type, subject_id, content_hash, decision, comment, decided_by, version_id, checklist)
  values (v_org, p_subject_type, p_subject_id, v_hash, p_decision, nullif(trim(coalesce(p_comment, '')), ''), auth.uid(),
          case when p_subject_type = 'website' then v_version end, p_checklist)
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
          initcap(p_subject_type::text) || ' ' || replace(p_decision::text, '_', ' ')
            || coalesce(': ' || nullif(trim(coalesce(p_comment, '')), ''), ''),
          jsonb_build_object('approval_id', v_approval, 'comment', p_comment, 'version_id', v_version), auth.uid());

  insert into public.audit_logs (organisation_id, actor_id, action, entity_type, entity_id, data)
  values (v_org, auth.uid(), 'approval.' || p_decision, p_subject_type::text, p_subject_id,
          jsonb_build_object('approval_id', v_approval, 'content_hash', v_hash, 'comment', p_comment,
                             'version_id', v_version, 'checklist', p_checklist));

  return v_approval;
end $$;

revoke all on function public.decide_approval(public.approval_subject, uuid, public.approval_decision, text, uuid, jsonb) from public, anon;
grant execute on function public.decide_approval(public.approval_subject, uuid, public.approval_decision, text, uuid, jsonb) to authenticated;
grant execute on function public.website_review_items() to authenticated;
