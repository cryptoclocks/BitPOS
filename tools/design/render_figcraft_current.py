#!/usr/bin/env python3
import json,subprocess,hashlib,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
ROOT=Path(__file__).resolve().parents[2];cli=str(Path.home()/'.local/bin/figcraft-cli');master=ROOT/'design/figcraft/BitPOS-Platform-UI.figcraft';out=ROOT/'design/figcraft/previews/current-native';out.mkdir(exist_ok=True)
info=json.loads(subprocess.check_output([cli,'info',str(master),'--json'],text=True));targets=[f for p in info['pages'] for f in p['frames']]
def render(f):
 start=time.monotonic();code=f['name'].split('-')[0] if not f['name'].startswith('Overlay-') else f['name'];p=out/(code+'.png')
 r=subprocess.run([cli,'export',str(master),'-o',str(p),'--node',str(f['id']),'--scale','1'],capture_output=True,text=True,timeout=90)
 return {'name':f['name'],'id':f['id'],'ok':r.returncode==0 and p.exists(),'seconds':round(time.monotonic()-start,2),'error':r.stderr[-1200:] if r.returncode else '', 'path':str(p.relative_to(ROOT))}
rows=[]
with ThreadPoolExecutor(max_workers=2) as pool:
 for future in as_completed([pool.submit(render,f) for f in targets]):
  row=future.result();rows.append(row)
  if len(rows)%20==0 or not row['ok']:print(json.dumps({'rendered':len(rows),'of':len(targets),'last':row['name'],'ok':row['ok']}),flush=True)
report={'masterSha256':hashlib.sha256(master.read_bytes()).hexdigest(),'count':len(rows),'failures':[r for r in rows if not r['ok']],'renders':rows,'limits':['Render success is not full visual or presenter acceptance.']}
(ROOT/'design/figcraft/reports/current-native-render.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'count':len(rows),'failures':len(report['failures'])}),flush=True)
if report['failures']:raise SystemExit(1)
