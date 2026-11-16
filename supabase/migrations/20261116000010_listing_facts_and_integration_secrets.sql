-- Listing facts from providers such as Google Maps (via SerpAPI) or Google Places.
alter table public.businesses add column rating numeric(2,1) check (rating between 0 and 5);
alter table public.businesses add column reviews_count int check (reviews_count >= 0);
alter table public.businesses add column opening_hours jsonb;
alter table public.businesses add column is_chain boolean not null default false;
alter table public.businesses add column listing_url text;

-- Per-organisation integration credentials. The ciphertext is AES-256-GCM, encrypted on the server
-- with APP_ENCRYPTION_KEY, which the database never sees. Clients cannot select the column
-- (migration 2); these functions are the only way in or out.

-- Save or replace a connection (owners and administrators only).
create or replace function public.save_integration(p_org uuid, p_provider text, p_ciphertext text, p_config jsonb, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_approve(p_org) then
    raise exception 'only owners or administrators can manage integrations';
  end if;
  if p_provider !~ '^[a-z_]{2,40}$' or p_status not in ('connected','disconnected','error') then
    raise exception 'invalid integration';
  end if;
  insert into public.integration_connections (organisation_id, provider, status, config, secret_ciphertext, last_checked_at, last_error)
  values (p_org, p_provider, p_status, coalesce(p_config, '{}'::jsonb), p_ciphertext, now(), null)
  on conflict (organisation_id, provider) do update
    set status = excluded.status, config = excluded.config, secret_ciphertext = excluded.secret_ciphertext,
        last_checked_at = now(), last_error = null;
  insert into public.audit_logs (organisation_id, actor_id, action, entity_type, data)
  values (p_org, auth.uid(), 'integration.' || case when p_ciphertext is null then 'disconnected' else 'connected' end, 'integration', jsonb_build_object('provider', p_provider));
end $$;

-- Return the ciphertext for server-side use while running work for the organisation.
-- Only staff and above; the value is useless without the server's encryption key.
create or replace function public.integration_secret(p_org uuid, p_provider text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if not (public.is_service() or public.can_write(p_org)) then
    raise exception 'not allowed';
  end if;
  select secret_ciphertext into v from public.integration_connections
  where organisation_id = p_org and provider = p_provider and status = 'connected';
  return v;
end $$;

revoke execute on function public.save_integration(uuid, text, text, jsonb, text) from public, anon;
revoke execute on function public.integration_secret(uuid, text) from public, anon;
grant execute on function public.save_integration(uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.integration_secret(uuid, text) to authenticated, service_role;
