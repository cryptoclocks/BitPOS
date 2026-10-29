#!/usr/bin/env python3
"""Read-only installed FigCraft CLI/MCP capability probe. Does not edit designs."""
import hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CLI=Path.home()/'.local/bin/figcraft-cli'
MASTER=ROOT/'design/figcraft/BitPOS-Platform-UI.figcraft'
def run(args):
    return subprocess.run([str(CLI),*args],text=True,capture_output=True,check=True,timeout=60).stdout
info=json.loads(run(['info',str(MASTER),'--json']))
commands=json.loads(run(['commands','--json']))
requests=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'bitpos-readonly-poc','version':'1'}}},{'jsonrpc':'2.0','method':'notifications/initialized'},{'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}}]
proc=subprocess.run([str(CLI),'mcp'],input=''.join(json.dumps(x)+'\n' for x in requests),text=True,capture_output=True,timeout=60,check=True)
responses=[json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
listing=next(r for r in responses if r.get('id')==2)
if 'error' in listing:raise RuntimeError(listing['error'])
tools=listing['result']['tools']
report={'version':run(['--version']).strip(),'masterSha256':hashlib.sha256(MASTER.read_bytes()).hexdigest(),'master':{'nodes':info['nodes'],'pages':len(info['pages']),'variables':info['variables'],'styles':info['styles'],'images':info['images'],'notes':info['notes']},'commands':len(commands),'mcp':{'initialize':'PASS' if any(r.get('id')==1 and 'result' in r for r in responses) else 'FAIL','toolsList':'PASS','toolCount':len(tools),'toolNames':[t['name'] for t in tools]},'limits':['Read-only capabilities probe, not Flutter generation or visual acceptance.','Installed0.6.0 may differ from latest upstream documentation.']}
output=ROOT/'design/figcraft/reports/flutter-pipeline-probe.json'
output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
