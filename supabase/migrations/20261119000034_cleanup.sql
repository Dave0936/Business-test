-- Tidying up: delete a prototype, a business's design work, single audits, and older history.
-- Owners and administrators only (row-level security already limits DELETE on these tables to
-- them). Nothing that is online, being built or being sent can be deleted.

-- Delete a prototype with all its versions, checks and builds.
create or replace function public.delete_website(p_website uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  w public.generated_websites;
begin
  select * into w from public.generated_websites where id = p_website for update;
  if w.id is null or not public.is_org_member(w.organisation_id) then return false; end if;
  if not public.can_approve(w.organisation_id) then
    raise exception 'only owners or administrators can delete prototypes';
  end if;
  if exists (select 1 from public.deployment_records d where d.website_id = p_website and d.status in ('verified', 'succeeded', 'uploading')) then
    raise exception 'it is online: take it offline first (Deployments)';
  end if;
  if exists (select 1 from public.site_builds s where s.website_id = p_website and s.status in ('queued', 'running')) then
    raise exception 'a build is running: stop it first';
  end if;
  if exists (select 1 from public.email_drafts e where e.website_id = p_website and e.status = 'sending') then
    raise exception 'an email about it is being sent right now';
  end if;
  update public.email_drafts set status = 'cancelled', last_error = 'Its prototype was deleted'
    where website_id = p_website and status in ('draft', 'review', 'awaiting_approval', 'approved', 'blocked', 'failed');
  -- Deployment history points at versions with ON DELETE RESTRICT: remove it first.
  delete from public.deployment_records where website_id = p_website;
  delete from public.generated_websites where id = p_website;
  update public.businesses set status = 'qualified'
    where id = w.business_id and status in ('prototype_generated', 'awaiting_deployment_approval')
      and not exists (select 1 from public.generated_websites g where g.business_id = w.business_id);
  insert into public.crm_activities (organisation_id, business_id, type, summary, actor_id)
  values (w.organisation_id, w.business_id, 'note', 'Prototype deleted', auth.uid());
  insert into public.audit_logs (organisation_id, actor_id, action, entity_type, entity_id, data)
  values (w.organisation_id, auth.uid(), 'website.deleted', 'website', p_website, jsonb_build_object('business_id', w.business_id, 'slug', w.slug));
  return true;
end $$;

-- Delete a business's design work: briefs, the studio (creative brief, picks, questions) and
-- its own references. Sector-wide references and AI photos are kept. Returns the storage
-- paths of uploaded pictures so the caller can remove the files.
create or replace function public.delete_design_work(p_business uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  b public.businesses;
  paths text[];
begin
  select * into b from public.businesses where id = p_business;
  if b.id is null or not public.is_org_member(b.organisation_id) then return null; end if;
  if not public.can_approve(b.organisation_id) then
    raise exception 'only owners or administrators can delete design work';
  end if;
  if exists (select 1 from public.site_builds s where s.business_id = p_business and s.status in ('queued', 'running')) then
    raise exception 'a build is running for this business: stop it first';
  end if;
  select coalesce(array_agg(storage_path), '{}') into paths from public.design_references
    where business_id = p_business and organisation_id = b.organisation_id and storage_path is not null;
  delete from public.design_briefs where business_id = p_business and organisation_id = b.organisation_id;
  delete from public.design_references where business_id = p_business and organisation_id = b.organisation_id;
  delete from public.design_studios where business_id = p_business and organisation_id = b.organisation_id;
  insert into public.audit_logs (organisation_id, actor_id, action, entity_type, entity_id, data)
  values (b.organisation_id, auth.uid(), 'design.deleted', 'business', p_business, jsonb_build_object('files', coalesce(array_length(paths, 1), 0)));
  return paths;
end $$;

-- Remove older audits or design briefs, keeping the latest for each business.
create or replace function public.prune_history(p_org uuid, p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.can_approve(p_org) then
    raise exception 'only owners or administrators can remove history';
  end if;
  if p_kind = 'audits' then
    delete from public.website_audits a where a.organisation_id = p_org and exists (
      select 1 from public.website_audits l where l.business_id = a.business_id and l.organisation_id = p_org
        and (l.created_at, l.id) > (a.created_at, a.id));
  elsif p_kind = 'briefs' then
    delete from public.design_briefs a where a.organisation_id = p_org
      and not exists (select 1 from public.generated_websites g where g.brief_id = a.id)
      and exists (
        select 1 from public.design_briefs l where l.business_id = a.business_id and l.organisation_id = p_org
          and (l.created_at, l.id) > (a.created_at, a.id));
  else
    raise exception 'unknown kind %', p_kind;
  end if;
  get diagnostics n = row_count;
  insert into public.audit_logs (organisation_id, actor_id, action, entity_type, data)
  values (p_org, auth.uid(), 'history.pruned', p_kind, jsonb_build_object('removed', n));
  return n;
end $$;

revoke all on function public.delete_website(uuid) from public, anon;
revoke all on function public.delete_design_work(uuid) from public, anon;
revoke all on function public.prune_history(uuid, text) from public, anon;
grant execute on function public.delete_website(uuid) to authenticated;
grant execute on function public.delete_design_work(uuid) to authenticated;
grant execute on function public.prune_history(uuid, text) to authenticated;
