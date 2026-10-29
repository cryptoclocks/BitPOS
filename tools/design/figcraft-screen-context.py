#!/usr/bin/env python3
"""Extract bounded design context over real FigCraft MCP; never saves the master."""
import argparse,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--screen',required=True);args=p.parse_args()
cli=str(Path.home()/'.local/bin/figcraft-cli');master=ROOT/'design/figcraft/BitPOS-Platform-UI.figcraft'
info=json.loads(subprocess.check_output([cli,'info',str(master),'--json'],text=True))
frames=[f for page in info['pages'] for f in page['frames'] if f['name'].split('-')[0]==args.screen]
if len(frames)!=1:raise SystemExit(f'Expected one frame for {args.screen}, got {len(frames)}')
requests=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'bitpos-screen-context','version':'1'}}},{'jsonrpc':'2.0','method':'notifications/initialized'}]
for i,(name,arguments) in enumerate([('open_file',{'path':str(master)}),('get_node',{'id':frames[0]['id'],'depth':4}),('run_command',{'command':'variable.export','params':{}})],2):
 requests.append({'jsonrpc':'2.0','id':i,'method':'tools/call','params':{'name':name,'arguments':arguments}})
proc=subprocess.run([cli,'mcp'],input=''.join(json.dumps(r)+'\n' for r in requests),capture_output=True,text=True,check=True,timeout=60)
responses={r['id']:r for r in map(json.loads,proc.stdout.splitlines()) if 'id' in r}
for i in [2,3,4]:
 r=responses[i]
 if 'error' in r or r.get('result',{}).get('isError'):raise SystemExit(f'MCP call{i} failed: {r}')
out=ROOT/'design/figcraft/reports/flutter-poc';out.mkdir(exist_ok=True)
result={'screen':args.screen,'frame':frames[0],'masterSha256':hashlib.sha256(master.read_bytes()).hexdigest(),'node':responses[3]['result'],'nativeVariables':responses[4]['result'],'semanticTokens':'design/figcraft/handoff/tokens.json','limits':['Bounded node context; deeper children require another explicit query.','Not generated Flutter or runtime acceptance.']}
path=out/(args.screen+'.context.json');path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'result':'PASS','screen':args.screen,'frame':frames[0]['id'],'context':str(path),'bytes':path.stat().st_size}))
