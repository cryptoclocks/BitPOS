# PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
"""Disposable PostgreSQL for the PayPal worktree only.

Separate from the shared W01 fixture (port 55446, owned by the main checkout) and from
any real database. Applies every supabase/migrations/*.sql in order, like production
migrate.ts, recording them in public.bitpos_migrations so `tools/runtime/migrate.ts
--schema-only` can apply later PayPal migrations on top.

Usage: python3 -I tools/paypal/fixture-db.py up|migrate|status|stop
"""
import hashlib,json,os,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BASE=Path.home()/'.local/share/bitpos-paypal-fixture'
PG=Path('/opt/homebrew/opt/postgresql@17/bin')
PORT='55466'; DB='bitpos_paypal_fixture'
URL=f"postgresql://{os.environ.get('USER','cryptoclock')}@127.0.0.1:{PORT}/{DB}"
# 029 asserts production history of Gemini starts; an empty disposable DB has none.
OVERRIDE_029=("DO $$ BEGIN IF (SELECT count(*) FROM ai_free_requests WHERE purpose='promotion')<3 THEN RAISE EXCEPTION "
 "'Expected at least three historical Gemini starts; reconcile history before rollout'; END IF; END $$;")

os.environ.setdefault("LC_ALL","C")  # postgres refuses to start without a valid locale
def run(*a,**kw):return subprocess.run([str(x) for x in a],check=True,**kw)
def psql(sql):return subprocess.check_output([str(PG/'psql'),'-h','127.0.0.1','-p',PORT,'-d',DB,'-v','ON_ERROR_STOP=1','-Atc',sql],text=True).strip()

def up():
    BASE.mkdir(mode=0o700,parents=True,exist_ok=True)
    data=BASE/'data'
    if not data.exists():run(PG/'initdb','-D',data,'-A','trust','--no-locale','--encoding=UTF8',stdout=subprocess.DEVNULL)
    if not (data/'postmaster.pid').exists():
        run(PG/'pg_ctl','-D',data,'-l',BASE/'postgres.log','-o',f'-h 127.0.0.1 -k {BASE} -p {PORT}','-w','start')
    exists=subprocess.check_output([str(PG/'psql'),'-h','127.0.0.1','-p',PORT,'-d','postgres','-Atc',f"SELECT 1 FROM pg_database WHERE datname='{DB}'"],text=True).strip()
    if not exists:run(PG/'createdb','-h','127.0.0.1','-p',PORT,DB)
    migrate()

def migrate():
    psql("DO $$ BEGIN CREATE ROLE bitpos_app LOGIN;EXCEPTION WHEN duplicate_object THEN NULL;END $$;"
         "CREATE TABLE IF NOT EXISTS public.bitpos_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())")
    applied=set(psql('SELECT name FROM public.bitpos_migrations').split())
    count=0
    for f in sorted((ROOT/'supabase/migrations').glob('*.sql')):
        if f.name in applied:continue
        sql=f.read_text()
        if f.name=='029_coffee_copilot.sql':
            if sql.count(OVERRIDE_029)!=1:sys.exit('029 override no longer matches')
            sql=sql.replace(OVERRIDE_029,'-- PayPal disposable fixture: no historical provider starts.')
        tmp=BASE/'apply.sql'
        tmp.write_text('BEGIN;\n'+sql+f"\nINSERT INTO public.bitpos_migrations(name) VALUES('{f.name}');\nCOMMIT;\n")
        r=subprocess.run([str(PG/'psql'),'-h','127.0.0.1','-p',PORT,'-d',DB,'-v','ON_ERROR_STOP=1','-q','-f',str(tmp)],capture_output=True,text=True)
        if r.returncode:sys.exit(f'FAILED {f.name}: {r.stderr.strip()[-800:]}')
        count+=1
    total=psql('SELECT count(*) FROM public.bitpos_migrations')
    print(json.dumps({'status':'PASS','applied_now':count,'applied_total':int(total),'url':URL}))

def status():
    live=(BASE/'data/postmaster.pid').exists()
    print(json.dumps({'running':live,'url':URL,'dir':str(BASE)}))

def stop():
    if (BASE/'data/postmaster.pid').exists():run(PG/'pg_ctl','-D',BASE/'data','-m','fast','-w','stop')
    print('STOPPED')

if __name__=='__main__':
    {'up':up,'migrate':migrate,'status':status,'stop':stop}[sys.argv[1] if len(sys.argv)>1 else 'status']()
