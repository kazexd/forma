-- Apply AFTER package options and all previous migrations, with generation paused.
-- Historical attempts remain unchanged; only newly accepted requests are eligible.
begin;
alter table public.forma_generation_requests add column restoration_eligible boolean not null default false;
alter table public.forma_generation_requests alter column restoration_eligible set default true;
alter table public.forma_generation_requests add column restored_at timestamptz;
alter table public.forma_generation_requests add constraint forma_generation_restoration_check
 check(restored_at is null or (restoration_eligible and status='failed'));
create function public.forma_finish_generation_restoring(p_owner uuid,p_id uuid,p_uncertain boolean)
returns text language plpgsql security definer set search_path=public as $$
declare job forma_generation_requests;
begin
 if p_uncertain is null then raise exception 'Generation outcome is required'; end if;
 -- Match billing -> global -> account -> request lock ordering. Publication also locks global first.
 perform 1 from forma_billing_control where id=true for share;
 perform 1 from forma_generation_control where id=true for update;
 perform 1 from forma_generation_allowance where owner_id=p_owner for update;
 select * into job from forma_generation_requests where id=p_id and owner_id=p_owner for update;
 if not found then return 'not_found'; end if;
 -- Success remains charged even after portrait deletion. Never infer failure from a missing photo alone.
 if job.status='succeeded' or job.portrait_id is not null or exists(select 1 from forma_portraits where id=p_id) then return 'succeeded'; end if;
 if job.status='failed' then
  return case when job.restored_at is not null then 'failed_restored' else 'failed_historical' end;
 end if;
 if p_uncertain then
  update forma_generation_requests set status='uncertain',finished_at=coalesce(finished_at,now()) where id=p_id;
  return 'uncertain';
 end if;
 -- Only the backend/operator may confirm terminal failure; expiry alone is not proof.
 if job.restoration_eligible then
  update forma_generation_allowance set remaining=remaining+1 where owner_id=p_owner;
  if not found then raise exception 'Generation allowance missing'; end if;
  update forma_generation_requests set status='failed',finished_at=now(),restored_at=now() where id=p_id;
 else
  update forma_generation_requests set status='failed',finished_at=now() where id=p_id;
 end if;
 update forma_generation_control set active_request=null,lease_until=null where id=true and active_request=p_id;
 return case when job.restoration_eligible then 'failed_restored' else 'failed_historical' end;
end;$$;
revoke all on function public.forma_finish_generation_restoring(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.forma_finish_generation_restoring(uuid,uuid,boolean) to service_role;
revoke execute on function public.forma_finish_generation(uuid,uuid,boolean) from service_role;
commit;
