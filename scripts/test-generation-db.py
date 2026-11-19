"""Run only against a fresh disposable Postgres container with POSTGRES_DB=forma_test.
Usage: python scripts/test-generation-db.py <container-name>
"""
import runpy, uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
context=runpy.run_path('scripts/test-allowance-db.py')
sql=context['sql'];owner=context['owner'];portrait=context['portrait'];key=context['key'];get=context['get']
sql('alter table storage.objects add column metadata jsonb;')
sql(Path('supabase/migrations/20261118_generation_protection.sql').read_text())

def new_id():return str(uuid.uuid4())
def begin(user,request,token=None,fingerprint='a'*64,style='casual'):
 token_arg='null' if token is None else "'"+token+"'"
 return f"select forma_begin_generation('{user}','{request}','{style}','{fingerprint}',{token_arg});"
def finish(user,request,uncertain=False):return f"select forma_finish_generation('{user}','{request}',{'true' if uncertain else 'false'});"
def reset():
 sql("update forma_generation_control set paused=false,daily_limit=20,storage_limit_bytes=536870912,active_request=null,lease_until=null;delete from forma_generation_daily;update forma_generation_allowance set remaining=3;")
reset()
# Three account attempts; replay and conflicts never debit twice.
first=new_id();assert sql(begin(owner,first,'b'*64))=='accepted';assert sql(begin(owner,first,'b'*64))=='running';assert sql(begin(owner,first,fingerprint='c'*64))=='request_conflict';assert sql(get)=='2'
sql(finish(owner,first));assert sql(begin(owner,first))=='failed';assert sql(begin(owner,new_id(),'b'*64))=='verification_reused';assert sql(get)=='2'
for _ in range(2):
 req=new_id();assert sql(begin(owner,req))=='accepted';sql(finish(owner,req))
assert sql(begin(owner,new_id()))=='allowance_exhausted'
assert sql('select attempts from forma_generation_daily;')=='3'
# Account rate limits are durable and do not affect generation allowance.
for _ in range(6):assert sql(f"select forma_generation_rate_allowed('{owner}');")=='t'
assert sql(f"select forma_generation_rate_allowed('{owner}');")=='f'
sql(f"update forma_generation_rate set window_start=now()-interval '2 minutes' where owner_id='{owner}';")
assert sql(f"select forma_generation_rate_allowed('{owner}');")=='t'
# Every instance/account shares the same single-flight lock.
users=[new_id() for _ in range(8)]
for user in users:sql(f"insert into auth.users values('{user}');")
reset();requests=[new_id() for _ in users]
with ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(lambda pair:sql(begin(*pair)),zip(users,requests)))
assert results.count('accepted')==1 and results.count('busy')==7,results
winner=results.index('accepted');sql(finish(users[winner],requests[winner]))
# Simultaneous identical IDs are accepted once; separate token replays are rejected.
reset();req=new_id()
with ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(lambda _:sql(begin(owner,req,'d'*64)),range(8)))
assert results.count('accepted')==1 and results.count('running')==7,results
assert sql(get)=='2';assert sql('select attempts from forma_generation_daily;')=='1'
sql(finish(owner,req))
reset();ids=[new_id(),new_id()]
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda request:sql(begin(owner,request,'e'*64)),ids))
assert sorted(results)==['accepted','verification_reused'],results
sql(finish(owner,ids[results.index('accepted')]))
# Site limits survive purchases, UTC days partition counters, and quota failures roll back.
reset();sql("update forma_generation_control set daily_limit=2;")
for _ in range(2):
 req=new_id();assert sql(begin(owner,req))=='accepted';sql(finish(owner,req))
sql(f"update forma_portraits set payment_state='unpaid',checkout_key='{key}',checkout_session_id='session',price_amount=100,price_currency='usd' where id='{portrait}';")
sql(context['pay']);assert sql(get)=='3';assert sql(begin(owner,new_id()))=='daily_limit'
sql("update forma_generation_daily set usage_day=current_date-1;")
req=new_id();assert sql(begin(owner,req))=='accepted';sql(finish(owner,req))
# Storage guard, emergency pause, and token/owner isolation.
reset();sql("update forma_generation_control set storage_limit_bytes=22020097;insert into storage.objects(bucket_id,metadata) values('forma-portraits','{\"size\":2}');")
assert sql(begin(owner,new_id()))=='storage_limit';assert sql(get)=='3'
sql("delete from storage.objects;update forma_generation_control set paused=true;")
assert sql(begin(owner,new_id()))=='paused';assert sql(get)=='3'
# Uncertain attempts hold a lease and are never submitted again after expiration.
reset();req=new_id();assert sql(begin(owner,req))=='accepted';sql(finish(owner,req,True));assert sql(begin(owner,new_id()))=='busy'
sql("update forma_generation_control set lease_until=now()-interval '1 second';")
other=new_id();assert sql(begin(owner,other))=='accepted';assert sql(begin(owner,req))=='uncertain';assert sql(begin(users[0],req))=='request_conflict'
sql(finish(owner,other))
# Publishing atomically persists ownership + marks success, and is safely idempotent.
reset();req=new_id();assert sql(begin(owner,req))=='accepted'
publish=f"select forma_publish_generation('{owner}','{req}','{owner}/{req}/original.jpg','{owner}/{req}/preview.jpg');"
sql("create function test_publish_fail() returns trigger language plpgsql as $$begin if new.status='succeeded' then raise exception 'publish failure';end if;return new;end;$$;create trigger test_publish before update on forma_generation_requests for each row execute function test_publish_fail();")
sql(publish,fail=True);assert sql(f"select count(*) from forma_portraits where id='{req}';")=='0';assert sql(f"select status from forma_generation_requests where id='{req}';")=='running'
sql('drop trigger test_publish on forma_generation_requests;drop function test_publish_fail();')
sql(publish);sql(publish);assert sql(f"select status from forma_generation_requests where id='{req}';")=='succeeded';assert sql(get)=='2'
sql(f"delete from forma_portraits where id='{req}';")
assert sql(f"select portrait_id is null from forma_generation_requests where id='{req}';")=='t';assert sql(begin(owner,req))=='succeeded'
sql('set role authenticated;'+begin(owner,new_id()),fail=True)
sql('set role anon;select * from forma_generation_requests;',fail=True)
print('PASS: global concurrency, 20/day controls, payment independence, atomic debits, CAPTCHA replay protection, request replay, storage guard, lease recovery, publish rollback and RLS')
