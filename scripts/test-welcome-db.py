"""Full migration chain plus new-account welcome. Fresh disposable database only."""
import runpy,uuid
from pathlib import Path
ctx=runpy.run_path('scripts/test-promotions-db.py');sql=ctx['sql'];owner=ctx['owner']
old=sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")
sql(Path('supabase/migrations/20261119_new_account_welcome.sql').read_text(encoding='utf-8'))
assert sql('select count(*) from forma_account_welcome;')=='0'
new=str(uuid.uuid4());other=str(uuid.uuid4());sql(f"insert into auth.users values('{new}'),('{other}');")
assert sql(f"select acknowledged_at is null from forma_account_welcome where owner_id='{new}';")=='t'
assert sql(f"select count(*) from forma_generation_allowance where owner_id='{new}';")=='0'
for role in ['anon','authenticated']:
 sql('set role '+role+';select * from forma_account_welcome;',fail=True)
 sql(f"set role {role};update forma_account_welcome set acknowledged_at=now() where owner_id='{new}';",fail=True)
sql(f"set role service_role;update forma_account_welcome set acknowledged_at=now() where owner_id='{new}' and acknowledged_at is null;")
first=sql(f"select acknowledged_at from forma_account_welcome where owner_id='{new}';")
sql(f"set role service_role;update forma_account_welcome set acknowledged_at=now() where owner_id='{new}' and acknowledged_at is null;")
assert sql(f"select acknowledged_at from forma_account_welcome where owner_id='{new}';")==first
assert sql(f"select acknowledged_at is null from forma_account_welcome where owner_id='{other}';")=='t'
assert sql(f"select remaining||','||unlocks from forma_generation_allowance where owner_id='{owner}';")==old
sql(f"delete from auth.users where id='{new}';")
assert sql(f"select count(*) from forma_account_welcome where owner_id='{new}';")=='0'
print('PASS: only new accounts enrolled, private state, idempotent acknowledgement, balance unchanged and deletion cascade')
