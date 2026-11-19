-- PREPARATION ONLY. This migration leaves billing in TEST mode and does not reset balances.
-- Apply after 20261118_purchase_credits.sql with operations stopped and matching app ready.
begin;
create table public.forma_billing_control(
 id boolean primary key default true check(id),
 mode text not null default 'test' check(mode in ('test','live')),
 activated_at timestamptz,
 reset_generations integer
);
insert into public.forma_billing_control(id) values(true);
alter table public.forma_billing_control enable row level security;
revoke all on public.forma_billing_control from public,anon,authenticated,service_role;
grant select on public.forma_billing_control to service_role;
create policy forma_billing_backend_select on public.forma_billing_control for select to service_role using(true);
alter table public.forma_portraits add column stripe_livemode boolean not null default false;
alter table public.forma_credit_orders add column stripe_livemode boolean not null default false;

create function public.forma_assert_billing_mode(p_live boolean)
returns void language plpgsql security definer set search_path=public as $$
declare current_mode text;
begin
 select mode into current_mode from forma_billing_control where id=true for share;
 if p_live is null or current_mode is null or (current_mode='live')<>p_live then raise exception 'Billing mode mismatch'; end if;
end;$$;
revoke all on function public.forma_assert_billing_mode(boolean) from public,anon,authenticated,service_role;

-- Stamping runs inside the same transaction as reservation/unlock.
create function public.forma_stamp_payment_mode()
returns trigger language plpgsql security definer set search_path=public as $$
declare live boolean;
begin
 select mode='live' into live from forma_billing_control where id=true;
 if tg_table_name='forma_credit_orders' then
  if tg_op='INSERT' then new.stripe_livemode=live; end if;
 else
  if (old.checkout_key is null and new.checkout_key is not null) or
     (old.payment_state<>'paid' and new.payment_state='paid' and new.unlock_source='credit') then new.stripe_livemode=live; end if;
 end if;
 return new;
end;$$;
revoke all on function public.forma_stamp_payment_mode() from public,anon,authenticated,service_role;
create trigger forma_credit_order_mode before insert on public.forma_credit_orders for each row execute function public.forma_stamp_payment_mode();
create trigger forma_portrait_payment_mode before update on public.forma_portraits for each row execute function public.forma_stamp_payment_mode();

create function public.forma_reserve_checkout_mode(p_id uuid,p_owner uuid,p_key uuid,p_price text,p_amount bigint,p_currency text,p_origin text,p_expiry bigint,p_live boolean)
returns setof public.forma_portraits language plpgsql security definer set search_path=public as $$
begin
 perform forma_assert_billing_mode(p_live);
 if exists(select 1 from forma_portraits where id=p_id and checkout_key is not null and stripe_livemode<>p_live) then raise exception 'Checkout mode mismatch'; end if;
 return query select * from forma_reserve_checkout(p_id,p_owner,p_key,p_price,p_amount,p_currency,p_origin,p_expiry);
end;$$;
create function public.forma_reserve_credit_order_mode(p_owner uuid,p_id uuid,p_price text,p_origin text,p_expiry bigint,p_live boolean)
returns setof public.forma_credit_orders language plpgsql security definer set search_path=public as $$
begin
 perform forma_assert_billing_mode(p_live);
 if exists(select 1 from forma_credit_orders where owner_id=p_owner and state='pending' and stripe_livemode<>p_live) then raise exception 'Package mode mismatch'; end if;
 return query select * from forma_reserve_credit_order(p_owner,p_id,p_price,p_origin,p_expiry);
end;$$;
create function public.forma_complete_purchase_mode(p_id uuid,p_owner uuid,p_key uuid,p_session text,p_amount bigint,p_currency text,p_live boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform forma_assert_billing_mode(p_live);
 if exists(select 1 from forma_portraits where id=p_id and stripe_livemode<>p_live) then raise exception 'Purchase mode mismatch'; end if;
 return forma_complete_purchase(p_id,p_owner,p_key,p_session,p_amount,p_currency);
end;$$;
create function public.forma_complete_credit_order_mode(p_owner uuid,p_id uuid,p_session text,p_amount bigint,p_currency text,p_live boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform forma_assert_billing_mode(p_live);
 if exists(select 1 from forma_credit_orders where id=p_id and stripe_livemode<>p_live) then raise exception 'Package mode mismatch'; end if;
 return forma_complete_credit_order(p_owner,p_id,p_session,p_amount,p_currency);
end;$$;
create function public.forma_unlock_portrait_mode(p_owner uuid,p_id uuid,p_key uuid,p_session text,p_live boolean)
returns text language plpgsql security definer set search_path=public as $$
begin
 perform forma_assert_billing_mode(p_live);
 return forma_unlock_portrait(p_owner,p_id,p_key,p_session);
end;$$;
create function public.forma_begin_generation_mode(p_owner uuid,p_id uuid,p_style text,p_fingerprint text,p_token_hash text,p_live boolean)
returns text language plpgsql security definer set search_path=public as $$
begin
 perform forma_assert_billing_mode(p_live);
 return forma_begin_generation(p_owner,p_id,p_style,p_fingerprint,p_token_hash);
end;$$;
-- Retire old mutation entrypoints for the service role, without deleting history.
revoke execute on function public.forma_reserve_checkout(uuid,uuid,uuid,text,bigint,text,text,bigint) from service_role;
revoke execute on function public.forma_reserve_credit_order(uuid,uuid,text,text,bigint) from service_role;
revoke execute on function public.forma_complete_purchase(uuid,uuid,uuid,text,bigint,text) from service_role;
revoke execute on function public.forma_complete_credit_order(uuid,uuid,text,bigint,text) from service_role;
revoke execute on function public.forma_unlock_portrait(uuid,uuid,uuid,text) from service_role;
revoke execute on function public.forma_begin_generation(uuid,uuid,text,text,text) from service_role;

revoke all on function public.forma_reserve_checkout_mode(uuid,uuid,uuid,text,bigint,text,text,bigint,boolean) from public,anon,authenticated;
revoke all on function public.forma_reserve_credit_order_mode(uuid,uuid,text,text,bigint,boolean) from public,anon,authenticated;
revoke all on function public.forma_complete_purchase_mode(uuid,uuid,uuid,text,bigint,text,boolean) from public,anon,authenticated;
revoke all on function public.forma_complete_credit_order_mode(uuid,uuid,text,bigint,text,boolean) from public,anon,authenticated;
revoke all on function public.forma_unlock_portrait_mode(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.forma_begin_generation_mode(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.forma_reserve_checkout_mode(uuid,uuid,uuid,text,bigint,text,text,bigint,boolean) to service_role;
grant execute on function public.forma_reserve_credit_order_mode(uuid,uuid,text,text,bigint,boolean) to service_role;
grant execute on function public.forma_complete_purchase_mode(uuid,uuid,uuid,text,bigint,text,boolean) to service_role;
grant execute on function public.forma_complete_credit_order_mode(uuid,uuid,text,bigint,text,boolean) to service_role;
grant execute on function public.forma_unlock_portrait_mode(uuid,uuid,uuid,text,boolean) to service_role;
grant execute on function public.forma_begin_generation_mode(uuid,uuid,text,text,text,boolean) to service_role;

-- Operator-only, one-way, once-only activation. DO NOT CALL as part of migration/deploy.
create function public.forma_activate_live(p_confirmation text)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_mode text;
begin
 if p_confirmation is distinct from 'RESET EXISTING ACCOUNTS TO 2 GENERATIONS AND 0 UNLOCKS' then raise exception 'Explicit activation confirmation required'; end if;
 select mode into current_mode from forma_billing_control where id=true for update;
 if current_mode='live' then return false; end if;
 if current_mode is distinct from 'test' then raise exception 'Billing mode unavailable'; end if;
 -- All current mutation wrappers lock billing control before other records.
 lock table forma_generation_allowance,forma_portraits,forma_credit_orders in access exclusive mode;
 if exists(select 1 from forma_generation_control where active_request is not null and lease_until>now()) then raise exception 'Generation must be drained before activation'; end if;
 insert into forma_generation_allowance(owner_id) select id from auth.users on conflict do nothing;
 update forma_generation_allowance set remaining=2,unlocks=0;
 update forma_credit_orders set state='expired' where state='pending';
 update forma_portraits set checkout_key=null,checkout_session_id=null,checkout_origin=null,checkout_expires_at=null,price_id=null,price_amount=null,price_currency=null where payment_state='unpaid';
 update forma_billing_control set mode='live',activated_at=now(),reset_generations=2 where id=true;
 return true;
end;$$;
revoke all on function public.forma_activate_live(text) from public,anon,authenticated,service_role;
commit;
