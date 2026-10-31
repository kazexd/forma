-- Apply after 20261031_purchase_generation_allowance.sql, with old app/cleanup stopped.
begin;
alter table public.forma_portraits alter column expires_at drop not null;
update public.forma_portraits set expires_at=null;
-- Old deleting rows came from expiry cleanup, not explicit user deletion. Preserve them.
update public.forma_portraits set payment_state=case when paid_at is null then 'unpaid' else 'paid' end where payment_state='deleting';
create index forma_gallery_owner_created on public.forma_portraits(owner_id,created_at desc,id desc);

create or replace function public.forma_reserve_checkout(p_id uuid,p_owner uuid,p_key uuid,p_price text,p_amount bigint,p_currency text,p_origin text,p_expiry bigint)
returns setof public.forma_portraits language plpgsql security definer set search_path=public as $$
declare portrait forma_portraits;
begin
 select * into portrait from forma_portraits where id=p_id and owner_id=p_owner for update;
 if not found or portrait.payment_state<>'unpaid' then return; end if;
 if portrait.checkout_key is null then
  update forma_portraits set checkout_key=p_key,price_id=p_price,price_amount=p_amount,price_currency=p_currency,checkout_origin=p_origin,checkout_expires_at=p_expiry where id=p_id returning * into portrait;
 end if;
 return next portrait;
end;$$;

-- Compare the exact snapshot verified against Stripe; concurrent checkout/payment wins safely.
create function public.forma_claim_portrait_delete(p_id uuid,p_owner uuid,p_state text,p_key uuid,p_session text)
returns boolean language plpgsql security definer set search_path=public as $$
declare portrait forma_portraits;
begin
 select * into portrait from forma_portraits where id=p_id and owner_id=p_owner for update;
 if not found then return false; end if;
 if portrait.payment_state='deleting' then return true; end if;
 if portrait.payment_state is distinct from p_state or portrait.checkout_key is distinct from p_key or portrait.checkout_session_id is distinct from p_session then return false; end if;
 update forma_portraits set payment_state='deleting' where id=p_id;
 return true;
end;$$;
revoke all on function public.forma_claim_portrait_delete(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.forma_claim_portrait_delete(uuid,uuid,text,uuid,text) to service_role;
commit;
