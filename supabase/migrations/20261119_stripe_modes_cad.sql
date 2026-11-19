-- Apply after 20261119_stripe_modes.sql with app/payment processing stopped.
-- No amount conversion, mode activation or balance reset. USD history stays USD.
begin;
alter table public.forma_credit_orders drop constraint forma_credit_orders_price_currency_check;
alter table public.forma_credit_orders add constraint forma_credit_orders_price_currency_check check(price_currency in ('usd','cad'));

create function public.forma_reserve_credit_order_cad(p_owner uuid,p_id uuid,p_price text,p_origin text,p_expiry bigint,p_live boolean)
returns setof public.forma_credit_orders language plpgsql security definer set search_path=public as $$
declare purchase forma_credit_orders;
begin
 perform forma_assert_billing_mode(p_live);
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into purchase from forma_credit_orders where owner_id=p_owner and state='pending' for update;
 if found then
  if purchase.stripe_livemode<>p_live then raise exception 'Package mode mismatch'; end if;
 else
  insert into forma_credit_orders(id,owner_id,price_id,price_amount,price_currency,checkout_origin,checkout_expires_at)
  values(p_id,p_owner,p_price,549,'cad',p_origin,p_expiry) returning * into purchase;
 end if;
 return next purchase;
end;$$;
revoke all on function public.forma_reserve_credit_order_cad(uuid,uuid,text,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.forma_reserve_credit_order_cad(uuid,uuid,text,text,bigint,boolean) to service_role;
revoke execute on function public.forma_reserve_credit_order_mode(uuid,uuid,text,text,bigint,boolean) from service_role;

create or replace function public.forma_reserve_checkout_mode(p_id uuid,p_owner uuid,p_key uuid,p_price text,p_amount bigint,p_currency text,p_origin text,p_expiry bigint,p_live boolean)
returns setof public.forma_portraits language plpgsql security definer set search_path=public as $$
begin
 perform forma_assert_billing_mode(p_live);
 if p_amount is distinct from 399 or p_currency is distinct from 'cad' then raise exception 'New checkout requires CAD 399'; end if;
 if exists(select 1 from forma_portraits where id=p_id and checkout_key is not null and stripe_livemode<>p_live) then raise exception 'Checkout mode mismatch'; end if;
 return query select * from forma_reserve_checkout(p_id,p_owner,p_key,p_price,p_amount,p_currency,p_origin,p_expiry);
end;$$;
commit;
