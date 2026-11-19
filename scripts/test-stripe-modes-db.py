"""Fresh disposable Postgres only; never hosted Supabase. Includes all earlier migration tests."""
import runpy,uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ctx=runpy.run_path('scripts/test-credits-db.py');base_sql=ctx['sql'];owner=ctx['owner'];uid=lambda:str(uuid.uuid4())
def sql(statement,fail=False):
 return '\n'.join(line for line in base_sql(statement,fail).splitlines() if line!='SET')
get=lambda:sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")
before=get();sql(Path('supabase/migrations/20261119_stripe_modes.sql').read_text(encoding='utf-8'))
assert get()==before;assert sql("select mode from forma_billing_control;")=='test'
# Existing accounts that never loaded the allowance must also be reset to 2 on activation.
unused=uid();sql(f"insert into auth.users values('{unused}');")
assert sql(f"select count(*) from forma_generation_allowance where owner_id='{unused}';")=='0'
sql("set role service_role;select forma_activate_live('RESET EXISTING ACCOUNTS TO 2 GENERATIONS AND 0 UNLOCKS');",fail=True)
sql("select forma_activate_live('wrong confirmation');",fail=True)
# Wrappers execute for backend role; old unguarded entrypoints are no longer available.
order=uid()
reserve=f"select id from forma_reserve_credit_order_mode('{owner}','{order}','price_test','https://example.com',extract(epoch from now())::bigint+3600,false);"
assert sql('set role service_role;'+reserve)==order
assert sql(f"select stripe_livemode from forma_credit_orders where id='{order}';")=='f'
sql("set role service_role;select mode from forma_billing_control;")
sql('set role anon;select mode from forma_billing_control;',fail=True)
sql(f"set role service_role;select forma_complete_credit_order('{owner}','{order}','session',549,'usd');",fail=True)
sql(f"select forma_complete_credit_order_mode('{owner}','{order}','session',549,'usd',true);",fail=True)
paid_test=ctx['photo'](False)
sql(f"update forma_portraits set payment_state='paid',unlock_source='stripe' where id='{paid_test}';")
# An in-flight lease prevents activation; failures do not partially reset anything.
sql("update forma_generation_control set active_request='11111111-1111-4111-8111-111111111111',lease_until=now()+interval '1 minute';")
activate="select forma_activate_live('RESET EXISTING ACCOUNTS TO 2 GENERATIONS AND 0 UNLOCKS');"
sql(activate,fail=True);assert get()==before;assert sql('select mode from forma_billing_control;')=='test'
sql('update forma_generation_control set active_request=null,lease_until=null;')
# Forced reset failure rolls the whole transition back.
sql("create function test_activation_fail() returns trigger language plpgsql as $$begin if new.remaining=2 then raise exception 'forced';end if;return new;end;$$;create trigger activation_fail before update on forma_generation_allowance for each row execute function test_activation_fail();")
sql(activate,fail=True);assert get()==before;assert sql('select mode from forma_billing_control;')=='test'
sql('drop trigger activation_fail on forma_generation_allowance;drop function test_activation_fail();')
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:sql(activate),range(2)))
assert sorted(results)==['f','t'];assert get()=='2,0'
assert sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{unused}';")=='2,0'
assert sql(f"select payment_state from forma_portraits where id='{paid_test}';")=='paid'
assert sql(f"select state from forma_credit_orders where id='{order}';")=='expired'
# Late test webhooks, even if mislabelled live, cannot restore sandbox credits.
sql(f"select forma_complete_credit_order_mode('{owner}','{order}','session',549,'usd',false);",fail=True)
sql(f"select forma_complete_credit_order_mode('{owner}','{order}','session',549,'usd',true);",fail=True)
assert get()=='2,0'
# A live package adds once and never gets wiped by repeated activation.
live_order=uid();assert sql(f"set role service_role;select id from forma_reserve_credit_order_mode('{owner}','{live_order}','price_live','https://example.com',extract(epoch from now())::bigint+3600,true);")==live_order
assert sql(f"select stripe_livemode from forma_credit_orders where id='{live_order}';")=='t'
pay=f"select forma_complete_credit_order_mode('{owner}','{live_order}','live_session',549,'usd',true);"
with ThreadPoolExecutor(max_workers=6) as pool:assert all(x=='t' for x in pool.map(lambda _:sql('set role service_role;'+pay),range(6)))
assert get()=='7,2';assert sql(activate)=='f';assert get()=='7,2'
# Existing unpaid test portraits can be newly purchased in Live mode; already-paid remain intact.
portrait=ctx['photo'](False);key=uid()
assert sql(f"select id from forma_reserve_checkout_mode('{portrait}','{owner}','{key}','price_live',399,'usd','https://example.com',extract(epoch from now())::bigint+3600,true);")==portrait
assert sql(f"select stripe_livemode from forma_portraits where id='{portrait}';")=='t'
assert sql(f"select forma_complete_purchase_mode('{portrait}','{owner}','{key}','live_portrait_session',399,'usd',true);")=='t';assert get()=='7,2'
# New registrations keep the existing 3/0 offer, not the one-time migration reset.
new=uid();sql(f"insert into auth.users values('{new}');")
assert sql(f"select forma_get_credits('{new}')->>'remaining';")=='3'
# Live generation and redemption wrappers preserve balances and reject test callers.
sql('update forma_generation_control set paused=false;delete from forma_generation_daily;')
req=uid();begin=f"select forma_begin_generation_mode('{owner}','{req}','casual','{'a'*64}',null,"
sql(begin+'false);',fail=True);assert sql(begin+'true);')=='accepted';assert get()=='6,2'
sql(f"select forma_finish_generation('{owner}','{req}',false);")
p=ctx['photo'](False);assert sql(f"select forma_unlock_portrait_mode('{owner}','{p}',null,null,true);")=='unlocked';assert get()=='6,1'
assert sql(f"select stripe_livemode from forma_portraits where id='{p}';")=='t'
print('PASS: explicit Stripe mode isolation, operator-only one-time 2/0 reset, atomic activation rollback, late sandbox replay blocked, preserved portraits, new-user 3/0 and Live payment/generation/unlock wrappers')
