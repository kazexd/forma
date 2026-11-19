-- Apply after 20261119_stripe_modes_cad.sql.
-- This only replaces the operator function. It does NOT activate Live or alter balances.
begin;
create or replace function public.forma_activate_live(p_confirmation text)
returns boolean language plpgsql security definer set search_path=public as $$
declare current_mode text;
begin
 if p_confirmation is distinct from 'ACTIVATE LIVE AND PRESERVE EXISTING CREDITS' then raise exception 'Explicit preserve-credits activation confirmation required'; end if;
 select mode into current_mode from forma_billing_control where id=true for update;
 if current_mode='live' then return false; end if;
 if current_mode is distinct from 'test' then raise exception 'Billing mode unavailable'; end if;
 -- Same billing-control-before-records lock order as mutation wrappers.
 lock table forma_generation_allowance,forma_portraits,forma_credit_orders in access exclusive mode;
 if exists(select 1 from forma_generation_control where active_request is not null and lease_until>now()) then raise exception 'Generation must be drained before activation'; end if;
 -- Do not insert, reset or update allowance rows. Existing credits are a gift.
 -- Accounts without a balance still receive the normal 3/0 on first use.
 update forma_credit_orders set state='expired' where state='pending' and stripe_livemode=false;
 update forma_portraits set checkout_key=null,checkout_session_id=null,checkout_origin=null,checkout_expires_at=null,price_id=null,price_amount=null,price_currency=null where payment_state='unpaid' and stripe_livemode=false;
 update forma_billing_control set mode='live',activated_at=now(),reset_generations=null where id=true;
 return true;
end;$$;
revoke all on function public.forma_activate_live(text) from public,anon,authenticated,service_role;
commit;
