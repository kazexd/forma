"""Full migration chain and two-package fulfillment. Disposable Postgres only."""
import runpy,uuid,json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ctx=runpy.run_path('scripts/test-welcome-db.py');sql=ctx['sql'];owner=ctx['owner'];uid=lambda:str(uuid.uuid4())
legacy=uid();sql(f"select id from forma_reserve_credit_order_cad('{owner}','{legacy}','price_plus','https://example.com',extract(epoch from now())::bigint+3600,true);")
balance=lambda:sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")
before=balance();legacy_snapshot=sql(f"select price_id||','||price_amount||','||price_currency||','||checkout_origin||','||checkout_expires_at from forma_credit_orders where id='{legacy}';")
sql(Path('supabase/migrations/20261119_credit_package_options.sql').read_text(encoding='utf-8'))
assert balance()==before
assert sql(f"select package_code||','||generation_credits||','||unlock_credits from forma_credit_orders where id='{legacy}';")=='plus,5,2'
assert sql(f"select price_id||','||price_amount||','||price_currency||','||checkout_origin||','||checkout_expires_at from forma_credit_orders where id='{legacy}';")==legacy_snapshot
reserve=lambda id,plan:f"select id from forma_reserve_credit_package('{owner}','{id}','price_{plan}','{plan}','https://example.com',extract(epoch from now())::bigint+3600,true);"
def pay(id,plan,discount=0,session=None):
 amount=449 if plan=='starter' else 549
 receipt=dict(price_id='price_'+plan,currency='cad',subtotal=amount,discount=discount,tax=0,inclusive_tax=0,total=amount-discount,payment_status='no_payment_required' if discount==amount else 'paid',discount_refs=['promotion_code:promo_package'] if discount else [])
 return f"select forma_complete_credit_order_discounted('{owner}','{id}','{session or 'cs_'+id}',true,'{json.dumps(receipt)}'::jsonb);"
# One pending order per plan; same-plan parallel requests reuse the exact order.
start=uid()
with ThreadPoolExecutor(max_workers=5) as pool:ids=list(pool.map(lambda _:sql('set role service_role;'+reserve(start,'starter')),range(5)))
assert ids==[start]*5
assert sql(reserve(uid(),'plus'))==legacy
assert sql(f"select package_code||','||price_amount||','||generation_credits||','||unlock_credits from forma_credit_orders where id='{start}';")=='starter,449,3,1'
assert sql(f"select count(*) from forma_credit_orders where owner_id='{owner}' and state='pending';")=='2'
# Zero-cost and paid package fulfillment share the same atomic account lock.
r,u=map(int,before.split(','))
with ThreadPoolExecutor(max_workers=8) as pool:
 calls=[pay(start,'starter',449)]*4+[pay(legacy,'plus')]*4
 assert all(v=='t' for v in pool.map(lambda call:sql('set role service_role;'+call),calls))
assert balance()==f'{r+8},{u+3}'
assert sql(f"select count(*) from forma_checkout_receipts where target_id in ('{start}','{legacy}');")=='2'
assert sql(f"select subtotal||','||discount||','||total from forma_checkout_receipts where target_id='{start}';")=='449,449,0'
# Repeating a successful package gives a fresh pending order, not another grant for old checkout.
next_order=uid();assert sql(reserve(next_order,'starter'))==next_order
sql(pay(next_order,'plus'),fail=True);assert balance()==f'{r+8},{u+3}'
# Receipt failure rolls back both payment and the 3+1 grant; retry is safe.
sql("create function package_audit_fail() returns trigger language plpgsql as $$begin raise exception 'test audit rollback';end;$$;create trigger package_audit_fail before insert on forma_checkout_receipts for each row execute function package_audit_fail();")
sql(pay(next_order,'starter',100),fail=True)
assert balance()==f'{r+8},{u+3}';assert sql(f"select state from forma_credit_orders where id='{next_order}';")=='pending'
sql('drop trigger package_audit_fail on forma_checkout_receipts;drop function package_audit_fail();')
assert sql(pay(next_order,'starter',100))=='t';assert balance()==f'{r+11},{u+4}'
# Database rejects unknown package codes and invalid amount/content combinations.
sql(reserve(uid(),'unknown'),fail=True)
sql(f"update forma_credit_orders set generation_credits=5,unlock_credits=2 where id='{next_order}';",fail=True)
sql(f"update forma_credit_orders set price_currency='usd' where id='{next_order}';",fail=True)
for role in ['anon','authenticated']:
 sql('set role '+role+';'+reserve(uid(),'starter'),fail=True)
sql(f"set role service_role;select forma_reserve_credit_order_cad('{owner}','{uid()}','price_old','https://example.com',extract(epoch from now())::bigint+3600,true);",fail=True)
# A replay cannot substitute the paid package's checkout session.
sql(pay(next_order,'starter',100,'cs_other_session'),fail=True)
assert balance()==f'{r+11},{u+4}'
print('PASS: legacy snapshots, per-plan reservation concurrency, paid/free 3+1 and 5+2 exactly-once fulfillment, additive balances, rollback and private package validation')
