"""Full chain and exactly-once generation restoration. Disposable Postgres only."""
import runpy,uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ctx=runpy.run_path('scripts/test-package-options-db.py');sql=ctx['sql'];owner=ctx['owner'];uid=lambda:str(uuid.uuid4())
# Fixture controls only, never hosted production.
sql("update forma_generation_control set paused=false,daily_limit=1000,storage_limit_bytes=1073741824,active_request=null,lease_until=null;delete from forma_generation_daily;delete from storage.objects;")
sql(f"update forma_generation_allowance set remaining=10,unlocks=5 where owner_id='{owner}';")
balance=lambda:sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")
begin=lambda id:f"select forma_begin_generation_mode('{owner}','{id}','casual',repeat('a',64),null,true);"
finish=lambda id,uncertain=False:f"select forma_finish_generation_restoring('{owner}','{id}',{'true' if uncertain else 'false'});"
publish=lambda id:f"select forma_publish_generation('{owner}','{id}','{owner}/{id}/original','{owner}/{id}/preview');"
legacy=uid();assert sql(begin(legacy))=='accepted';assert balance()=='9,5'
sql(Path('supabase/migrations/20261119_restore_failed_generation.sql').read_text(encoding='utf-8'))
assert balance()=='9,5';assert sql(f"select restoration_eligible from forma_generation_requests where id='{legacy}';")=='f'
assert sql(finish(legacy))=='failed_historical';assert balance()=='9,5'
# Duplicate and concurrent failure resolution restores exactly one debit.
new=uid();assert sql(begin(new))=='accepted';assert balance()=='8,5'
with ThreadPoolExecutor(max_workers=8) as pool:assert all(v=='failed_restored' for v in pool.map(lambda _:sql('set role service_role;'+finish(new)),range(8)))
assert balance()=='9,5';assert sql(f"select status||','||(restored_at is not null) from forma_generation_requests where id='{new}';")=='failed,true'
assert sql(begin(new))=='failed';assert balance()=='9,5';sql(publish(new),fail=True)
# Restoration and payment remain additive under the same account lock.
request=uid();assert sql(begin(request))=='accepted';order=uid();sql(ctx['reserve'](order,'starter'))
with ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(sql,[finish(request),ctx['pay'](order,'starter')]))
assert balance()=='12,6'
# A failed restoration transaction changes neither request status nor allowance.
request=uid();assert sql(begin(request))=='accepted'
sql("create function restoration_fail() returns trigger language plpgsql as $$begin if new.remaining>old.remaining then raise exception 'forced restore rollback';end if;return new;end;$$;create trigger restoration_fail before update on forma_generation_allowance for each row execute function restoration_fail();")
sql(finish(request),fail=True);assert balance()=='11,6';assert sql(f"select status||','||(restored_at is null) from forma_generation_requests where id='{request}';")=='running,true'
sql('drop trigger restoration_fail on forma_generation_allowance;drop function restoration_fail();')
assert sql(finish(request))=='failed_restored';assert balance()=='12,6'
# A lease expiring is never sufficient to restore; late success remains charged.
uncertain=uid();assert sql(begin(uncertain))=='accepted';assert sql(finish(uncertain,True))=='uncertain';assert balance()=='11,6'
sql("update forma_generation_control set lease_until=now()-interval '1 second';")
other=uid();assert sql(begin(other))=='accepted';assert balance()=='10,6';assert sql(finish(other))=='failed_restored';assert balance()=='11,6'
assert sql(f"select restored_at is null from forma_generation_requests where id='{uncertain}';")=='t'
sql(publish(uncertain));assert sql(finish(uncertain))=='succeeded';assert balance()=='11,6'
sql(f"delete from forma_portraits where id='{uncertain}';");assert sql(finish(uncertain))=='succeeded';assert balance()=='11,6'
# Operator-confirmed terminal non-delivery can resolve an uncertain attempt once.
uncertain=uid();assert sql(begin(uncertain))=='accepted';assert sql(finish(uncertain,True))=='uncertain';assert sql(finish(uncertain))=='failed_restored';assert sql(finish(uncertain))=='failed_restored';assert balance()=='11,6'
# Publication/failure racing must result in either charged success OR restored failure.
for _ in range(6):
 request=uid();before=int(balance().split(',')[0]);assert sql(begin(request))=='accepted'
 safe_publish=f"do $$begin perform forma_publish_generation('{owner}','{request}','{owner}/{request}/original','{owner}/{request}/preview');exception when others then if sqlerrm<>'Generation request cannot be published' then raise;end if;end;$$;"
 with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(sql,[safe_publish,finish(request)]))
 status=sql(f"select status from forma_generation_requests where id='{request}';")
 assert status in ['failed','succeeded']
 assert int(balance().split(',')[0])==before-(1 if status=='succeeded' else 0)
 assert sql(f"select count(*) from forma_portraits where id='{request}';")==('1' if status=='succeeded' else '0')
# Private permissions and ownership: another account cannot restore this request.
other=uid();sql(f"insert into auth.users values('{other}');")
assert sql(f"select forma_finish_generation_restoring('{other}','{request}',false);")=='not_found'
for role in ['anon','authenticated']:sql('set role '+role+';'+finish(request),fail=True)
sql(f"set role service_role;select forma_finish_generation('{owner}','{request}',false);",fail=True)
assert int(sql('select attempts from forma_generation_daily where usage_day=current_date;'))>0
print('PASS: prospective restoration, paid/free shared credits, duplicate/race idempotency, rollback, uncertain leases, late success/deletion protection, purchase serialization and owner-only restoration')
