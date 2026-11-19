-- Apply after the three portrait/gallery migrations. Keep generation disabled during rollout.
begin;
create table public.forma_generation_control (
 id boolean primary key default true check(id),
 paused boolean not null default false,
 daily_limit integer not null default 20 check(daily_limit between 1 and 1000),
 storage_limit_bytes bigint not null default 536870912 check(storage_limit_bytes>22020096),
 active_request uuid,
 lease_until timestamptz
);
insert into public.forma_generation_control(id) values(true);
create table public.forma_generation_daily (
 usage_day date primary key,
 attempts integer not null default 0 check(attempts>=0)
);
create table public.forma_generation_requests (
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 style text not null check(style in ('formal','casual','natural')),
 fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
 token_hash text unique check(token_hash ~ '^[0-9a-f]{64}$'),
 status text not null default 'running' check(status in ('running','succeeded','failed','uncertain')),
 portrait_id uuid references public.forma_portraits(id) on delete set null,
 created_at timestamptz not null default now(),
 lease_until timestamptz not null,
 finished_at timestamptz
);
create index forma_generation_requests_owner on public.forma_generation_requests(owner_id,created_at desc);
create table public.forma_generation_rate (
 owner_id uuid primary key references auth.users(id),
 window_start timestamptz not null,
 requests integer not null
);
alter table public.forma_generation_control enable row level security;
alter table public.forma_generation_daily enable row level security;
alter table public.forma_generation_requests enable row level security;
alter table public.forma_generation_rate enable row level security;
revoke all on public.forma_generation_control,public.forma_generation_daily,public.forma_generation_requests,public.forma_generation_rate from public,anon,authenticated;
grant all on public.forma_generation_control,public.forma_generation_daily,public.forma_generation_requests,public.forma_generation_rate to service_role;

create function public.forma_generation_rate_allowed(p_owner uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare used integer; stamp timestamptz:=date_trunc('minute',now());
begin
 insert into forma_generation_rate(owner_id,window_start,requests) values(p_owner,stamp,1)
 on conflict(owner_id) do update set
  window_start=stamp,
  requests=case when forma_generation_rate.window_start=stamp then forma_generation_rate.requests+1 else 1 end
 where forma_generation_rate.window_start<>stamp or forma_generation_rate.requests<6
 returning requests into used;
 return used is not null;
end;$$;

create function public.forma_begin_generation(p_owner uuid,p_id uuid,p_style text,p_fingerprint text,p_token_hash text)
returns text language plpgsql security definer set search_path=public as $$
declare settings forma_generation_control; job forma_generation_requests; used integer; available integer; stored_bytes bigint; unresolved bigint;
begin
 -- Lock order: global control, account allowance, request. Purchases lock allowance then portrait.
 select * into settings from forma_generation_control where id=true for update;
 if not found then raise exception 'Generation controls are missing'; end if;
 select * into job from forma_generation_requests where id=p_id;
 if found then
  if job.owner_id<>p_owner or job.style<>p_style or job.fingerprint<>p_fingerprint then return 'request_conflict'; end if;
  return job.status;
 end if;
 if p_token_hash is not null and exists(select 1 from forma_generation_requests where token_hash=p_token_hash) then return 'verification_reused'; end if;
 if settings.paused then return 'paused'; end if;
 if settings.active_request is not null and settings.lease_until>now() then return 'busy'; end if;
 -- A crashed/timed-out request is never run again. It remains inspectable by its owner.
 if settings.active_request is not null then
  update forma_generation_requests set status='uncertain',finished_at=coalesce(finished_at,now()) where id=settings.active_request and status='running';
 end if;
 select attempts into used from forma_generation_daily where usage_day=(now() at time zone 'UTC')::date;
 if coalesce(used,0)>=settings.daily_limit then return 'daily_limit'; end if;
 -- Reserve enough room for the bucket's maximum 20 MiB original plus a 1 MiB preview.
 select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end),0)
 into stored_bytes from storage.objects where bucket_id='forma-portraits';
 select count(*) into unresolved from forma_generation_requests where status in ('running','uncertain') and portrait_id is null;
 if stored_bytes+22020096*(unresolved+1)>settings.storage_limit_bytes then return 'storage_limit'; end if;
 insert into forma_generation_allowance(owner_id) values(p_owner) on conflict do nothing;
 select remaining into available from forma_generation_allowance where owner_id=p_owner for update;
 if available<=0 then return 'allowance_exhausted'; end if;
 insert into forma_generation_requests(id,owner_id,style,fingerprint,token_hash,lease_until)
 values(p_id,p_owner,p_style,p_fingerprint,p_token_hash,now()+interval '15 minutes');
 update forma_generation_allowance set remaining=remaining-1 where owner_id=p_owner;
 insert into forma_generation_daily(usage_day,attempts) values((now() at time zone 'UTC')::date,1)
 on conflict(usage_day) do update set attempts=forma_generation_daily.attempts+1;
 update forma_generation_control set active_request=p_id,lease_until=now()+interval '15 minutes' where id=true;
 return 'accepted';
end;$$;

create function public.forma_finish_generation(p_owner uuid,p_id uuid,p_uncertain boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from forma_generation_control where id=true for update;
 update forma_generation_requests set status=case when p_uncertain then 'uncertain' else 'failed' end,finished_at=now()
 where id=p_id and owner_id=p_owner and status='running';
 if not found then return; end if;
 -- Uncertain upstream calls keep their lease until its original expiry.
 if not p_uncertain then update forma_generation_control set active_request=null,lease_until=null where id=true and active_request=p_id; end if;
end;$$;

create function public.forma_publish_generation(p_owner uuid,p_id uuid,p_original text,p_preview text)
returns void language plpgsql security definer set search_path=public as $$
declare job forma_generation_requests;
begin
 perform 1 from forma_generation_control where id=true for update;
 select * into job from forma_generation_requests where id=p_id and owner_id=p_owner for update;
 if not found then raise exception 'Generation request not found'; end if;
 if job.status='succeeded' then return; end if;
 if job.status not in ('running','uncertain') then raise exception 'Generation request cannot be published'; end if;
 insert into forma_portraits(id,owner_id,style,original_path,preview_path,expires_at)
 values(p_id,p_owner,job.style,p_original,p_preview,null);
 update forma_generation_requests set status='succeeded',portrait_id=p_id,finished_at=now() where id=p_id;
 update forma_generation_control set active_request=null,lease_until=null where id=true and active_request=p_id;
end;$$;

revoke all on function public.forma_generation_rate_allowed(uuid) from public,anon,authenticated;
revoke all on function public.forma_begin_generation(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.forma_finish_generation(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.forma_publish_generation(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.forma_generation_rate_allowed(uuid) to service_role;
grant execute on function public.forma_begin_generation(uuid,uuid,text,text,text) to service_role;
grant execute on function public.forma_finish_generation(uuid,uuid,boolean) to service_role;
grant execute on function public.forma_publish_generation(uuid,uuid,text,text) to service_role;
-- Retire the unguarded entrypoint; historical migrations remain unchanged.
-- Keep the name visible to the previous release's read-only readiness probe,
-- but fail closed if old application code tries to use it during rollout.
create or replace function public.forma_consume_generation(p_owner uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 raise exception 'Use the guarded generation entrypoint';
end;$$;
commit;
