#!/usr/bin/env python3
"""Bounded CLI MCP attachment; no keyboard/mouse input or provider use."""
import json,subprocess,argparse
CLI='/Users/cryptoclock/.local/bin/figcraft-cli'
def call(name,args=None):
 requests=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'bitpos-design-review','version':'1'}}},{'jsonrpc':'2.0','method':'notifications/initialized'},{'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':name,'arguments':args or {}}}]
 p=subprocess.run([CLI,'mcp','--attach','47800'],input=''.join(json.dumps(r)+'\n' for r in requests),text=True,capture_output=True,check=True,timeout=20)
 response=next(json.loads(l) for l in p.stdout.splitlines() if json.loads(l).get('id')==2)
 result=response.get('result',{})
 if 'error' in response or result.get('isError'):raise RuntimeError(response)
 return json.loads(next(x['text'] for x in result['content'] if x['type']=='text'))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('command',nargs='?');p.add_argument('params',nargs='?',default='{}');a=p.parse_args()
 if a.command:result=call('run_command',{'command':a.command,'params':json.loads(a.params)})
 else:
  result=call('inspect_ui');result={k:result.get(k) for k in ['status','presenter','lastError']}
 print(json.dumps(result,ensure_ascii=False,indent=2))
