-- Job queue claiming, default compliance rules and per-organisation starter data.

-- Claim up to p_limit due jobs. Jobs belonging to a paused or cancelled run are skipped,
-- which is how pausing a workflow stops work without losing it.
create or replace function public.claim_jobs(p_worker text, p_limit int default 5)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then
    raise exception 'claim_jobs is for the worker only';
  end if;

  -- Recover jobs whose worker died mid-run.
  update public.jobs set status = 'queued', locked_at = null, locked_by = null,
    last_error = coalesce(last_error, '') || ' [lock expired]'
  where status = 'running' and locked_at < now() - interval '15 minutes';

  return query
  update public.jobs j set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
  where j.id in (
    select q.id from public.jobs q
    left join public.automation_runs r on r.id = q.run_id
    where q.status = 'queued' and q.run_at <= now()
      and (r.id is null or r.status = 'running')
    order by q.run_at
    for update of q skip locked
    limit p_limit
  )
  returning j.*;
end $$;

revoke execute on function public.claim_jobs(text, int) from public;

-- Default rules. These are configurable starting points, not legal advice.
-- outcome values: allowed_with_opt_out | consent_required | review_required
insert into public.compliance_rules (organisation_id, country_code, rule) values
(null, 'GB', '{
  "country": "United Kingdom", "regime": "UK GDPR + PECR",
  "corporate_subscriber": "allowed_with_opt_out",
  "individual_subscriber": "consent_required",
  "unknown_subscriber": "review_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "legitimate_interests",
  "notes": "PECR reg. 22 allows unsolicited marketing email to corporate subscribers (limited companies, LLPs, public bodies) if the sender is identified and an opt-out is given. Sole traders and some partnerships are individual subscribers and need prior consent. Use a role address where possible; a named employee address is still personal data under UK GDPR, so record a legitimate interests assessment.",
  "references": ["https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/"]
}'),
(null, 'IE', '{
  "country": "Ireland", "regime": "GDPR + S.I. 336/2011",
  "corporate_subscriber": "allowed_with_opt_out", "individual_subscriber": "consent_required", "unknown_subscriber": "review_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "legitimate_interests",
  "notes": "Marketing email to non-individual subscribers is permitted with identification and opt-out; individuals need consent."
}'),
(null, 'FR', '{
  "country": "France", "regime": "GDPR + CPCE L34-5",
  "corporate_subscriber": "allowed_with_opt_out", "individual_subscriber": "consent_required", "unknown_subscriber": "review_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "legitimate_interests",
  "notes": "CNIL accepts B2B prospecting without prior consent when the message relates to the recipient''s professional activity and an opt-out is offered."
}'),
(null, 'NL', '{
  "country": "Netherlands", "regime": "GDPR + Telecommunicatiewet 11.7",
  "corporate_subscriber": "allowed_with_opt_out", "individual_subscriber": "consent_required", "unknown_subscriber": "review_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "legitimate_interests",
  "notes": "Legal entities may be emailed with an opt-out; sole proprietors (eenmanszaak) are treated as individuals."
}'),
(null, 'DE', '{
  "country": "Germany", "regime": "GDPR + UWG §7",
  "corporate_subscriber": "consent_required", "individual_subscriber": "consent_required", "unknown_subscriber": "consent_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "consent",
  "notes": "UWG §7(2) Nr. 2 treats unsolicited advertising email as unreasonable nuisance without prior express consent, including B2B."
}'),
(null, 'ES', '{
  "country": "Spain", "regime": "GDPR + LSSI art. 21",
  "corporate_subscriber": "consent_required", "individual_subscriber": "consent_required", "unknown_subscriber": "consent_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "consent",
  "notes": "LSSI requires prior consent for commercial email regardless of recipient type, except existing customer relationships."
}'),
(null, 'IT', '{
  "country": "Italy", "regime": "GDPR + Codice Privacy art. 130",
  "corporate_subscriber": "consent_required", "individual_subscriber": "consent_required", "unknown_subscriber": "consent_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "consent",
  "notes": "Garante requires prior consent for automated marketing communications, including to businesses."
}'),
(null, 'US', '{
  "country": "United States", "regime": "CAN-SPAM Act",
  "corporate_subscriber": "allowed_with_opt_out", "individual_subscriber": "allowed_with_opt_out", "unknown_subscriber": "allowed_with_opt_out",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "not_applicable",
  "notes": "Requires accurate headers, a non-deceptive subject, identification as an advertisement, a valid physical postal address and an opt-out honoured within 10 business days. Check state laws too."
}'),
(null, 'CA', '{
  "country": "Canada", "regime": "CASL",
  "corporate_subscriber": "review_required", "individual_subscriber": "review_required", "unknown_subscriber": "review_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "implied_consent_conspicuous_publication",
  "notes": "CASL needs express or implied consent. Implied consent can arise when the address is conspicuously published, not accompanied by a no-solicitation statement, and the message is relevant to the recipient''s business role. Confirm and record these facts before approving."
}'),
(null, 'AU', '{
  "country": "Australia", "regime": "Spam Act 2003",
  "corporate_subscriber": "review_required", "individual_subscriber": "review_required", "unknown_subscriber": "review_required",
  "requires_sender_identity": true, "requires_postal_address": false, "requires_unsubscribe": true,
  "lawful_basis": "inferred_consent_conspicuous_publication",
  "notes": "Consent may be inferred from conspicuous publication when the message relates to the recipient''s business and the address is not published with a statement refusing commercial messages."
}'),
(null, 'NZ', '{
  "country": "New Zealand", "regime": "Unsolicited Electronic Messages Act 2007",
  "corporate_subscriber": "review_required", "individual_subscriber": "review_required", "unknown_subscriber": "review_required",
  "requires_sender_identity": true, "requires_postal_address": false, "requires_unsubscribe": true,
  "lawful_basis": "deemed_consent_conspicuous_publication",
  "notes": "Deemed consent can apply to conspicuously published business addresses when the message is relevant to that business."
}'),
(null, '*', '{
  "country": "Default (all other countries)", "regime": "Unconfigured jurisdiction",
  "corporate_subscriber": "review_required", "individual_subscriber": "consent_required", "unknown_subscriber": "review_required",
  "requires_sender_identity": true, "requires_postal_address": true, "requires_unsubscribe": true,
  "lawful_basis": "unknown",
  "notes": "No rule configured for this country. Add one in Settings before sending, or confirm the legal position manually."
}');

-- Starter templates and integration placeholders for a new organisation.
create or replace function public.seed_organisation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.email_templates (organisation_id, name, purpose, subject, body) values
  (new.id, 'Concept introduction', 'initial',
   'A website concept for {{business_name}}',
   E'Hello {{greeting_name}},\n\n{{observation}}\n\n{{reason}}\n\nWe put together an independent concept to show what that could look like:\n{{concept_url}}\n\n{{improvements}}\n\nIf it is useful, I would be glad to talk it through. A short reply is all it takes.\n\n{{signature}}'),
  (new.id, 'Gentle follow-up', 'follow_up',
   'Re: A website concept for {{business_name}}',
   E'Hello {{greeting_name}},\n\nI wanted to check whether you had a chance to look at the concept we prepared for {{business_name}}:\n{{concept_url}}\n\nNo pressure at all. If now is not the right time, just let me know.\n\n{{signature}}');
  return new;
end $$;

create trigger organisations_seed after insert on public.organisations
  for each row execute function public.seed_organisation();
