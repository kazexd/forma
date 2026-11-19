"""Only against a fresh disposable Postgres container with POSTGRES_DB=forma_test."""
import runpy,uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ctx=runpy.run_path('scripts/test-generation-db.py');sql=ctx['sql'];owner=ctx['owner'];get=ctx['get']
uid=lambda:str(uuid.uuid4())
sql(Path('supabase/migrations/20261118_purchase_credits.sql').read_text(encoding='utf-8'))
other=uid();sql(f"insert into auth.users values('{other}');")
assert sql(f"select forma_get_credits('{other}')->>'remaining';")=='3'
assert sql(f"select forma_get_credits('{other}')->>'unlocks';")=='0'
sql(f"update forma_generation_allowance set remaining=0,unlocks=0 where owner_id='{owner}';")
def balance():return sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")
def order():
 o=uid();sql(f"select id from forma_reserve_credit_order('{owner}','{o}','price_package','https://example.com',extract(epoch from now())::bigint+3600);");return o
def pay(o,session='package_session',amount=549):return f"select forma_complete_credit_order('{owner}','{o}','{session}',{amount},'usd');"
def photo(checkout=False):
 p=uid();sql(f"insert into forma_portraits(id,owner_id,style,original_path,preview_path,checkout_key,checkout_session_id,price_amount,price_currency) values('{p}','{owner}','casual','{p}/original','{p}/preview',{'null' if not checkout else chr(39)+ctx['key']+chr(39)},{'null' if not checkout else chr(39)+'portrait_session'+chr(39)},399,'usd');");return p
def unlock(p,user=owner,key='null',session='null'):return f"select forma_unlock_portrait('{user}','{p}',{key},{session});"
# Parallel checkout reservations share a single pending order.
with ThreadPoolExecutor(max_workers=8) as pool:
 reserved=list(pool.map(lambda _:sql(f"select id from forma_reserve_credit_order('{owner}','{uid()}','price_package','https://example.com',extract(epoch from now())::bigint+3600);"),range(8)))
assert len(set(reserved))==1
first=reserved[0];sql(f"update forma_credit_orders set checkout_session_id='package_session' where id='{first}';")
# Wrong owner, amount and session never credit. Payment failure rolls back order AND balances.
sql(pay(first,amount=548),fail=True);sql(pay(first,session='wrong'),fail=True)
assert sql(f"select forma_complete_credit_order('{other}','{first}','package_session',549,'usd');")=='f'
assert balance()=='0,0'
sql("create function test_credit_rollback() returns trigger language plpgsql as $$begin raise exception 'forced rollback';end;$$;create trigger credit_rollback before update on forma_generation_allowance for each row execute function test_credit_rollback();")
sql(pay(first),fail=True);assert sql(f"select state from forma_credit_orders where id='{first}';")=='pending';assert balance()=='0,0'
sql('drop trigger credit_rollback on forma_generation_allowance;drop function test_credit_rollback();')
with ThreadPoolExecutor(max_workers=8) as pool:assert all(r=='t' for r in pool.map(lambda _:sql(pay(first)),range(8)))
assert balance()=='5,2'
second=order();assert sql(pay(second,'second_session'))=='t';assert balance()=='10,4'
assert sql(pay(first))=='t';assert balance()=='10,4'
# Direct purchases do not reset/add either balance, including repeated notifications.
p=photo(True);single=f"select forma_complete_purchase('{p}','{owner}','{ctx['key']}','portrait_session',399,'usd');"
assert sql(single)=='t';assert sql(single)=='t';assert balance()=='10,4'
sql(f"update forma_portraits set checkout_session_id=null,checkout_key=null where id='{p}';")
# Repeated credit unlock uses one credit, never generation. Other-owner/absent/deleting deny.
p=photo()
with ThreadPoolExecutor(max_workers=8) as pool:r=list(pool.map(lambda _:sql(unlock(p)),range(8)))
assert r.count('unlocked')==1 and r.count('already_unlocked')==7,r
assert balance()=='10,3';assert sql(unlock(p,other))=='not_found'
sql(f"update forma_portraits set payment_state='deleting' where id='{p}';");assert sql(unlock(p))=='not_found'
# One remaining credit, two different portraits: never overdraw.
sql(f"update forma_generation_allowance set unlocks=1 where owner_id='{owner}';")
a,b=photo(),photo()
with ThreadPoolExecutor(max_workers=2) as pool:r=list(pool.map(lambda p:sql(unlock(p)),[a,b]))
assert sorted(r)==['exhausted','unlocked'];assert balance()=='10,0'
# Compare checkout snapshots under lock; rollback unlock and debit together.
p=photo(True);assert sql(unlock(p))=='changed'
sql(f"update forma_generation_allowance set unlocks=1 where owner_id='{owner}';")
sql("create function test_unlock_rollback() returns trigger language plpgsql as $$begin if new.payment_state='paid' then raise exception 'forced';end if;return new;end;$$;create trigger unlock_rollback before update on forma_portraits for each row execute function test_unlock_rollback();")
sql(unlock(p,key="'"+ctx['key']+"'",session="'portrait_session'"),fail=True);assert balance()=='10,1'
sql('drop trigger unlock_rollback on forma_portraits;drop function test_unlock_rollback();')
# Serialize package grants with generation consumption through the shared account lock.
sql("update forma_generation_control set paused=false,active_request=null,lease_until=null;delete from forma_generation_daily;")
sql(f"update forma_generation_allowance set remaining=1 where owner_id='{owner}';")
third=order();req=uid()
with ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(sql,[pay(third,'third_session'),ctx['begin'](owner,req)]))
assert results==['t','accepted'],results
assert balance()=='5,3'
sql(ctx['finish'](owner,req));sql(pay(third,'third_session'));assert balance()=='5,3'
# Deleting an unlocked portrait does not restore any balance.
sql(f"delete from forma_portraits where id='{p}';");assert balance()=='5,3'
sql("set role anon;select * from forma_credit_orders;",fail=True)
sql(f"set role authenticated;select forma_get_credits('{owner}');",fail=True)
sql(f"set role authenticated;"+pay(first),fail=True)
print('PASS: additive package credits, one pending checkout, payment replay/rollback, direct purchase without reset, atomic unlock concurrency, ownership, generation/payment serialization and RLS')
# Credit redemption and deletion race: exact snapshot allows only one transition.
sql(f"update forma_generation_allowance set unlocks=1 where owner_id='{owner}';")
p=photo()
delete=f"select forma_claim_portrait_delete('{p}','{owner}','unpaid',null,null);"
with ThreadPoolExecutor(max_workers=2) as pool:
 result=list(pool.map(sql,[unlock(p),delete]))
state=sql(f"select payment_state from forma_portraits where id='{p}';")
if state=='paid':assert result==['unlocked','f'] and balance()=='5,0',result
else:assert state=='deleting' and result==['not_found','t'] and balance()=='5,1',result
print('PASS: credit redemption/deletion race preserves balance and confirms only one transition')
