"""Integration checks against a disposable Postgres container, never hosted Supabase.
Run: python scripts/test-allowance-db.py forma-allowance-test
The container must have POSTGRES_DB=forma_test. Creates test-only schemas/roles.
"""
import subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
container=sys.argv[1]
def sql(statement, fail=False):
 result=subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d','forma_test','-At','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True)
 if fail:
  assert result.returncode != 0, result.stdout
 else:
  assert result.returncode == 0, result.stderr
 return result.stdout.strip()
owner='11111111-1111-4111-8111-111111111111'
portrait='22222222-2222-4222-8222-222222222222'
key='33333333-3333-4333-8333-333333333333'
sql("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);insert into auth.users values ('"+owner+"');")
sql(Path('supabase/migrations/20261030_paid_portraits.sql').read_text())
sql("insert into forma_generation_usage values ('"+owner+"',current_date,100);")
sql(Path('supabase/migrations/20261031_purchase_generation_allowance.sql').read_text())
get=f"select forma_get_generation_allowance('{owner}');"
consume=f"select forma_consume_generation('{owner}');"
assert sql(get)=='3'
with ThreadPoolExecutor(max_workers=8) as pool:
 results=list(pool.map(lambda _:sql(consume),range(12)))
assert results.count('t')==3 and sql(get)=='0',results
sql(f"insert into forma_portraits(id,owner_id,style,original_path,preview_path,expires_at,checkout_key,checkout_session_id,price_amount,price_currency) values('{portrait}','{owner}','casual','original','preview',now()+interval '7 days','{key}','session',100,'usd');")
pay=f"select forma_complete_purchase('{portrait}','{owner}','{key}','session',100,'usd');"
# Force the second half of the transaction to fail, proving payment rolls back.
sql("create function test_fail_reset() returns trigger language plpgsql as $$begin if new.remaining=3 then raise exception 'test reset failure';end if;return new;end;$$;create trigger test_reset before update on forma_generation_allowance for each row execute function test_fail_reset();")
sql(pay,fail=True)
assert sql(f"select payment_state from forma_portraits where id='{portrait}';")=='unpaid'
assert sql(get)=='0'
sql('drop trigger test_reset on forma_generation_allowance;drop function test_fail_reset();')
with ThreadPoolExecutor(max_workers=8) as pool:
 assert all(x=='t' for x in pool.map(lambda _:sql(pay),range(8)))
assert sql(get)=='3'
assert sql(consume)=='t' and sql(get)=='2'
assert sql(pay)=='t' and sql(get)=='2' # repeated payment must not refill
# Reject a mismatched payment and browser roles.
sql(pay.replace('100,','1,'),fail=True)
sql("set role authenticated;"+get,fail=True)
# Generation and payment serialize on account row, with no deadlock or lost debit.
sql(f"update forma_portraits set payment_state='unpaid' where id='{portrait}';update forma_generation_allowance set remaining=0 where owner_id='{owner}';")
with ThreadPoolExecutor(max_workers=2) as pool:
 a=pool.submit(sql,pay);b=pool.submit(sql,consume);assert a.result()=='t';consumed=b.result()
assert sql(get)==('2' if consumed=='t' else '3')
assert sql('select count(*) from forma_generation_usage;')=='1'
print('PASS: migration, fresh allowance, concurrent consumption, payment idempotency, rollback, role restrictions, and payment/generation concurrency')

# Gallery migration preserves expired images and protects payment/deletion races.
sql("update forma_portraits set expires_at=now()-interval '10 days';")
sql(Path('supabase/migrations/20261031_personal_gallery.sql').read_text())
assert sql("select count(*) from forma_portraits where expires_at is null;")=='1'
claim=f"select forma_claim_portrait_delete('{portrait}','{owner}','unpaid','{key}','session');"
sql(f"update forma_portraits set payment_state='unpaid' where id='{portrait}';")
with ThreadPoolExecutor(max_workers=2) as pool:
 a=pool.submit(sql,pay);b=pool.submit(sql,claim);paid=a.result();deleted=b.result()
state=sql(f"select payment_state from forma_portraits where id='{portrait}';")
assert (state=='paid' and deleted=='f') or (state=='deleting' and paid=='f')
# A purchased confirmation can explicitly delete, without resetting allowance.
sql(f"update forma_portraits set payment_state='paid' where id='{portrait}';")
before=sql(get)
assert sql(claim.replace("'unpaid'","'paid'"))=='t'
assert sql(get)==before
# Changed checkout keys invalidate deletion snapshots.
sql(f"update forma_portraits set payment_state='unpaid',checkout_key=null,checkout_session_id=null where id='{portrait}';")
assert sql(claim)=='f'
# Checkout can now be reserved for a permanently retained portrait.
reserved=sql(f"select count(*) from forma_reserve_checkout('{portrait}','{owner}','{key}','price',100,'usd','http://localhost:5173',2000000000);")
assert reserved=='1'
sql("set role authenticated;"+claim,fail=True)
print('PASS: permanent retention migration, payment/deletion concurrency, confirmation snapshots, and private deletion permissions')
