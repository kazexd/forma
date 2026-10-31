-- Stop the app while applying this migration and deploying the matching code.
begin;
create table public.forma_generation_allowance (
 owner_id uuid primary key references auth.users(id),
 remaining integer not null default 3 check (remaining between 0 and 3)
);
alter table public.forma_generation_allowance enable row level security;
revoke all on public.forma_generation_allowance from public,anon,authenticated;
grant all on public.forma_generation_allowance to service_role;
-- Existing accounts start fresh; historical payments and attempts are not replayed.
insert into public.forma_generation_allowance(owner_id) select id from auth.users;

create function public.forma_get_generation_allowance(p_owner uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare available integer;
begin
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 select remaining into available from forma_generation_allowance where owner_id=p_owner;
 return available;
end;$$;

create function public.forma_consume_generation(p_owner uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare available integer;
begin
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 select remaining into available from forma_generation_allowance where owner_id=p_owner for update;
 if available<=0 then return false; end if;
 update forma_generation_allowance set remaining=remaining-1 where owner_id=p_owner;
 return true;
end;$$;

create function public.forma_complete_purchase(p_id uuid,p_owner uuid,p_key uuid,p_session text,p_amount bigint,p_currency text)
returns boolean language plpgsql security definer set search_path=public as $$
declare portrait forma_portraits;
begin
 -- Always lock the account before the portrait, shared with generation consumption.
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into portrait from forma_portraits where id=p_id and owner_id=p_owner for update;
 if not found or portrait.payment_state='deleting' then return false; end if;
 if portrait.checkout_key is distinct from p_key or (portrait.checkout_session_id is not null and portrait.checkout_session_id is distinct from p_session) or portrait.price_amount is distinct from p_amount or portrait.price_currency is distinct from p_currency then
  raise exception 'Purchase does not match recorded checkout';
 end if;
 -- Historical and repeated paid events never restore allowance again.
 if portrait.payment_state='paid' then return true; end if;
 update forma_portraits set payment_state='paid',paid_at=now(),checkout_session_id=p_session where id=p_id;
 update forma_generation_allowance set remaining=3 where owner_id=p_owner;
 return true;
end;$$;
revoke all on function public.forma_get_generation_allowance(uuid) from public,anon,authenticated;
revoke all on function public.forma_consume_generation(uuid) from public,anon,authenticated;
revoke all on function public.forma_complete_purchase(uuid,uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.forma_get_generation_allowance(uuid) to service_role;
grant execute on function public.forma_consume_generation(uuid) to service_role;
grant execute on function public.forma_complete_purchase(uuid,uuid,uuid,text,bigint,text) to service_role;
-- Retire the old entrypoint without deleting historical daily usage records.
drop function public.forma_reserve_generation(uuid,integer);
commit;
