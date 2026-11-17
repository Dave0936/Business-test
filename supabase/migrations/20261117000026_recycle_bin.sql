-- Phase 9: recycle bin for leads, and permanent deletion (erasure).
--
-- A binned lead is hidden everywhere by row-level security. The bin page asks to see binned
-- leads by sending the request header "x-include-binned: 1" (visibility only: the organisation
-- check still applies). After 30 days the retention sweep deletes binned leads permanently.

alter table public.businesses
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.users (id) on delete set null;
create index businesses_binned_idx on public.businesses (organisation_id, deleted_at) where deleted_at is not null;

create or replace function public.include_binned() returns boolean
language sql stable set search_path = public as $$
  select coalesce((nullif(current_setting('request.headers', true), '')::json ->> 'x-include-binned') = '1', false)
$$;

drop policy if exists businesses_select on public.businesses;
create policy businesses_select on public.businesses for select
  using (public.is_org_member(organisation_id) and (deleted_at is null or public.include_binned()));

-- Move a lead to the bin, or back. Staff and above. (A plain UPDATE can't hide the row it
-- changes under row-level security, so these run as definer with an explicit role check.)
create or replace function public.bin_business(p_business uuid, p_restore boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where id = p_business for update;
  if b.id is null or not public.is_org_member(b.organisation_id) then return false; end if;
  if not public.can_write(b.organisation_id) then
    raise exception 'your role cannot move leads to the recycle bin';
  end if;
  if not p_restore then
    if b.deleted_at is not null then return true; end if;
    if exists (select 1 from public.deployment_records d where d.business_id = p_business and d.status in ('verified', 'succeeded', 'uploading')) then
      raise exception 'its concept is online: take it offline first (Deployments)';
    end if;
    if exists (select 1 from public.email_drafts e where e.business_id = p_business and e.status = 'sending') then
      raise exception 'an email to this business is being sent right now';
    end if;
    update public.businesses set deleted_at = now(), deleted_by = auth.uid() where id = p_business;
    -- Nothing unsent goes out for a binned lead.
    update public.email_drafts set status = 'cancelled', last_error = 'Lead moved to the recycle bin'
      where business_id = p_business and status in ('draft', 'review', 'awaiting_approval', 'approved', 'blocked', 'failed');
    update public.jobs set status = 'cancelled', last_error = 'Lead moved to the recycle bin'
      where organisation_id = b.organisation_id and status = 'queued' and payload ->> 'businessId' = p_business::text;
  else
    if b.deleted_at is null then return true; end if;
    update public.businesses set deleted_at = null, deleted_by = null where id = p_business;
  end if;
  insert into public.crm_activities (organisation_id, business_id, type, summary, actor_id)
  values (b.organisation_id, p_business, case when p_restore then 'restored' else 'binned' end,
          case when p_restore then 'Restored from the recycle bin' else 'Moved to the recycle bin' end, auth.uid());
  insert into public.audit_logs (organisation_id, actor_id, action, entity_type, entity_id, data)
  values (b.organisation_id, auth.uid(), case when p_restore then 'lead.restored' else 'lead.binned' end, 'business', p_business, '{}'::jsonb);
  return true;
end $$;

-- Delete a binned lead and everything about it. Owners and administrators, or the retention sweep.
create or replace function public.purge_business(p_business uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  b public.businesses;
begin
  select * into b from public.businesses where id = p_business for update;
  if b.id is null then return false; end if;
  if not public.is_service() and not public.can_approve(b.organisation_id) then
    raise exception 'only owners or administrators can delete leads permanently';
  end if;
  if b.deleted_at is null then
    raise exception 'move the lead to the recycle bin first';
  end if;
  if exists (select 1 from public.deployment_records d where d.business_id = p_business and d.status in ('verified', 'succeeded', 'uploading')) then
    raise exception 'its concept is still online: take it offline first';
  end if;
  -- Deployment history points at versions with ON DELETE RESTRICT: remove it first.
  delete from public.deployment_records where business_id = p_business;
  delete from public.businesses where id = p_business;
  insert into public.audit_logs (organisation_id, actor_id, actor_type, action, entity_type, entity_id, data)
  values (b.organisation_id, auth.uid(), case when public.is_service() then 'system' else 'user' end,
          'lead.purged', 'business', p_business, jsonb_build_object('binned_at', b.deleted_at));
  return true;
end $$;

revoke all on function public.purge_business(uuid) from public, anon;
grant execute on function public.purge_business(uuid) to authenticated, service_role;
revoke all on function public.bin_business(uuid, boolean) from public, anon;
grant execute on function public.bin_business(uuid, boolean) to authenticated;
revoke all on function public.include_binned() from public, anon;
grant execute on function public.include_binned() to authenticated, service_role;
