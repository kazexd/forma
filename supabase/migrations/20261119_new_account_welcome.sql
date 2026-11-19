-- Apply before deploying the welcome UI. Existing accounts are not enrolled.
begin;
create table public.forma_account_welcome (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 acknowledged_at timestamptz
);
alter table public.forma_account_welcome enable row level security;
revoke all on public.forma_account_welcome from public,anon,authenticated,service_role;
grant select,update on public.forma_account_welcome to service_role;
create function public.forma_enroll_account_welcome()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into forma_account_welcome(owner_id) values(new.id) on conflict do nothing;
 return new;
end;$$;
revoke all on function public.forma_enroll_account_welcome() from public,anon,authenticated,service_role;
create trigger forma_enroll_account_welcome after insert on auth.users
for each row execute function public.forma_enroll_account_welcome();
commit;
