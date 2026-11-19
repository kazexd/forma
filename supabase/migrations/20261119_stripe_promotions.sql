-- Apply after all mode/CAD/preserve-credit migrations with app/payment processing stopped.
-- Existing reservations retain their creation parameters for Stripe idempotency.
begin;
alter table public.forma_portraits add column promotions_enabled boolean not null default false;
alter table public.forma_credit_orders add column promotions_enabled boolean not null default false;
alter table public.forma_credit_orders alter column promotions_enabled set default true;
create function public.forma_checkout_promotion_flag()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.checkout_key is null and new.checkout_key is not null then new.promotions_enabled=true;
 elsif new.checkout_key is null then new.promotions_enabled=false; end if;
 return new;
end;$$;
revoke all on function public.forma_checkout_promotion_flag() from public,anon,authenticated,service_role;
create trigger forma_checkout_promotion_flag before update on public.forma_portraits for each row execute function public.forma_checkout_promotion_flag();

create table public.forma_checkout_receipts(
 checkout_session_id text primary key,
 owner_id uuid not null references auth.users(id),
 kind text not null check(kind in ('portrait','credit_package')),
 target_id uuid not null,
 price_id text not null,
 currency text not null,
 subtotal bigint not null check(subtotal>0),
 discount bigint not null check(discount>=0 and discount<=subtotal),
 tax bigint not null check(tax>=0),
 inclusive_tax bigint not null check(inclusive_tax>=0 and inclusive_tax<=tax),
 total bigint not null check(total>=0 and total=subtotal-discount+tax-inclusive_tax),
 payment_status text not null check(payment_status in ('paid','no_payment_required')),
 discount_refs jsonb not null check(jsonb_typeof(discount_refs)='array'),
 livemode boolean not null,
 created_at timestamptz not null default now(),
 unique(kind,target_id)
);
alter table public.forma_checkout_receipts enable row level security;
revoke all on public.forma_checkout_receipts from public,anon,authenticated,service_role;
grant select on public.forma_checkout_receipts to service_role;

-- The backend passes a receipt verified from Stripe's expanded, retrieved Session.
-- This private helper independently checks arithmetic and keeps the audit immutable.
create function public.forma_record_checkout_receipt(p_owner uuid,p_kind text,p_target uuid,p_session text,p_live boolean,p_enabled boolean,p_receipt jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare receipt forma_checkout_receipts;s bigint;d bigint;t bigint;i bigint;n bigint;refs jsonb;status text;
begin
 if p_receipt is null or not(p_receipt ?& array['price_id','currency','subtotal','discount','tax','inclusive_tax','total','payment_status','discount_refs']) then raise exception 'Incomplete checkout receipt'; end if;
 s=(p_receipt->>'subtotal')::bigint;d=(p_receipt->>'discount')::bigint;t=(p_receipt->>'tax')::bigint;i=(p_receipt->>'inclusive_tax')::bigint;n=(p_receipt->>'total')::bigint;refs=p_receipt->'discount_refs';status=p_receipt->>'payment_status';
 if p_session is null or p_session not like 'cs_%' or length(p_session)>255 or p_live is null or s is null or d is null or t is null or i is null or n is null or s<=0 or d<0 or d>s or t<0 or i<0 or i>t or n<0 or n<>s-d+t-i or jsonb_typeof(refs) is distinct from 'array' then raise exception 'Invalid checkout receipt'; end if;
 if jsonb_array_length(refs)>20 or exists(select 1 from jsonb_array_elements(refs) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>300) then raise exception 'Invalid discount references'; end if;
 if d>0 and (not p_enabled or jsonb_array_length(refs)=0) then raise exception 'Unverified discount'; end if;
 if status is null or status not in ('paid','no_payment_required') then raise exception 'Unsettled payment'; end if;
 if n=0 then
  if d<>s or t<>0 or jsonb_array_length(refs)=0 or not p_enabled then raise exception 'Zero total requires full verified discount'; end if;
 elsif status<>'paid' then raise exception 'Payment required'; end if;
 insert into forma_checkout_receipts(checkout_session_id,owner_id,kind,target_id,price_id,currency,subtotal,discount,tax,inclusive_tax,total,payment_status,discount_refs,livemode)
 values(p_session,p_owner,p_kind,p_target,p_receipt->>'price_id',p_receipt->>'currency',s,d,t,i,n,status,refs,p_live)
 on conflict(checkout_session_id) do nothing;
 select * into receipt from forma_checkout_receipts where checkout_session_id=p_session;
 if receipt.owner_id is distinct from p_owner or receipt.kind is distinct from p_kind or receipt.target_id is distinct from p_target or receipt.price_id is distinct from p_receipt->>'price_id' or receipt.currency is distinct from p_receipt->>'currency' or receipt.subtotal<>s or receipt.discount<>d or receipt.tax<>t or receipt.inclusive_tax<>i or receipt.total<>n or receipt.payment_status is distinct from status or receipt.discount_refs is distinct from refs or receipt.livemode is distinct from p_live then raise exception 'Checkout receipt replay mismatch'; end if;
end;$$;
revoke all on function public.forma_record_checkout_receipt(uuid,text,uuid,text,boolean,boolean,jsonb) from public,anon,authenticated,service_role;

create function public.forma_complete_purchase_discounted(p_id uuid,p_owner uuid,p_key uuid,p_session text,p_live boolean,p_receipt jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare portrait forma_portraits;
begin
 perform forma_assert_billing_mode(p_live);
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into portrait from forma_portraits where id=p_id and owner_id=p_owner for update;
 if not found or portrait.payment_state='deleting' then return false; end if;
 if portrait.price_amount is distinct from (p_receipt->>'subtotal')::bigint or portrait.price_currency is distinct from p_receipt->>'currency' or portrait.price_id is distinct from p_receipt->>'price_id' then raise exception 'Purchase receipt mismatch'; end if;
 if not forma_complete_purchase_mode(p_id,p_owner,p_key,p_session,portrait.price_amount,portrait.price_currency,p_live) then return false; end if;
 perform forma_record_checkout_receipt(p_owner,'portrait',p_id,p_session,p_live,portrait.promotions_enabled,p_receipt);
 return true;
end;$$;
create function public.forma_complete_credit_order_discounted(p_owner uuid,p_id uuid,p_session text,p_live boolean,p_receipt jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare purchase forma_credit_orders;
begin
 perform forma_assert_billing_mode(p_live);
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into purchase from forma_credit_orders where id=p_id and owner_id=p_owner for update;
 if not found then return false; end if;
 if purchase.price_amount is distinct from (p_receipt->>'subtotal')::bigint or purchase.price_currency is distinct from p_receipt->>'currency' or purchase.price_id is distinct from p_receipt->>'price_id' then raise exception 'Package receipt mismatch'; end if;
 if not forma_complete_credit_order_mode(p_owner,p_id,p_session,purchase.price_amount,purchase.price_currency,p_live) then return false; end if;
 perform forma_record_checkout_receipt(p_owner,'credit_package',p_id,p_session,p_live,purchase.promotions_enabled,p_receipt);
 return true;
end;$$;
revoke all on function public.forma_complete_purchase_discounted(uuid,uuid,uuid,text,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.forma_complete_credit_order_discounted(uuid,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.forma_complete_purchase_discounted(uuid,uuid,uuid,text,boolean,jsonb) to service_role;
grant execute on function public.forma_complete_credit_order_discounted(uuid,uuid,text,boolean,jsonb) to service_role;
revoke execute on function public.forma_complete_purchase_mode(uuid,uuid,uuid,text,bigint,text,boolean) from service_role;
revoke execute on function public.forma_complete_credit_order_mode(uuid,uuid,text,bigint,text,boolean) from service_role;
commit;
