-- Whether the latest audit found a contact route the business published itself (email on
-- its own site, contact page or phone). Lets the leads list explain a high score that did
-- not qualify. null = not audited yet.
alter table public.businesses add column if not exists contactable boolean;

update public.businesses b
   set contactable = (s.breakdown ->> 'contactable')::boolean
  from (
    select distinct on (business_id) business_id, breakdown
      from public.opportunity_scores
     order by business_id, created_at desc
  ) s
 where s.business_id = b.id and b.contactable is null and s.breakdown ? 'contactable';
