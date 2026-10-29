#!/usr/bin/env python3
"""Owned W01 local fixture lifecycle. No production config, external DB, or OMP."""
import argparse,json,os,signal,socket,subprocess,sys,time,shutil,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
BASE=Path.home()/'.local/share/bitpos-w01-fixture'
PG=Path('/opt/homebrew/opt/postgresql@17/bin')
MARKER=BASE/'ownership.json'
ENV={**{k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','TMPDIR','LANG','LC_ALL','PNPM_HOME']},'DOTENV_CONFIG_PATH':'/dev/null','BITPOS_W01_DATABASE_URL':'postgresql://'+os.environ.get('USER','cryptoclock')+'@127.0.0.1:55446/bitpos_w01_fixture','BITPOS_DELIVERY_FIXTURE_DB_PORT':'55446','BITPOS_FIXTURE_AUTH_PORT':'55447','BITPOS_FIXTURE_API_PORT':'3046','BITPOS_FIXTURE_DATABASE_NAME':'bitpos_w01_fixture'}
def run(args,**kw):return subprocess.run([str(a)for a in args],cwd=ROOT,env=ENV,check=True,**kw)
def alive(pid):
 try:os.kill(pid,0);return True
 except ProcessLookupError:return False
def source_hash():
 h=hashlib.sha256()
 for folder in [ROOT/'apps/api/src',ROOT/'packages/contracts/src',ROOT/'packages/domain/src']:
  for path in sorted(folder.rglob('*.ts')):
   h.update(str(path.relative_to(ROOT)).encode());h.update(path.read_bytes())
 return h.hexdigest()
def owner():
 if BASE.is_symlink():raise RuntimeError('Refusing symlink fixture directory')
 if not MARKER.exists():return None
 d=json.loads(MARKER.read_text())
 if not isinstance(d.get('pid'),int) or d['pid']<2:raise RuntimeError('Invalid controller PID')
 if d.get('root')!=str(ROOT)or d.get('purpose')!='BITPOS_W01_DISPOSABLE':raise RuntimeError('Invalid fixture ownership marker')
 return d

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['up','doctor','reset','status','stop','recover-stop']);a=p.parse_args();os.chdir(ROOT)
 d=owner()
 if a.action=='status':
  controller=bool(d and alive(d['pid']))
  listeners={}
  for port in [55446,55447,3046]:
   result=subprocess.run(['lsof','-nP','-t','-iTCP:'+str(port),'-sTCP:LISTEN'],capture_output=True,text=True)
   listeners[str(port)]=[int(v)for v in result.stdout.split()]
  print(json.dumps({'running':controller,'controllerRunning':controller,'listeners':listeners,'orphanedServicesNeedOwnershipReview':not controller and any(listeners.values()),'ownedDirectory':str(BASE),'api':'http://127.0.0.1:3046','database':'bitpos_w01_fixture'}));return
 if a.action=='recover-stop':
  if not d or alive(d['pid']):raise RuntimeError('Recovery requires a recorded, absent controller')
  # Re-prove all current service identities before sending any signal.
  api_result=subprocess.run(['lsof','-nP','-t','-iTCP:3046','-sTCP:LISTEN'],capture_output=True,text=True)
  api_pids=set(int(v)for v in api_result.stdout.split())
  for pid in api_pids:
   command=subprocess.check_output(['ps','-p',str(pid),'-o','command='],text=True)
   cwd=subprocess.check_output(['lsof','-a','-p',str(pid),'-d','cwd','-Fn'],text=True)
   if 'tools/runtime/delivery-fixture-server.ts' not in command or ('n'+str(ROOT)+'\n')not in cwd:raise RuntimeError('Orphan API identity mismatch')
  auth_result=subprocess.run(['lsof','-nP','-t','-iTCP:55447','-sTCP:LISTEN'],capture_output=True,text=True)
  if not set(int(v)for v in auth_result.stdout.split()).issubset(api_pids):raise RuntimeError('Auth listener is not the verified owned API process')
  pgfile=BASE/'data/postmaster.pid'
  if pgfile.exists():
   rows=pgfile.read_text().splitlines();pid=int(rows[0])
   if rows[1]!=str(BASE/'data') or rows[3]!='55446':raise RuntimeError('Orphan PostgreSQL marker mismatch')
   command=subprocess.check_output(['ps','-p',str(pid),'-o','command='],text=True)
   if 'postgres -D '+str(BASE/'data') not in command:raise RuntimeError('Orphan PostgreSQL process mismatch')
  for pid in api_pids:os.kill(pid,signal.SIGTERM)
  for _ in range(150):
   if not any(alive(pid)for pid in api_pids):break
   time.sleep(.1)
  else:raise RuntimeError('Orphan API still stopping; no database stop attempted')
  if pgfile.exists():run([PG/'pg_ctl','-D',BASE/'data','-m','fast','-w','stop'])
  (BASE/'controller.lock').unlink(missing_ok=True)
  print('RECOVERED_STOP_OF_CURRENT_VERIFIED_W01_SERVICES');return
 if a.action=='stop':
  if not d or not alive(d['pid']):raise RuntimeError('No live owned controller')
  command=subprocess.check_output(['ps','-p',str(d['pid']),'-o','command='],text=True)
  if 'tools/runtime/fixture/runtime.py up' not in command:raise RuntimeError('Controller PID command mismatch')
  os.kill(d['pid'],signal.SIGTERM)
  for _ in range(100):
   if not alive(d['pid']):print('STOPPED_OWNED_W01_FIXTURE');return
   time.sleep(.1)
  raise RuntimeError('Controller still stopping; do not reset')
 if a.action=='reset':
  if not d:raise RuntimeError('No ownership marker; refusing reset')
  if alive(d['pid']):raise RuntimeError('Fixture is running; stop its foreground command before reset')
  if (BASE/'data/postmaster.pid').exists():raise RuntimeError('Postmaster may be live; refusing reset')
  if BASE.is_symlink():raise RuntimeError('Refusing symlink reset')
  shutil.rmtree(BASE);print('RESET_OWNED_W01_FIXTURE');return
 if a.action=='doctor':
  if not d or not alive(d['pid']):raise RuntimeError('W01 runtime is not running')
  if d.get('sourceSha256')!=source_hash():raise RuntimeError('API source changed after startup; stop/up before acceptance')
  run(['pnpm','exec','tsx','tools/runtime/fixture/apply.ts','--check'])
  run(['pnpm','exec','tsx','tools/runtime/generate-mobile-contracts.ts','--check'])
  import urllib.request
  with urllib.request.urlopen('http://127.0.0.1:3046/api/mobile/v1/branches',timeout=10)as response:
   payload=json.load(response)
   if response.status!=200 or not isinstance(payload.get('branches'),list):raise RuntimeError('Fresh fixture branch projection mismatch')
  print('PASS_W01_READY_PUBLIC_CATALOG branches='+str(len(payload['branches'])));return
 if d and alive(d['pid']):raise RuntimeError('Owned fixture already running')
 for port in [55446,55447,3046]:
  with socket.socket()as s:
   s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',port))
 BASE.mkdir(mode=0o700,parents=True,exist_ok=True)
 if BASE.is_symlink():raise RuntimeError('Refusing symlink fixture directory')
 lock=BASE/'controller.lock';fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 children=[];started=False
 try:
  MARKER.write_text(json.dumps({'root':str(ROOT),'purpose':'BITPOS_W01_DISPOSABLE','pid':os.getpid(),'sourceSha256':source_hash()}));os.chmod(MARKER,0o600)
  data=BASE/'data'
  if not data.exists():run([PG/'initdb','-D',data,'-A','trust','--no-locale','--encoding=UTF8'],stdout=subprocess.DEVNULL)
  run([PG/'pg_ctl','-D',data,'-l',BASE/'postgres.log','-o',f'-h 127.0.0.1 -k {BASE} -p 55446','-w','start']);started=True
  exists=subprocess.check_output([str(PG/'psql'),'-h','127.0.0.1','-p','55446','-d','postgres','-Atc',"SELECT 1 FROM pg_database WHERE datname='bitpos_w01_fixture'"],text=True).strip()
  if not exists:run([PG/'createdb','-h','127.0.0.1','-p','55446','bitpos_w01_fixture'])
  run(['pnpm','exec','tsx','tools/runtime/fixture/apply.ts'])
  run(['pnpm','exec','tsx','tools/runtime/generate-mobile-contracts.ts','--check'])
  log=open(BASE/'api.log','a');child=subprocess.Popen(['pnpm','exec','tsx','tools/runtime/delivery-fixture-server.ts'],cwd=ROOT,env=ENV,stdout=log,stderr=log,start_new_session=True);children.append(child)
  def stop(signum,frame):raise KeyboardInterrupt
  signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
  import urllib.request
  deadline=time.monotonic()+30
  while True:
   if child.poll()is not None:raise RuntimeError('API terminated before readiness')
   try:
    with urllib.request.urlopen('http://127.0.0.1:3046/api/mobile/v1/branches',timeout=2)as response:
     if response.status==200:break
   except Exception:
    if time.monotonic()>deadline:raise RuntimeError('API readiness timeout; inspect private api.log')
    time.sleep(.2)
  print('W01_FOREGROUND_STARTED api=127.0.0.1:3046 auth=55447 db=55446; synthetic auth; no worker/wallet/provider',flush=True)
  while child.poll()is None:time.sleep(.5)
  raise RuntimeError('Fixture API exited; inspect private api.log')
 except KeyboardInterrupt:pass
 finally:
  for child in children:
   if child.poll()is None:os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=15)
  if started:run([PG/'pg_ctl','-D',BASE/'data','-m','fast','-w','stop'])
  os.close(fd);lock.unlink(missing_ok=True)
if __name__=='__main__':main()
