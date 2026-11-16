-- Where a business email came from. Only addresses the business published itself may be emailed.
alter table public.businesses add column email_source text not null default 'unknown'
  check (email_source in ('business_website','listing','manual','unknown'));

-- Optional inbound domain for reply tracking (replies+<draft id>@domain via Resend inbound).
alter table public.organisations add column inbound_reply_domain text;

-- Private bucket for images staff upload into prototypes. Paths: <organisation_id>/<website_id>/<file>
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('site-assets', 'site-assets', false, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy "site assets read by org members" on storage.objects for select
      using (bucket_id = 'site-assets' and public.is_org_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "site assets written by org staff" on storage.objects for insert
      with check (bucket_id = 'site-assets' and public.can_write(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "site assets deleted by org admins" on storage.objects for delete
      using (bucket_id = 'site-assets' and public.can_approve(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end $$;
