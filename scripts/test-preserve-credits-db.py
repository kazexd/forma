"""Full chain plus preserve-credits cutover, against a fresh disposable database only."""
import runpy,uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
ctx=runpy.run_path('scripts/test-cad-db.py');sql=ctx['sql'];owner=ctx['owner'];uid=lambda:str(uuid.uuid4())
balance=lambda:sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")
activate="select forma_activate_live('ACTIVATE LIVE AND PRESERVE EXISTING CREDITS');"
# The historical suite already activated Live with the previous policy. Applying this
# new migration to an activated database must neither refund nor reset anything.
old_balance=balance();old_activation=sql('select activated_at from forma_billing_control;')
sql(Path('supabase/migrations/20261119_stripe_modes_preserve_credits.sql').read_text(encoding='utf-8'))
assert balance()==old_balance;assert sql(activate)=='f'
assert sql('select activated_at from forma_billing_control;')==old_activation
# FIXTURE ONLY: restore test mode in this disposable DB to exercise first activation.
# This is not an operator procedure and must never be run on hosted production.
sql("update forma_billing_control set mode='test',activated_at=null,reset_generations=null;")
sql(f"update forma_generation_allowance set remaining=8,unlocks=3 where owner_id='{owner}';")
empty=uid();zero=uid();sql(f"insert into auth.users values('{empty}'),('{zero}');insert into forma_generation_allowance(owner_id,remaining,unlocks) values('{zero}',0,0);")
order=uid();sql(f"select id from forma_reserve_credit_order_cad('{owner}','{order}','price_test_cad','https://example.com',extract(epoch from now())::bigint+3600,false);")
pending=uid();paid=uid();key=uid()
sql(f"insert into forma_portraits(id,owner_id,style,original_path,preview_path) values('{pending}','{owner}','casual','{pending}/original','{pending}/preview'),('{paid}','{owner}','formal','{paid}/original','{paid}/preview');")
sql(f"select id from forma_reserve_checkout_mode('{pending}','{owner}','{key}','price_test_cad',399,'cad','https://example.com',extract(epoch from now())::bigint+3600,false);")
sql(f"update forma_portraits set payment_state='paid',unlock_source='stripe',paid_at=now() where id='{paid}';")
# The old reset confirmation is now rejected; callers cannot accidentally run it.
sql("select forma_activate_live('RESET EXISTING ACCOUNTS TO 2 GENERATIONS AND 0 UNLOCKS');",fail=True)
for role in ['anon','authenticated','service_role']:sql('set role '+role+';'+activate,fail=True)
assert balance()=='8,3'
# A running generation or transactional failure leaves mode, reservations and balances unchanged.
sql("update forma_generation_control set active_request='11111111-1111-4111-8111-111111111111',lease_until=now()+interval '1 minute';")
sql(activate,fail=True);assert balance()=='8,3';assert sql('select mode from forma_billing_control;')=='test'
sql('update forma_generation_control set active_request=null,lease_until=null;')
sql("create function preserve_activation_fail() returns trigger language plpgsql as $$begin if new.mode='live' then raise exception 'forced rollback';end if;return new;end;$$;create trigger preserve_activation_fail before update on forma_billing_control for each row execute function preserve_activation_fail();")
sql(activate,fail=True)
assert balance()=='8,3';assert sql(f"select state from forma_credit_orders where id='{order}';")=='pending'
assert sql(f"select checkout_key from forma_portraits where id='{pending}';")==key
sql('drop trigger preserve_activation_fail on forma_billing_control;drop function preserve_activation_fail();')
with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(lambda _:sql(activate),range(3)))
assert results.count('t')==1 and results.count('f')==2
assert balance()=='8,3'
assert sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{zero}';")=='0,0'
assert sql(f"select count(*) from forma_generation_allowance where owner_id='{empty}';")=='0'
assert sql("select mode||','||(reset_generations is null)||','||(activated_at is not null) from forma_billing_control;")=='live,true,true'
assert sql(f"select payment_state from forma_portraits where id='{paid}';")=='paid'
assert sql(f"select state from forma_credit_orders where id='{order}';")=='expired'
assert sql(f"select (checkout_key is null) and (checkout_session_id is null) from forma_portraits where id='{pending}';")=='t'
# Old test notifications cannot top up balances, with either the true or forged mode.
for live in ['false','true']:sql(f"select forma_complete_credit_order_mode('{owner}','{order}','old_test_session',549,'cad',{live});",fail=True)
assert balance()=='8,3'
# A real-mode package still adds exactly once; another activation never changes it.
live_order=uid();sql(f"select id from forma_reserve_credit_order_cad('{owner}','{live_order}','price_live_cad','https://example.com',extract(epoch from now())::bigint+3600,true);")
pay=f"select forma_complete_credit_order_mode('{owner}','{live_order}','new_live_session',549,'cad',true);"
with ThreadPoolExecutor(max_workers=4) as pool:assert all(v=='t' for v in pool.map(lambda _:sql(pay),range(4)))
assert balance()=='13,5';assert sql(activate)=='f';assert balance()=='13,5'
assert sql(f"select forma_get_credits('{empty}')->>'remaining';")=='3'
assert sql(f"select forma_get_credits('{empty}')->>'unlocks';")=='0'
print('PASS: preserve-credit migration is inert, one-time operator-only Live cutover preserves 8/3 and 0/0, clears test reservations, rejects old reset command/test replay, rolls back safely and keeps normal Live package grants')
