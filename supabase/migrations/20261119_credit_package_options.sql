-- Apply AFTER welcome, promotions and all existing migrations with app/payment processing paused.
-- Existing orders retain their price/mode/discount snapshots and 5+2 package contents.
begin;
alter table public.forma_credit_orders add column package_code text not null default 'plus';
alter table public.forma_credit_orders add column generation_credits integer not null default 5;
alter table public.forma_credit_orders add column unlock_credits integer not null default 2;
alter table public.forma_credit_orders drop constraint forma_credit_orders_price_amount_check;
alter table public.forma_credit_orders add constraint forma_credit_orders_package_check check(
 (package_code='plus' and price_amount=549 and generation_credits=5 and unlock_credits=2)
 or (package_code='starter' and price_amount=449 and price_currency='cad' and generation_credits=3 and unlock_credits=1)
);
drop index public.forma_credit_order_pending;
create unique index forma_credit_order_pending on public.forma_credit_orders(owner_id,package_code) where state='pending';
create function public.forma_reserve_credit_package(p_owner uuid,p_id uuid,p_price text,p_plan text,p_origin text,p_expiry bigint,p_live boolean)
returns setof public.forma_credit_orders language plpgsql security definer set search_path=public as $$
declare purchase forma_credit_orders;amount integer;generations integer;unlocks integer;
begin
 perform forma_assert_billing_mode(p_live);
 if p_plan='starter' then amount=449;generations=3;unlocks=1;
 elsif p_plan='plus' then amount=549;generations=5;unlocks=2;
 else raise exception 'Unknown credit package'; end if;
 if p_price is null or p_price not like 'price_%' then raise exception 'Invalid price identifier'; end if;
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into purchase from forma_credit_orders where owner_id=p_owner and package_code=p_plan and state='pending' for update;
 if found then
  if purchase.stripe_livemode<>p_live then raise exception 'Package mode mismatch'; end if;
 else
  insert into forma_credit_orders(id,owner_id,price_id,price_amount,price_currency,checkout_origin,checkout_expires_at,package_code,generation_credits,unlock_credits)
  values(p_id,p_owner,p_price,amount,'cad',p_origin,p_expiry,p_plan,generations,unlocks) returning * into purchase;
 end if;
 return next purchase;
end;$$;
revoke all on function public.forma_reserve_credit_package(uuid,uuid,text,text,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.forma_reserve_credit_package(uuid,uuid,text,text,text,bigint,boolean) to service_role;
revoke execute on function public.forma_reserve_credit_order_cad(uuid,uuid,text,text,bigint,boolean) from service_role;

create or replace function public.forma_complete_credit_order(p_owner uuid,p_id uuid,p_session text,p_amount bigint,p_currency text)
returns boolean language plpgsql security definer set search_path=public as $$
declare purchase forma_credit_orders;
begin
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into purchase from forma_credit_orders where id=p_id and owner_id=p_owner for update;
 if not found then return false; end if;
 if (purchase.checkout_session_id is not null and purchase.checkout_session_id is distinct from p_session) or purchase.price_amount is distinct from p_amount or purchase.price_currency is distinct from p_currency then raise exception 'Package payment mismatch'; end if;
 if purchase.state='paid' then return true; end if;
 if purchase.state<>'pending' then return false; end if;
 update forma_credit_orders set state='paid',paid_at=now(),checkout_session_id=p_session where id=p_id;
 update forma_generation_allowance set remaining=remaining+purchase.generation_credits,unlocks=unlocks+purchase.unlock_credits where owner_id=p_owner;
 return true;
end;$$;

-- Existing discounted fulfillment wrapper still records the receipt atomically.
commit;
