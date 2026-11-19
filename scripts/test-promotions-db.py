"""Full migration chain and promotion transactions; disposable database only."""
import runpy, uuid, json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ctx=runpy.run_path('scripts/test-preserve-credits-db.py');sql=ctx['sql'];owner=ctx['owner'];uid=lambda:str(uuid.uuid4())
reserve=lambda order:f"select id from forma_reserve_credit_order_cad('{owner}','{order}','price_promo','https://example.com',extract(epoch from now())::bigint+3600,true);"
legacy=uid();sql(reserve(legacy))
sql(Path('supabase/migrations/20261119_stripe_promotions.sql').read_text(encoding='utf-8'))
assert sql(f"select promotions_enabled from forma_credit_orders where id='{legacy}';")=='f'
sql(f"update forma_credit_orders set state='expired' where id='{legacy}';")
balance=lambda:sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")
def receipt(amount=549,discount=549):
 return dict(price_id='price_promo',currency='cad',subtotal=amount,discount=discount,tax=0,inclusive_tax=0,total=amount-discount,payment_status='no_payment_required' if amount==discount else 'paid',discount_refs=['promotion_code:promo_test'] if discount else [])
def complete(order,session,r):
 return f"select forma_complete_credit_order_discounted('{owner}','{order}','{session}',true,'{json.dumps(r)}'::jsonb);"
order=uid();sql(reserve(order));assert sql(f"select promotions_enabled from forma_credit_orders where id='{order}';")=='t'
call=complete(order,'cs_promo_free',receipt())
with ThreadPoolExecutor(max_workers=6) as pool:assert all(v=='t' for v in pool.map(lambda _:sql('set role service_role;'+call),range(6)))
assert balance()=='18,7';assert sql("select count(*) from forma_checkout_receipts where checkout_session_id='cs_promo_free';")=='1'
sql(complete(order,'cs_promo_free',receipt(discount=100)),fail=True);assert balance()=='18,7'
# Audit insertion failure must roll back the paid state and credit grant together.
other=uid();sql(reserve(other))
sql("create function promo_fail() returns trigger language plpgsql as $$begin raise exception 'forced audit failure';end;$$;create trigger promo_fail before insert on forma_checkout_receipts for each row execute function promo_fail();")
sql(complete(other,'cs_promo_partial',receipt(discount=100)),fail=True)
assert balance()=='18,7';assert sql(f"select state from forma_credit_orders where id='{other}';")=='pending'
sql('drop trigger promo_fail on forma_checkout_receipts;drop function promo_fail();')
for bad in [dict(receipt(),subtotal=548),dict(receipt(),currency='usd'),dict(receipt(),discount=0),dict(receipt(),discount_refs=[])]:sql(complete(other,'cs_invalid',bad),fail=True)
assert balance()=='18,7'
assert sql(complete(other,'cs_promo_partial',receipt(discount=100)))=='t';assert balance()=='23,9'
# New portrait reservations opt in, while clearing a reservation clears its flag.
p=uid();key=uid();sql(f"insert into forma_portraits(id,owner_id,style,original_path,preview_path) values('{p}','{owner}','casual','{p}/original','{p}/preview');")
sql(f"select id from forma_reserve_checkout_mode('{p}','{owner}','{key}','price_promo',399,'cad','https://example.com',extract(epoch from now())::bigint+3600,true);")
assert sql(f"select promotions_enabled from forma_portraits where id='{p}';")=='t'
pay=f"select forma_complete_purchase_discounted('{p}','{owner}','{key}','cs_promo_portrait',true,'{json.dumps(receipt(399,399))}'::jsonb);"
with ThreadPoolExecutor(max_workers=4) as pool:assert all(v=='t' for v in pool.map(lambda _:sql(pay),range(4)))
assert sql(f"select payment_state from forma_portraits where id='{p}';")=='paid';assert balance()=='23,9'
for role in ['anon','authenticated']:
 sql('set role '+role+';'+pay,fail=True)
 sql('set role '+role+';select * from forma_checkout_receipts;',fail=True)
sql('set role service_role;delete from forma_checkout_receipts;',fail=True)
sql(f"set role service_role;select forma_complete_credit_order_mode('{owner}','{other}','cs_promo_partial',549,'cad',true);",fail=True)
print('PASS: promotion opt-in, zero/partial payments, immutable receipts, concurrent exactly-once grants, rollback and private permissions')
