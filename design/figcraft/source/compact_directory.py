#!/usr/bin/env python3
"""Split the tall prototype directory into readable section boards (live MCP)."""
import sys,json,hashlib,shutil,datetime,math,copy
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as E
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT.parents[1]/'tools/design'))
from figcraft_live import call
MASTER=ROOT/'BitPOS-Platform-UI.figcraft';ns='http://www.w3.org/2000/svg';E.register_namespace('',ns)
manifest=json.loads((ROOT/'handoff/screen-map.json').read_text());links=json.loads((ROOT/'handoff/interaction-map.json').read_text())
if any(s['id']=='N01' for s in manifest['screens']):print('Section directory already present');raise SystemExit(0)
state=call('inspect_ui');assert state['status']['path']==str(MASTER) and not state['status']['dirty']
backup=Path.home()/'.local/share/bitpos-design-backups'/('directory-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));backup.mkdir();shutil.copy2(MASTER,backup/MASTER.name);shutil.copytree(ROOT/'handoff',backup/'handoff');shutil.copytree(ROOT/'source/screens',backup/'screens')
doc=json.loads(ZipFile(MASTER).read('document.json'));nodes=doc['nodes'];cover=next(n for n in nodes.values() if n['name']=='A00-cover');tree=E.parse(ROOT/'source/screens/A00-cover.svg');root=tree.getroot()
def run(command,params):return call('run_command',{'command':command,'params':params})
def create(kind,parent,x,y,w,h,name,**props):
 params={'type':kind,'parent':parent,'x':x,'y':y,'width':w,'height':h,'name':name};params.update(props)
 result=run('node.create',params)
 return result['id']
def text(parent,x,y,w,h,value,size=20):return create('text',parent,x,y,w,h,value,text=value,props={'fontFamily':'Noto Sans Thai','fontSize':size,'fill':'#29183F'})
groups=[('user','Customer / Food & later rides'),('rider','Rider / Delivery & later rides'),('pos','POS Desktop & Mobile'),('pay-desktop','Pay Desktop'),('pay','Pay Mobile'),('states','Error, permission and responsive scenarios'),('system','Design system'),('guide','Developer handoff')]
commands=[]
for num,(surface,label) in enumerate(groups,1):
 code=f'N{num:02}';items=[s for s in manifest['screens'] if s['surface']==surface and s['id']!='A00'];height=max(1000,math.ceil(len(items)/4)*84+180)
 frame=create('frame',cover['parent'],1800+(num%2)*1800,(num//2)*1400,1600,height,code+'-directory',props={'fill':'#F8F5FC','cornerRadius':20})
 text(frame,48,28,1504,48,label,28)
 back=create('frame',frame,1330,28,220,48,'Back to start',props={'fill':'#64188A','cornerRadius':12});text(back,18,10,184,30,'กลับหน้าเริ่มต้น',16)
 commands.append({'command':'proto.interaction.add','params':{'id':back,'dest':cover['id']}})
 svg=E.Element('{'+ns+'}svg',{'width':'1600','height':str(height),'viewBox':f'0 0 1600 {height}'});E.SubElement(svg,'{'+ns+'}rect',{'width':'1600','height':str(height),'fill':'#F8F5FC'});E.SubElement(svg,'{'+ns+'}text',{'x':'48','y':'64','font-family':'Noto Sans Thai','font-size':'28','fill':'#29183F'}).text=label
 for i,s in enumerate(items):
  node=next(n for n in nodes.values() if n.get('name')=='Flow index / '+s['id']);x=48+(i%4)*382;y=124+(i//4)*84
  commands.extend([{'command':'node.reparent','params':{'ids':[node['id']],'parent':frame}},{'command':'node.set','params':{'ids':[node['id']],'x':x,'y':y}}])
  elem=next(e for e in list(root) if e.get('id')=='Flow-index-'+s['id']);root.remove(elem);rect=next(e for e in elem if e.tag.endswith('rect'));oldy=float(rect.get('y'));rect.set('x',str(x));rect.set('y',str(y));t=next(e for e in elem if e.tag.endswith('text'));t.set('x',str(x+14));t.set('y',str(y+40));svg.append(elem)
  link=next(l for l in links if l.get('name')=='Flow index / '+s['id']);link['source']=code;link['rect']=[x,y,358,72]
 path=f'source/screens/{code}-directory.svg';E.ElementTree(svg).write(ROOT/path,encoding='utf-8');manifest['screens'].append({'id':code,'slug':'directory','title':label+' directory','surface':'directory','kind':'directory','page':'00 - Start here','width':1600,'height':height,'source':path,'sha256':hashlib.sha256((ROOT/path).read_bytes()).hexdigest(),'phase':'food-first','fixture':True})
 cx=48+((num-1)%4)*382;cy=1100+((num-1)//4)*104;card=create('frame',cover['id'],cx,cy,358,84,'Section directory / '+code,props={'fill':'#EEE5F7','cornerRadius':14});text(card,14,16,330,52,label,18);commands.append({'command':'proto.interaction.add','params':{'id':card,'dest':frame}})
 g=E.SubElement(root,'{'+ns+'}g',{'id':'Directory-'+code});E.SubElement(g,'{'+ns+'}rect',{'x':str(cx),'y':str(cy),'width':'358','height':'84','rx':'14','fill':'#EEE5F7'});E.SubElement(g,'{'+ns+'}text',{'x':str(cx+14),'y':str(cy+42),'font-family':'Noto Sans Thai','font-size':'18','fill':'#29183F'}).text=label
 links.extend([{'source':'A00','name':'Section directory / '+code,'dest':code,'rect':[cx,cy,358,84]},{'source':code,'name':'Back to start','dest':'A00','rect':[1330,28,220,48]}])
# Delete old directory section titles; preserve artwork above1090.
for n in nodes.values():
 if n.get('parent')==cover['id'] and n['type']=='text' and n.get('transform',[0]*6)[5]>=1090:commands.append({'command':'edit.delete','params':{'ids':[n['id']]}})
for e in list(root):
 if e.tag.endswith('text') and float(e.get('y','0'))>=1090:root.remove(e)
height=1360;commands.append({'command':'node.set','params':{'ids':[cover['id']],'height':height}})
bg=next(nodes[str(i)] for i in cover['children'] if nodes[str(i)]['type']=='rectangle' and nodes[str(i)].get('width')==1600 and nodes[str(i)].get('height')==6262);commands.append({'command':'node.set','params':{'ids':[bg['id']],'height':height}})
root.set('height',str(height));root.set('viewBox',f'0 0 1600 {height}');next(e for e in root if e.tag.endswith('rect') and e.get('width')=='1600').set('height',str(height));tree.write(ROOT/'source/screens/A00-cover.svg',encoding='utf-8')
commands.extend([{'command':'proto.presentOptions','params':{'scale':'fit','hotspotHints':True}},{'command':'proto.present','params':{'start':cover['id']}}])
run('command.batch',{'label':'Readable section directories','commands':commands});run('file.save',{})
for s in manifest['screens']:
 if s['id']=='A00':s['height']=height
 s['sha256']=hashlib.sha256((ROOT/s['source']).read_bytes()).hexdigest()
(ROOT/'handoff/screen-map.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');(ROOT/'handoff/interaction-map.json').write_text(json.dumps(links,ensure_ascii=False,indent=2)+'\n')
report={'status':'APPLIED_PENDING_RENDER_REVIEW','backup':str(backup),'sectionDirectories':8,'coverHeight':height,'masterSha256':hashlib.sha256(MASTER.read_bytes()).hexdigest()};(ROOT/'reports/compact-directory-receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
