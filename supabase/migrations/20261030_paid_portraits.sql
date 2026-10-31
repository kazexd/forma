-- Run once in the Supabase SQL editor. All sensitive access is server-only.
create table public.forma_portraits (
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 style text not null check (style in ('formal','casual','natural')),
 original_path text not null unique,
 preview_path text not null unique,
 payment_state text not null default 'unpaid' check(payment_state in ('unpaid','paid','deleting')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 paid_at timestamptz,
 checkout_key uuid,
 checkout_session_id text unique,
 checkout_origin text,
 checkout_expires_at bigint,
 price_id text,
 price_amount bigint,
 price_currency text
);
alter table public.forma_portraits enable row level security;
revoke all on public.forma_portraits from anon, authenticated;
grant all on public.forma_portraits to service_role;

create table public.forma_generation_usage (
 owner_id uuid not null references auth.users(id),
 usage_day date not null,
 attempts integer not null default 0,
 primary key(owner_id,usage_day)
);
alter table public.forma_generation_usage enable row level security;
revoke all on public.forma_generation_usage from anon, authenticated;
grant all on public.forma_generation_usage to service_role;

create function public.forma_reserve_generation(p_owner uuid,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare updated integer;
begin
 if p_limit<1 then return false; end if;
 insert into forma_generation_usage(owner_id,usage_day,attempts)
 values(p_owner,(now() at time zone 'UTC')::date,1)
 on conflict(owner_id,usage_day) do update set attempts=forma_generation_usage.attempts+1
 where forma_generation_usage.attempts<p_limit returning attempts into updated;
 return updated is not null;
end;$$;
revoke all on function public.forma_reserve_generation(uuid,integer) from public,anon,authenticated;
grant execute on function public.forma_reserve_generation(uuid,integer) to service_role;

create function public.forma_reserve_checkout(p_id uuid,p_owner uuid,p_key uuid,p_price text,p_amount bigint,p_currency text,p_origin text,p_expiry bigint)
returns setof public.forma_portraits language plpgsql security definer set search_path=public as $$
declare portrait forma_portraits;
begin
 select * into portrait from forma_portraits where id=p_id and owner_id=p_owner for update;
 if not found or portrait.payment_state<>'unpaid' or portrait.expires_at<=now()+interval '1 hour' then return; end if;
 if portrait.checkout_key is null then
  update forma_portraits set checkout_key=p_key,price_id=p_price,price_amount=p_amount,price_currency=p_currency,checkout_origin=p_origin,checkout_expires_at=p_expiry
  where id=p_id returning * into portrait;
 end if;
 return next portrait;
end;$$;
revoke all on function public.forma_reserve_checkout(uuid,uuid,uuid,text,bigint,text,text,bigint) from public,anon,authenticated;
grant execute on function public.forma_reserve_checkout(uuid,uuid,uuid,text,bigint,text,text,bigint) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('forma-portraits','forma-portraits',false,20971520,array['image/jpeg'])
on conflict(id) do update set public=false;
-- Explicitly block browser roles, even if another bucket has permissive global policies.
create policy forma_no_browser_access on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'forma-portraits') with check(bucket_id<>'forma-portraits');
