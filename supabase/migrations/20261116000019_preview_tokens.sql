-- Signed preview links. Prototype previews run in a sandboxed iframe with an opaque origin, so
-- browsers do not send the sign-in cookie for the page's stylesheet, script, fonts or images.
-- A member who can read a version gets a short-lived signature (sign_preview, checked by RLS
-- rules); the preview route then reads that version's files with the signature alone
-- (preview_files). The signing key never leaves the database.

set search_path = public, extensions;

create schema if not exists private;
revoke all on schema private from public;
create table if not exists private.settings (key text primary key, value text not null);
revoke all on private.settings from public;

insert into private.settings (key, value)
values ('preview_hmac_key', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public.sign_preview(p_version uuid)
returns text
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_exp bigint := extract(epoch from now() + interval '2 hours')::bigint;
  v_key text;
begin
  if not exists (select 1 from public.website_versions v where v.id = p_version and public.is_org_member(v.organisation_id)) then
    raise exception 'not allowed';
  end if;
  select value into v_key from private.settings where key = 'preview_hmac_key';
  return v_exp::text || '.' || encode(hmac(p_version::text || ':' || v_exp::text, v_key, 'sha256'), 'hex');
end $$;

create or replace function public.preview_files(p_version uuid, p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_exp bigint;
  v_sig text;
  v_key text;
  v_files jsonb;
begin
  if p_token !~ '^[0-9]{10}\.[0-9a-f]{64}$' then return null; end if;
  v_exp := split_part(p_token, '.', 1)::bigint;
  v_sig := split_part(p_token, '.', 2);
  if v_exp < extract(epoch from now())::bigint then return null; end if;
  select value into v_key from private.settings where key = 'preview_hmac_key';
  if encode(hmac(p_version::text || ':' || v_exp::text, v_key, 'sha256'), 'hex') <> v_sig then return null; end if;
  select files into v_files from public.website_versions where id = p_version;
  return v_files;
end $$;

revoke all on function public.sign_preview(uuid) from public, anon, authenticated;
revoke all on function public.preview_files(uuid, text) from public, anon, authenticated;
grant execute on function public.sign_preview(uuid) to authenticated;
grant execute on function public.preview_files(uuid, text) to anon, authenticated;
