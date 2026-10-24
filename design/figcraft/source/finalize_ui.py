#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Native components, token bindings and prototype navigation, using FigCraft commands."""
from pathlib import Path
from zipfile import ZipFile
from collections import defaultdict
import json,subprocess

OUT=Path(__file__).resolve().parents[1];MASTER=OUT/'BitPOS-Platform-UI.figcraft';CLI=Path.home()/'.local/bin/figcraft-cli'
manifest=json.loads((OUT/'handoff/screen-map.json').read_text())['screens']
def load():
 with ZipFile(MASTER) as z:return json.loads(z.read('document.json'))
def run(tag,commands):
 p=OUT/'reports'/(tag+'-commands.json');p.write_text(json.dumps(commands,ensure_ascii=False,indent=2))
 r=subprocess.run([str(CLI),'run',str(p),'--in',str(MASTER),'--out',str(MASTER)],capture_output=True,text=True)
 (OUT/'reports'/(tag+'-results.jsonl')).write_text(r.stdout)
 rows=[json.loads(l) for l in r.stdout.splitlines() if l.startswith('{')]
 failures=[v for v in rows if not v.get('ok')]
 if r.returncode or failures:raise RuntimeError(str(failures[:4])+' '+r.stderr[-1400:]+' '+r.stdout[-800:])
 print(tag,len(rows),'commands passed',flush=True);return rows
def descend(nodes,i):
 yield nodes[str(i)]
 for c in nodes[str(i)].get('children',[]):yield from descend(nodes,c)
def rgb(v):return '#'+''.join(f'{round(v.get(a,0)*255):02X}' for a in ['r','g','b'])
d=load();nodes=d['nodes'];frames={n['name'].split('-')[0]:n for n in nodes.values() if n['type']=='frame' and n['name'].split('-')[0] in {a['id'] for a in manifest}}
tokens=json.loads((OUT/'handoff/tokens.json').read_text());colors=tokens['color']
dark={'primary':'#64188A','action':'#B797FF','orange':'#FF8500','orangeInk':'#FFC38A','ink':'#F8F0FC','muted':'#C2B3CF','bg':'#1C1325','white':'#2A1C36','line':'#493653','tint':'#3C2850','peach':'#47311F','green':'#8BDBB9','greenbg':'#233D33','red':'#FFB4BF','redbg':'#4A2733','blue':'#B4CCF7','bluebg':'#29354B','dark':'#140C1B'}
commands=[{'command':'variable.createCollection','params':{'name':'BitPOS Theme','modes':['Light','Dark']}}]
for key,value in colors.items():commands.append({'command':'variable.create','params':{'collection':'BitPOS Theme','name':'color/'+key,'type':'color','values':{'Light':value,'Dark':dark[key]}}})
commands += [{'command':'variable.create','params':{'collection':'BitPOS Theme','name':'color/onPrimary','type':'color','values':{'Light':'#FFFFFF','Dark':'#FFFFFF'}}},{'command':'variable.create','params':{'collection':'BitPOS Theme','name':'color/accent','type':'color','values':{'Light':colors['primary'],'Dark':'#D9A9F4'}}},{'command':'variable.createCollection','params':{'name':'BitPOS Geometry','modes':['Default']}}]
for v in tokens['spacing']:commands.append({'command':'variable.create','params':{'collection':'BitPOS Geometry','name':'space/'+str(v),'type':'number','value':v}})
for key,v in tokens['radius'].items():commands.append({'command':'variable.create','params':{'collection':'BitPOS Geometry','name':'radius/'+key,'type':'number','value':v}})
for p in d['pages']:commands.append({'command':'page.setBackground','params':{'id':p,'color':'#DCD6E5'}})
ref=next(n for n in nodes.values() if n['type']=='page' and n['name'].startswith('03 -'))
for index,page in enumerate(sorted((nodes[str(pid)] for pid in d['pages']),key=lambda n:n['name'])):commands.append({'command':'page.move','params':{'id':page['id'],'index':index}})
for i in ref['children']:
 n=nodes[str(i)]
 if n.get('width',0)>500:
  commands.append({'command':'node.set','params':{'ids':[i],'width':390,'height':390*n['height']/n['width']}})

# Every imported shape/text remains editable. Semantic names keep layer navigation readable.
binds=defaultdict(list);fontstyles={}
for n in nodes.values():
 if n['type']=='text':
  commands.append({'command':'node.set','params':{'ids':[n['id']],'name':f'Text / {n.get("style",{}).get("font_size",16):g}px / {n["id"]}'}})
  size=n.get('style',{}).get('font_size');fontstyles.setdefault(size,n['id'])
 for field in ['fills','strokes']:
  arr=n.get(field,[])
  if arr and arr[0].get('type')=='solid' and isinstance(arr[0].get('color'),dict):
   c=rgb(arr[0]['color']);key=next((k for k,v in colors.items() if v.upper()==c),None)
   if key:
    if c=='#FFFFFF' and (n['type']=='text' or field=='strokes'):key='onPrimary'
    elif key=='primary' and (n['type']=='text' or field=='strokes'):key='accent'
    binds[(field,key)].append(n['id'])
for (field,key),ids in binds.items():commands.append({'command':'variable.bind','params':{'ids':ids,'field':'fill' if field=='fills' else 'stroke','variable':'color/'+key}})
for size,n in fontstyles.items():
 if size in [12,13,14,15,16,18,20,24,28,32,40,48]:commands.append({'command':'style.create','params':{'type':'text','name':'BitPOS / Type / '+str(int(size)), 'from':n}})
components=[]
for code,compname in [('D02','Button/Primary/Default'),('D03','Button/Primary/Disabled'),('D04','Button/Secondary/Default'),('D05','Button/Outline/Default'),('D06','Button/Danger/Default')]:
 group=next(n for n in descend(nodes,frames[code]['id']) if n['name']=='component-button')
 label=next(n for n in descend(nodes,group['id']) if n['type']=='text')
 commands += [{'command':'component.create','params':{'ids':[group['id']]}},{'command':'node.set','params':{'ids':[group['id']],'name':compname}},{'command':'component.addProperty','params':{'id':group['id'],'name':'Label','type':'text','default':label['characters'],'layer':label['id']}},{'command':'node.set','params':{'ids':[label['id']],'x':16,'y':14,'width':310,'height':26,'textAutoResize':'none','textAlign':'center','constraints':{'horizontal':'leftRight','vertical':'center'}}}]
 components.append({'name':compname,'id':group['id']})
 if code=='D03':commands.append({'command':'node.set','params':{'ids':[group['id']],'opacity':0.4}})
for code,prefix,names in [('D07','Field-',['Field/Address','Field/Search','Field/Phone']),('D09','Card-',['Card/Food','Card/Driver']),('D09','Metric-',['Metric/Money'])]:
 groups=[n for n in descend(nodes,frames[code]['id']) if n['type']=='group' and n['name'].startswith(prefix)]
 for n,name in zip(groups,names):commands += [{'command':'component.create','params':{'ids':[n['id']]}},{'command':'node.set','params':{'ids':[n['id']],'name':name}}];components.append({'name':name,'id':n['id']})
for radius,key in [(14,'control'),(20,'card'),(28,'sheet')]:
 ids=[n['id'] for n in nodes.values() if n.get('corners',{}).get('radii')==[float(radius)]*4]
 if ids:commands.append({'command':'variable.bind','params':{'ids':ids,'field':'cornerRadius','variable':'radius/'+key}})
for m in manifest:
 if m.get('dark'):commands.append({'command':'variable.setMode','params':{'ids':[frames[m['id']]['id']],'collection':'BitPOS Theme','mode':'Dark'}})
run('native-foundations',commands)

# Use real component instances for common full-width primary CTA buttons.
d=load();nodes=d['nodes'];primary=next(x['id'] for x in components if x['name']=='Button/Primary/Default')
instances=[];commands=[]
for m in manifest:
 if m['surface'] in ['system','guide']:continue
 root=frames[m['id']]['id']
 for n in list(descend(nodes,root)):
  if n['type']!='group' or not n['name'].startswith('button-'):continue
  children=[nodes[str(i)] for i in n.get('children',[])];rect=next((a for a in children if a['type']=='rectangle'),None);label=next((a for a in children if a['type']=='text'),None)
  if len(children)!=2 or not rect or not label or abs(n.get('width',0)-342)>0.5 or abs(n.get('height',0)-52)>0.5:continue
  paint=rect.get('fills',[{}])[0]
  if paint.get('type')!='solid' or rgb(paint['color'])!=colors['primary'].upper():continue
  t=n.get('transform',[1,0,0,1,0,0]);commands.append({'command':'instance.create','params':{'component':primary,'parent':n['parent'],'x':t[4],'y':t[5]}});instances.append({'old':n['id'],'name':n['name'],'label':label['characters'],'screen':m['id']})
if commands:
 rows=run('native-instances',commands);commands=[]
 for meta,row in zip(instances,rows):
  ident=row['result']['id'];meta['instance']=ident;commands += [{'command':'instance.setProperties','params':{'ids':[ident],'properties':{'Label':meta['label']}}},{'command':'node.set','params':{'ids':[ident],'name':meta['name']}},{'command':'edit.delete','params':{'ids':[meta['old']]}}]
 run('native-instance-properties',commands)

d=load();nodes=d['nodes'];links=json.loads((OUT/'handoff/interaction-map.json').read_text());commands=[];pending=[]
for link in links:
 if link['source'] not in frames or link['dest'] not in frames:raise RuntimeError('Unknown prototype destination '+str(link))
 root=frames[link['source']]['id'];dest=frames[link['dest']]['id']
 existing=next((n for n in descend(nodes,root) if n.get('name')==link.get('name')),None) if link.get('name') else None
 if existing:commands.append({'command':'proto.interaction.add','params':{'id':existing['id'],'dest':dest}})
 else:
  x,y,w,h=link['rect'];commands.append({'command':'node.create','params':{'type':'rectangle','parent':root,'x':x,'y':y,'width':w,'height':h,'name':f'Hotspot / {link["source"]} to {link["dest"]}','props':{'fill':'#FFFFFF00'}}});pending.append((len(commands)-1,dest))
rows=run('native-navigation',commands)
commands=[{'command':'proto.interaction.add','params':{'id':rows[index]['result']['id'],'dest':dest}} for index,dest in pending]
for code,name in [('U01','Customer / Onboarding and food'),('U06','Customer / Discover and order'),('U39','Customer / Passenger rides later'),('R01','Rider / Onboarding'),('R06','Rider / Food delivery'),('R27','Rider / Passenger rides later'),('P29','Merchant / Incoming orders'),('P02','Merchant / Counter sale'),('W01','Pay / Table ordering'),('W06','Pay Mobile / Checkout'),('WD01','Pay Desktop / Checkout'),('WD02','Pay Desktop / Ordering'),('WD14','Pay Desktop / Saved payment recovery'),('S11','POS Mobile / Order center')]:commands.append({'command':'proto.flow.add','params':{'start':frames[code]['id'],'name':name}})
cover=frames['A00'];commands += [{'command':'page.select','params':{'id':cover['parent']}},{'command':'select.set','params':{'ids':[cover['id']]}},{'command':'view.zoomSelection','params':{}}]
run('native-flows',commands)
(OUT/'handoff/native-components.json').write_text(json.dumps({'components':components,'linked_cta_instances':instances},ensure_ascii=False,indent=2)+'\n')
print('Native tokens, components, instances and interactive flows saved in the single master.')

# Apply reviewed navigation/copy/directory migration after every fresh base build.
subprocess.run(['python3',str(OUT/'source/repair_prototype.py')],check=True)
