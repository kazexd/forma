-- Pause generation, checkout and payment confirmation while applying and deploying.
-- Existing balances and purchased portraits are preserved; historical payments are not replayed.
begin;
alter table public.forma_generation_allowance drop constraint forma_generation_allowance_remaining_check;
alter table public.forma_generation_allowance add constraint forma_generation_allowance_remaining_check check(remaining>=0);
alter table public.forma_generation_allowance add column unlocks integer not null default 0 check(unlocks>=0);
alter table public.forma_portraits add column unlock_source text check(unlock_source in ('stripe','credit'));
update public.forma_portraits set unlock_source='stripe' where payment_state='paid';

create table public.forma_credit_orders(
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 state text not null default 'pending' check(state in ('pending','paid','expired')),
 price_id text not null,
 price_amount bigint not null check(price_amount=549),
 price_currency text not null check(price_currency='usd'),
 checkout_origin text not null,
 checkout_expires_at bigint not null,
 checkout_session_id text unique,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create unique index forma_credit_order_pending on public.forma_credit_orders(owner_id) where state='pending';
alter table public.forma_credit_orders enable row level security;
revoke all on public.forma_credit_orders from public,anon,authenticated;
grant all on public.forma_credit_orders to service_role;

create function public.forma_get_credits(p_owner uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare balance forma_generation_allowance;
begin
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 select * into balance from forma_generation_allowance where owner_id=p_owner;
 return jsonb_build_object('remaining',balance.remaining,'unlocks',balance.unlocks);
end;$$;

-- Same account-before-portrait lock order as generation. A single-image purchase
-- never changes generation or unlock balances; legacy checkout snapshots remain fulfillable.
create or replace function public.forma_complete_purchase(p_id uuid,p_owner uuid,p_key uuid,p_session text,p_amount bigint,p_currency text)
returns boolean language plpgsql security definer set search_path=public as $$
declare portrait forma_portraits;
begin
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into portrait from forma_portraits where id=p_id and owner_id=p_owner for update;
 if not found or portrait.payment_state='deleting' then return false; end if;
 if portrait.checkout_key is distinct from p_key or (portrait.checkout_session_id is not null and portrait.checkout_session_id is distinct from p_session) or portrait.price_amount is distinct from p_amount or portrait.price_currency is distinct from p_currency then raise exception 'Purchase does not match recorded checkout'; end if;
 if portrait.payment_state='paid' then return true; end if;
 update forma_portraits set payment_state='paid',paid_at=now(),checkout_session_id=p_session,unlock_source='stripe' where id=p_id;
 return true;
end;$$;

create function public.forma_reserve_credit_order(p_owner uuid,p_id uuid,p_price text,p_origin text,p_expiry bigint)
returns setof public.forma_credit_orders language plpgsql security definer set search_path=public as $$
declare purchase forma_credit_orders;
begin
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into purchase from forma_credit_orders where owner_id=p_owner and state='pending' for update;
 if not found then
  insert into forma_credit_orders(id,owner_id,price_id,price_amount,price_currency,checkout_origin,checkout_expires_at)
  values(p_id,p_owner,p_price,549,'usd',p_origin,p_expiry) returning * into purchase;
 end if;
 return next purchase;
end;$$;

create function public.forma_complete_credit_order(p_owner uuid,p_id uuid,p_session text,p_amount bigint,p_currency text)
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
 update forma_generation_allowance set remaining=remaining+5,unlocks=unlocks+2 where owner_id=p_owner;
 return true;
end;$$;

-- Caller must first expire/reconcile any Stripe checkout. Compare that exact
-- snapshot under the row lock, so a concurrent reservation/payment/deletion wins safely.
create function public.forma_unlock_portrait(p_owner uuid,p_id uuid,p_key uuid,p_session text)
returns text language plpgsql security definer set search_path=public as $$
declare portrait forma_portraits;credits integer;
begin
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 select unlocks into credits from forma_generation_allowance where owner_id=p_owner for update;
 select * into portrait from forma_portraits where id=p_id and owner_id=p_owner for update;
 if not found or portrait.payment_state='deleting' then return 'not_found'; end if;
 if portrait.payment_state='paid' then return 'already_unlocked'; end if;
 if portrait.checkout_key is distinct from p_key or portrait.checkout_session_id is distinct from p_session then return 'changed'; end if;
 if credits<=0 then return 'exhausted'; end if;
 update forma_generation_allowance set unlocks=unlocks-1 where owner_id=p_owner;
 update forma_portraits set payment_state='paid',paid_at=now(),unlock_source='credit' where id=p_id;
 return 'unlocked';
end;$$;

revoke all on function public.forma_get_credits(uuid) from public,anon,authenticated;
revoke all on function public.forma_reserve_credit_order(uuid,uuid,text,text,bigint) from public,anon,authenticated;
revoke all on function public.forma_complete_credit_order(uuid,uuid,text,bigint,text) from public,anon,authenticated;
revoke all on function public.forma_unlock_portrait(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.forma_get_credits(uuid) to service_role;
grant execute on function public.forma_reserve_credit_order(uuid,uuid,text,text,bigint) to service_role;
grant execute on function public.forma_complete_credit_order(uuid,uuid,text,bigint,text) to service_role;
grant execute on function public.forma_unlock_portrait(uuid,uuid,uuid,text) to service_role;
commit;
