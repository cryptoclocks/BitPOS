import subprocess,tempfile,os,uuid,json,pathlib,sys,argparse
parser=argparse.ArgumentParser();parser.add_argument('--replacement-quotes',action='store_true');args=parser.parse_args()
pgbin='/opt/homebrew/opt/postgresql@17/bin/'
name='bitpos_coupon_probe_'+uuid.uuid4().hex[:12]
base=['-h','127.0.0.1','-p','55436','-U','cryptoclock'];created=False;result=None
receipt=pathlib.Path('.omp/work/flutter-delivery-20261016/evidence')/('coupon098-concurrency-direct-20261020.json'if args.replacement_quotes else 'coupon097-concurrency-direct-20261019.json')
try:
 subprocess.run([pgbin+'createdb',*base,name],capture_output=True,check=True);created=True
 with tempfile.TemporaryFile() as dump:
  subprocess.run([pgbin+'pg_dump',*base,'--format=custom','bitpos_delivery_fixture'],stdout=dump,stderr=subprocess.PIPE,check=True);dump.seek(0)
  subprocess.run([pgbin+'pg_restore',*base,'--exit-on-error','--dbname='+name],stdin=dump,capture_output=True,check=True)
 result=subprocess.run(['./node_modules/.bin/tsx','tools/runtime/coupon097-concurrent-smoke.ts']+(['--replacement-quotes']if args.replacement_quotes else []),env=dict(os.environ,BITPOS_COUPON_PROBE_DATABASE=name),capture_output=True,text=True,timeout=120)
 print(result.stdout[-1200:])
 if result.returncode:print(result.stderr[-2500:])
finally:
 if created:
  cleanup=subprocess.run([pgbin+'dropdb',*base,name],capture_output=True)
  removed=cleanup.returncode==0;print('disposable_clone_removed',removed)
  if receipt.exists():
   data=json.loads(receipt.read_text())
   if data.get('probeDatabase')==name:
    data['disposableCloneRemoved']=removed;receipt.write_text(json.dumps(data,indent=2)+'\n')
  if not removed:raise RuntimeError('Disposable coupon clone cleanup failed')
if result is None or result.returncode:sys.exit(result.returncode if result else 1)
