"""Fresh disposable database only. Includes all previous mode and credit checks."""
import runpy,uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ctx=runpy.run_path('scripts/test-stripe-modes-db.py');sql=ctx['sql'];owner=ctx['owner'];uid=lambda:str(uuid.uuid4())
# Seed a pending USD order in the previous release before applying the CAD migration.
legacy=uid();sql(f"select id from forma_reserve_credit_order_mode('{owner}','{legacy}','price_usd','https://example.com',extract(epoch from now())::bigint+3600,true);")
old_balance=sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")
old_usd=sql("select count(*) from forma_credit_orders where price_currency='usd';")
sql(Path('supabase/migrations/20261119_stripe_modes_cad.sql').read_text(encoding='utf-8'))
assert sql("select count(*) from forma_credit_orders where price_currency='usd';")==old_usd
assert sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")==old_balance
reserve=lambda p:f"select id from forma_reserve_credit_order_cad('{owner}','{p}','price_cad','https://example.com',extract(epoch from now())::bigint+3600,true);"
# Reuse a pending historical reservation safely for backend reconciliation, never rewrite USD to CAD.
assert sql('set role service_role;'+reserve(uid()))==legacy
assert sql(f"select price_currency from forma_credit_orders where id='{legacy}';")=='usd'
sql(f"select forma_complete_credit_order_mode('{owner}','{legacy}','usd_session',549,'cad',true);",fail=True)
assert sql(f"select forma_complete_credit_order_mode('{owner}','{legacy}','usd_session',549,'usd',true);")=='t'
new=uid();assert sql('set role service_role;'+reserve(new))==new
assert sql(f"select price_currency||','||price_amount||','||stripe_livemode from forma_credit_orders where id='{new}';")=='cad,549,true'
sql(f"select forma_complete_credit_order_mode('{owner}','{new}','cad_session',549,'usd',true);",fail=True)
pay=f"select forma_complete_credit_order_mode('{owner}','{new}','cad_session',549,'cad',true);"
with ThreadPoolExecutor(max_workers=5) as pool:assert all(v=='t' for v in pool.map(lambda _:sql('set role service_role;'+pay),range(5)))
remaining,unlocks=map(int,old_balance.split(','))
assert sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")==f'{remaining+10},{unlocks+4}'
sql('set role anon;'+reserve(uid()),fail=True)
sql(f"set role service_role;select id from forma_reserve_credit_order_mode('{owner}','{uid()}','price_usd','https://example.com',extract(epoch from now())::bigint+3600,true);",fail=True)
# New single-portrait checkout requires CAD; USD fulfillment history remains valid elsewhere.
p=uid();key=uid();sql(f"insert into forma_portraits(id,owner_id,style,original_path,preview_path) values('{p}','{owner}','casual','{p}/original','{p}/preview');")
checkout=lambda currency:f"select id from forma_reserve_checkout_mode('{p}','{owner}','{key}','price_cad',399,'{currency}','https://example.com',extract(epoch from now())::bigint+3600,true);"
sql(checkout('usd'),fail=True);assert sql('set role service_role;'+checkout('cad'))==p
assert sql(f"select price_currency from forma_portraits where id='{p}';")=='cad'
assert sql(f"select forma_complete_purchase_mode('{p}','{owner}','{key}','cad_portrait_session',399,'cad',true);")=='t'
print('PASS: CAD-only new reservations, preserved USD history/balances, historical USD fulfillment, currency mismatch rejection, replay safety and private RPC permissions')
