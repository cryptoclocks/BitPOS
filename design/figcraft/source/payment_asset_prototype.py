import sys,json,zipfile,hashlib,datetime,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'tools/design'));from figcraft_live import call
r=ROOT/'design/figcraft';
if 'Prototype / selected payment asset' in zipfile.ZipFile(r/'BitPOS-Platform-UI.figcraft').read('document.json').decode('utf8'):raise SystemExit('Already applied; do not duplicate prototype variables')
m=r/'BitPOS-Platform-UI.figcraft';b=Path.home()/'.local/share/bitpos-design-backups'/('assets-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));b.mkdir();shutil.copy2(m,b/m.name)
d=json.loads(zipfile.ZipFile(m).read('document.json'));ns=d['nodes']
def run(c,p):return call('run_command',{'command':c,'params':p})
def walk(n):
 yield n
 for i in n.get('children',[]):yield from walk(ns[str(i)])
frames={n['name'].split('-')[0]:n for n in ns.values() if n['type']=='frame' and n.get('parent') in [int(k) for k,v in ns.items() if v['type']=='page']}
collection=run('variable.createCollection',{'name':'Prototype / selected payment asset'});print('collection',collection)
cid=collection['id'];variables={}
for key,value in [('summary','Test USDG · 0.170000'),('receipt','0.170000 USDG'),('symbol','USDG')]:
 variables[key]=run('variable.create',{'collection':cid,'name':key,'type':'string','value':value})['id']
commands=[]
for code in ['WD01','WD03','WD06','WD07','WD08','WD09','WD10','WD11','WD14']:
 for n in walk(frames[code]):
  value=n.get('characters');key='summary' if value=='Test USDG · 0.170000' else 'receipt' if value=='0.170000 USDG' else 'symbol' if code=='WD01' and value=='USDG' else None
  if key:commands.append({'command':'variable.bind','params':{'ids':[n['id']],'field':'characters','variable':variables[key]}})
links=json.loads((r/'handoff/interaction-map.json').read_text());assetlinks=[l for l in links if l['source']=='WD04' and l['name'] is None];hotspots=[n for n in walk(frames['WD04']) if n.get('name')=='Hotspot / WD04 to WD01'];hotspots.sort(key=lambda n:n['transform'][5])
for symbol,hot,l,dest in zip(['USDG','USDC','USDT-test'],hotspots,assetlinks,['WD01','WD21','WD01']):
 values={'summary':f'Test {symbol} · 0.170000','receipt':f'0.170000 {symbol}','symbol':symbol};actions=[{'type':'setVariable','variable':variables[k],'value':v} for k,v in values.items()]+[{'type':'navigate','dest':frames[dest]['id']}]
 commands.extend([{'command':'proto.interaction.clear','params':{'ids':[hot['id']]}},{'command':'proto.interaction.add','params':{'id':hot['id'],'actions':actions}}]);l['dest']=dest;l['prototypeSelectedAsset']=symbol
run('command.batch',{'label':'Preserve asset selection through payment prototype','commands':commands});run('file.save',{})
(r/'handoff/interaction-map.json').write_text(json.dumps(links,ensure_ascii=False,indent=2)+'\n')
(r/'reports/payment-asset-prototype.json').write_text(json.dumps({'masterSha256':hashlib.sha256(m.read_bytes()).hexdigest(),'backup':str(b),'variables':variables,'collection':cid,'limits':['Local prototype variables only; no wallet/API/chain transaction','Asset labels represent design test fixtures, not active provider support']},indent=2)+'\n')
print('APPLIED')
