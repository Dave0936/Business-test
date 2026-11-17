-- Phase 8: email outreach.

-- Staff create a draft's unsubscribe link together with the draft (row-level security applies).
create policy unsubscribe_tokens_insert on public.unsubscribe_tokens
  for insert with check (public.can_write(organisation_id));

-- Who sent an email (the sending service writes it; the person who clicked Send).
alter table public.email_drafts add column sent_by uuid references public.users (id) on delete set null;

-- What the public unsubscribe page may show: the sender and a masked address, never the address itself.
create or replace function public.unsubscribe_token_info(p_token text)
returns table (agency_name text, masked_email text, already_done boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(o.agency_name, ''), o.name),
         left(split_part(t.email, '@', 1), 1) || '•••@' || split_part(t.email, '@', 2),
         t.used_at is not null
  from public.unsubscribe_tokens t
  join public.organisations o on o.id = t.organisation_id
  where t.token = p_token and length(p_token) >= 32
$$;

-- One-step unsubscribe for anyone holding the link: suppress the address, cancel unsent emails
-- to it and record the opt-out. Safe to repeat. Returns false for an unknown token.
create or replace function public.unsubscribe_with_token(p_token text, p_source text default 'unsubscribe_link')
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  t public.unsubscribe_tokens;
begin
  if length(coalesce(p_token, '')) < 32 then return false; end if;
  select * into t from public.unsubscribe_tokens where token = p_token for update;
  if t.token is null then return false; end if;

  insert into public.suppression_lists (organisation_id, email, reason, source)
  values (t.organisation_id, lower(t.email), 'unsubscribed', left(coalesce(p_source, 'unsubscribe_link'), 40))
  on conflict do nothing;

  if t.used_at is null then
    update public.unsubscribe_tokens set used_at = now() where token = p_token;

    update public.email_drafts set status = 'cancelled', last_error = 'Recipient unsubscribed'
    where organisation_id = t.organisation_id and lower(to_email) = lower(t.email)
      and status in ('draft', 'review', 'awaiting_approval', 'approved', 'blocked', 'failed');

    update public.businesses set status = 'suppressed'
    where organisation_id = t.organisation_id and lower(email) = lower(t.email);

    insert into public.crm_activities (organisation_id, business_id, type, summary, data)
    select t.organisation_id, b.id, 'unsubscribed', 'Unsubscribed using the link in our email', jsonb_build_object('source', p_source)
    from public.businesses b where b.organisation_id = t.organisation_id and lower(b.email) = lower(t.email);

    insert into public.audit_logs (organisation_id, actor_type, action, entity_type, data)
    values (t.organisation_id, 'system', 'email.unsubscribed', 'suppression', jsonb_build_object('source', p_source, 'draft_id', t.draft_id));
  end if;
  return true;
end $$;

revoke all on function public.unsubscribe_token_info(text) from public;
revoke all on function public.unsubscribe_with_token(text, text) from public;
grant execute on function public.unsubscribe_token_info(text) to anon, authenticated;
grant execute on function public.unsubscribe_with_token(text, text) to anon, authenticated;
