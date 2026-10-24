#!/usr/bin/env python3
"""Create small nonoverlapping UI snapshots, never a dirty repository worktree clone."""
import tempfile,hashlib,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
scopes={'flutter':['apps/mobile-customer/lib','apps/mobile-driver/lib'], 'web':['apps/web/src/components/Payment.tsx','apps/web/src/components/OrderBill.tsx','apps/web/src/components/IncomingOrders.tsx','apps/web/src/styles/customer-checkout.css']}
manifest={'sourceRoot':str(ROOT),'contract':'.omp/work/flutter-delivery-20261016/ui-patch-contract-20261017.md','snapshots':{}}
for name,paths in scopes.items():
 target=Path(tempfile.mkdtemp(prefix='bitpos-ui-'+name+'-20261017-'));files=[]
 for relative in paths:
  source=ROOT/relative
  for f in sorted(source.rglob('*')) if source.is_dir() else [source]:
   if not f.is_file():continue
   rel=f.relative_to(ROOT);dest=target/rel;dest.parent.mkdir(parents=True,exist_ok=True);data=f.read_bytes();dest.write_bytes(data);files.append({'path':str(rel),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
 manifest['snapshots'][name]={'root':str(target),'files':files,'bytes':sum(f['bytes'] for f in files)}
output=ROOT/'.omp/work/flutter-delivery-20261016/evidence/ui-patch-snapshots-20261017.json';output.write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:{'root':v['root'],'files':len(v['files']),'bytes':v['bytes']} for k,v in manifest['snapshots'].items()}))
