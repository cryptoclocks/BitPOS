import subprocess,tempfile,os,pathlib,json,argparse,uuid,sys
# Disposable local clone only; synthetic funding/provider transport, no network sends.
bin='/opt/homebrew/opt/postgresql@17/bin/'
parser=argparse.ArgumentParser();parser.add_argument('--finalized-failure',action='store_true');args=parser.parse_args()
name='bitpos_settlement_probe_'+uuid.uuid4().hex[:12]
prior=json.loads(pathlib.Path('.omp/work/flutter-delivery-20261016/evidence/settlement088-current-http-20261019.json').read_text())
batch=str(uuid.UUID(prior['batchId']))
base=[ '-h','127.0.0.1','-p','55436','-U','cryptoclock']
created=False
try:
 subprocess.run([bin+'createdb',*base,name],capture_output=True,check=True);created=True
 with tempfile.TemporaryFile() as dump:
  subprocess.run([bin+'pg_dump',*base,'--format=custom','bitpos_delivery_fixture'],stdout=dump,stderr=subprocess.PIPE,check=True);dump.seek(0)
  subprocess.run([bin+'pg_restore',*base,'--exit-on-error','--dbname='+name],stdin=dump,capture_output=True,check=True)
 subprocess.run([bin+'psql',*base,'-d',name,'-v','ON_ERROR_STOP=1','-c',f"UPDATE bitpos.platform_staff_role_grants SET revoked_at=clock_timestamp() WHERE role='finance' AND revoked_at IS NULL; WITH facts AS (SELECT created_by,merchant_id FROM bitpos.settlement088_batches WHERE id='{batch}'), grant_row AS (INSERT INTO bitpos.platform_staff_role_grants(account_id,role,granted_by,expires_at) SELECT created_by,'finance','Direct isolated clone fixture only',clock_timestamp()+interval '1 hour' FROM facts RETURNING id) INSERT INTO bitpos.platform_role_scopes SELECT grant_row.id,facts.merchant_id FROM grant_row CROSS JOIN facts"],capture_output=True,check=True)
 env=dict(os.environ,BITPOS_SETTLEMENT_PROBE_DATABASE=name)
 result=subprocess.run(['./node_modules/.bin/tsx','tools/runtime/settlement088-worker-committed-smoke.ts','--finalized-failure' if args.finalized_failure else '--concurrent-finalize'],env=env,capture_output=True,text=True,timeout=120)
 print('worker_exit',result.returncode)
 if result.returncode:print(result.stderr[-2500:])
 else:
  p=pathlib.Path('.omp/work/flutter-delivery-20261016/evidence')/('settlement088-worker-failure-direct-clone-20261019.json' if args.finalized_failure else 'settlement088-worker-direct-clone-20261019.json');d=json.loads(p.read_text());print(d['status'],d.get('counterpart',d.get('final')))
finally:
 if created:
  x=subprocess.run([bin+'dropdb',*base,name],capture_output=True);print('clone_removed',x.returncode==0)
  if x.returncode:raise RuntimeError('Disposable clone cleanup failed')
if result.returncode:sys.exit(result.returncode)
