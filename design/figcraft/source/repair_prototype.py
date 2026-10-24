#!/usr/bin/env python3
"""Repair native/source prototype links and cover directory, without rebuilding artwork."""
import json,subprocess,hashlib,shutil,datetime,math
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as E
ROOT=Path(__file__).resolve().parents[1];MASTER=ROOT/'BitPOS-Platform-UI.figcraft';CLI=Path.home()/'.local/bin/figcraft-cli'
backup=Path.home()/'.local/share/bitpos-design-backups'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S');backup.mkdir(parents=True)
shutil.copy2(MASTER,backup/MASTER.name);shutil.copytree(ROOT/'source/screens',backup/'screens');shutil.copytree(ROOT/'handoff',backup/'handoff')
with ZipFile(MASTER) as z:doc=json.loads(z.read('document.json'))
nodes=doc['nodes']
if any(n.get('name')=='Flow index / U01' for n in nodes.values()):
 print('Prototype repair already present; master preserved. Rebuild base before reapplying this migration.');raise SystemExit(0)
manifest=json.loads((ROOT/'handoff/screen-map.json').read_text());screens=manifest['screens'];links=json.loads((ROOT/'handoff/interaction-map.json').read_text())
frames={n['name'].split('-')[0]:n for n in nodes.values() if n['type']=='frame' and any(s['id']==n['name'].split('-')[0] for s in screens)}
commands=[];changes=[];ns='http://www.w3.org/2000/svg';E.register_namespace('',ns);E.register_namespace('xlink','http://www.w3.org/1999/xlink')
svg={s['id']:E.parse(ROOT/s['source']) for s in screens}
def descend(i):
 yield nodes[str(i)]
 for c in nodes[str(i)].get('children',[]):yield from descend(c)
def command(name,params):commands.append({'command':name,'params':params});return len(commands)-1
def named(code,name):return next((n for n in descend(frames[code]['id']) if n.get('name')==name),None)
def replace_text(code,old,new):
 for n in descend(frames[code]['id']):
  if n.get('characters')==old:command('node.set',{'ids':[n['id']],'text':new})
 for n in svg[code].getroot().iter():
  if n.tag.endswith('text') and n.text==old:n.text=new
 changes.append({'screen':code,'text':old,'replacement':new})
def button(code,index,dest=None,label=None,action=None):
 buttons=[l for l in links if l['source']==code and (l.get('name') or '').startswith('button')];l=buttons[index];n=named(code,l['name'])
 if not n:raise RuntimeError('Missing button '+str(l))
 if dest:l['dest']=dest
 if action:l['action']=action
 target=action or {'type':'navigate','dest':frames[dest]['id']}
 command('proto.interaction.clear',{'ids':[n['id']]});command('proto.interaction.add',{'id':n['id'],'action':target})
 if label:
  if n['type']=='instance':command('instance.setProperties',{'ids':[n['id']],'properties':{'Label':label}})
  else:
   text=next(v for v in descend(n['id']) if v['type']=='text');command('node.set',{'ids':[text['id']],'text':label})
  group=next((g for g in svg[code].getroot().iter() if g.get('id')==l['name']),None)
  if group is not None:
   text=next(t for t in group.iter() if t.tag.endswith('text'));text.text=label
 changes.append({'screen':code,'button':l['name'],'destination':dest,'action':action,'label':label})
# Back follows prototype history rather than jumping across product boundaries.
for code in frames:
 n=named(code,'back')
 if n:
  command('proto.interaction.clear',{'ids':[n['id']]});command('proto.interaction.add',{'id':n['id'],'action':{'type':'back'}})
  for l in links:
   if l['source']==code and l.get('name')=='back':l['action']={'type':'back'}
# Correct repeat-purchase, saved-payment and passenger/food context errors.
button('A00',0,'U01');button('A00',1,'R01');button('A00',2,'P39')
button('U22',0,'U20','ติดตามการจัดส่ง')
button('U37',0,'U22','ตรวจสอบออเดอร์แยกตามร้าน')
button('U38',1,'U15','ตรวจสอบตัวเลือกรับเอง')
button('U43',0,'U39');button('U43',1,'U39','กลับหน้าเรียกรถ')
button('R31',0,'R27')
button('WD02',-1,'WD24');button('WD01',-1,'WD03','เชื่อมต่อกระเป๋าเงิน')
button('WD03',-1,'WD04','เลือกสินทรัพย์ที่รองรับ');button('WD04',-1,'WD06','ยืนยันสินทรัพย์ที่เลือก')
button('WD05',-1,'WD14');button('WD12',-1,'WD14');button('WD13',-1,'WD14');button('WD20',-1,'WD14')
button('WD16',-1,'WD26');button('WD18',-1,'WD10','ดูหลักฐานรายการเดิม')
# Locked states keep header menu action inside recovery instead of opening a new bill.
for code in ['WD05','WD06','WD07','WD08','WD12','WD13','WD14']:
 button(code,0,'WD14','ตรวจรายการเดิม')
replace_text('U24','ยังไม่ได้เริ่มเตรียมอาหาร','ขอให้ทีมช่วยตรวจสอบ')
replace_text('U43','ขอบคุณที่เดินทางด้วยกัน','ขอบคุณที่เดินทางด้วยกัน')
replace_text('U43','ออเดอร์ #BP1024 · ฿205','เที่ยว #RIDE1024 · ฿149')
replace_text('U43','อาหารอร่อย ไรเดอร์ส่งไว...','เล่าประสบการณ์การเดินทาง...')
replace_text('R31','งานนี้ส่งสำเร็จแล้ว','ถึงจุดหมายเรียบร้อยแล้ว');replace_text('R31','฿55','฿129')
for n in list(descend(frames['WD21']['id'])):
 if n.get('characters') and 'USDG' in n['characters']:replace_text('WD21',n['characters'],n['characters'].replace('USDG','USDC'))
# Move order tracking above the navigation and expose the genuine detail subflows.
l=next(l for l in links if l['source']=='U22' and (l.get('name') or '').startswith('button'))
n=named('U22',l['name']);command('node.set',{'ids':[n['id']],'y':686});old_y=l['rect'][1];l['rect'][1]=686
g=next(g for g in svg['U22'].getroot().iter() if g.get('id')==l['name'])
for e in g.iter():
 if e.get('y') is not None:e.set('y',str(float(e.get('y'))+686-old_y))
# The R27 sheet covers the old footer: remove invisible footer hotspots stealing offer clicks.
remove=[]
for l in links:
 if l['source']=='R27' and not l.get('name') and l['rect'][1]==758:
  for n in descend(frames['R27']['id']):
   if n.get('name')==f'Hotspot / R27 to {l["dest"]}':command('proto.interaction.clear',{'ids':[n['id']]})
  remove.append(l)
links=[l for l in links if l not in remove]
# Native modal success explains that a cancellation review is NOT a refund/cancellation.
page=next(n for n in nodes.values() if n['type']=='page' and n['name'].startswith('50 -'))
def overlay(code,title,body):
 frame_idx=command('node.create',{'type':'frame','parent':page['id'],'x':7200,'y':len(changes)*25,'width':342,'height':280,'name':code+'-prototype-overlay','props':{'fill':'#FFFFFF','cornerRadius':24}})
 frame={'$step':frame_idx}
 command('node.create',{'type':'text','parent':frame,'x':24,'y':24,'width':294,'height':48,'text':title,'props':{'fontFamily':'Noto Sans Thai','fontSize':20,'fontWeight':600,'fill':'#29183F'}})
 command('node.create',{'type':'text','parent':frame,'x':24,'y':86,'width':294,'height':100,'text':body,'props':{'fontFamily':'Noto Sans Thai','fontSize':14,'fill':'#29183F'}})
 btn=command('node.create',{'type':'frame','parent':frame,'x':24,'y':208,'width':294,'height':48,'name':'Close overlay','props':{'fill':'#64188A','cornerRadius':14}})
 command('node.create',{'type':'text','parent':{'$step':btn},'x':100,'y':12,'width':100,'height':26,'text':'กลับไปดูต่อ','props':{'fontFamily':'Noto Sans Thai','fontSize':15,'fill':'#FFFFFF'}})
 command('proto.interaction.add',{'id':{'$step':btn},'action':{'type':'closeOverlay'}})
 return doc['next_id'] + sum(c['command']=='node.create' for c in commands) - 5
share=overlay('Overlay-Group','ตัวอย่างคำเชิญกลุ่ม','ตัวอย่างลิงก์กลุ่ม BitPOS\nไม่มีการแชร์หรือส่งข้อความจริง\nปิดหน้าต่างเพื่อกลับไปดูสมาชิก')
review=overlay('Overlay-Review','บันทึกคำขอตรวจสอบ','แบบจำลองเท่านั้น\nออร์เดอร์ยังไม่ถูกยกเลิก\nยังไม่มีการคืนเงินหรือปล่อยงานไรเดอร์')
button('U36',0,action={'type':'openOverlay','dest':share,'position':'center'})
button('U24',0,label='ส่งคำขอให้ตรวจสอบ',action={'type':'openOverlay','dest':review,'position':'center'})
# Explicit entry points from order detail, without making a new order.
for x,dest,label in [(24,'U24','ขอยกเลิก'),(138,'U25','คืนเงิน'),(252,'U31','รีวิว')]:
 idx=command('node.create',{'type':'frame','parent':frames['U22']['id'],'x':x,'y':632,'width':104,'height':44,'name':'Detail / '+dest,'props':{'fill':'#FFFFFF','cornerRadius':12,'stroke':'#E9E1F1'}})
 command('node.create',{'type':'text','parent':{'$step':idx},'x':8,'y':12,'width':88,'height':24,'text':label,'props':{'fontFamily':'Noto Sans Thai','fontSize':13,'fill':'#64188A','textAlign':'center'}})
 command('proto.interaction.add',{'id':{'$step':idx},'dest':frames[dest]['id']})
 el=E.SubElement(svg['U22'].getroot(),'{'+ns+'}g',{'id':'Detail-'+dest});E.SubElement(el,'{'+ns+'}rect',{'x':str(x),'y':'632','width':'104','height':'44','rx':'12','fill':'#FFFFFF','stroke':'#E9E1F1'});E.SubElement(el,'{'+ns+'}text',{'x':str(x+52),'y':'660','font-family':'Noto Sans Thai','font-size':'13','text-anchor':'middle','fill':'#64188A'}).text=label
 links.append({'source':'U22','name':'Detail / '+dest,'dest':dest,'rect':[x,632,104,44]})
# Cover: scrollable, clearly separated directory of every original screen and state.
cover=frames['A00'];y=1090;groups=[('user','Customer / Food & later rides'),('rider','Rider / Delivery & later rides'),('pos','POS Desktop'),('pay-desktop','Pay Desktop'),('pay','Pay Mobile'),('states','Error, permission and responsive scenarios'),('system','Design system'),('guide','Developer handoff')]
for surface,label in groups:
 items=[s for s in screens if s['surface']==surface and s['id']!='A00']
 command('node.create',{'type':'text','parent':cover['id'],'x':48,'y':y,'width':1504,'height':40,'text':label,'props':{'fontFamily':'Noto Sans Thai','fontSize':24,'fontWeight':600,'fill':'#64188A'}})
 E.SubElement(svg['A00'].getroot(),'{'+ns+'}text',{'x':'48','y':str(y+28),'font-family':'Noto Sans Thai','font-size':'24','fill':'#64188A'}).text=label
 y+=60
 for i,item in enumerate(items):
  x=48+(i%4)*382;cy=y+(i//4)*84;name='Flow index / '+item['id']
  idx=command('node.create',{'type':'frame','parent':cover['id'],'x':x,'y':cy,'width':358,'height':72,'name':name,'props':{'fill':'#FFFFFF','cornerRadius':14,'stroke':'#E9E1F1'}})
  command('node.create',{'type':'text','parent':{'$step':idx},'x':14,'y':10,'width':330,'height':52,'text':item['id']+' · '+item['title'],'props':{'fontFamily':'Noto Sans Thai','fontSize':14,'fill':'#29183F'}})
  command('proto.interaction.add',{'id':{'$step':idx},'dest':frames[item['id']]['id']})
  g=E.SubElement(svg['A00'].getroot(),'{'+ns+'}g',{'id':'Flow-index-'+item['id']});E.SubElement(g,'{'+ns+'}rect',{'x':str(x),'y':str(cy),'width':'358','height':'72','rx':'14','fill':'#FFFFFF','stroke':'#E9E1F1'});E.SubElement(g,'{'+ns+'}text',{'x':str(x+14),'y':str(cy+40),'font-family':'Noto Sans Thai','font-size':'14','fill':'#29183F'}).text=item['id']+' · '+item['title']
  links.append({'source':'A00','name':name,'dest':item['id'],'rect':[x,cy,358,72]})
 y+=math.ceil(len(items)/4)*84+48
height=y+24;command('node.set',{'ids':[cover['id']],'height':height})
background=next(n for n in descend(cover['id']) if n['type']=='rectangle' and n.get('width')==1600 and n.get('height')==1000);command('node.set',{'ids':[background['id']],'height':height})
root=svg['A00'].getroot();root.set('height',str(height));root.set('viewBox',f'0 0 1600 {height}');next(e for e in root if e.tag.endswith('rect') and e.get('width')=='1600').set('height',str(height))
next(s for s in screens if s['id']=='A00')['height']=height
command('proto.presentOptions',{'scale':'fitWidth','hotspotHints':True})
command('page.select',{'id':cover['parent']});command('select.set',{'ids':[cover['id']]});command('view.zoomSelection',{})
# Installed0.6.0 does not resolve $step like newer upstream. Use concrete IDs.
predicted={};next_id=doc['next_id']
for step,item in enumerate(commands):
 if item['command']=='node.create':predicted[step]=next_id;next_id+=1
def resolve(value):
 if isinstance(value,dict):
  if '$step' in value:return predicted[value['$step']]
  return {key:resolve(child) for key,child in value.items()}
 if isinstance(value,list):return [resolve(child) for child in value]
 return value
commands=resolve(commands)
commandfile=ROOT/'reports/prototype-repair-commands.json';commandfile.write_text(json.dumps(commands,ensure_ascii=False,indent=2)+'\n')
r=subprocess.run([str(CLI),'run',str(commandfile),'--in',str(MASTER),'--out',str(MASTER)],capture_output=True,text=True,timeout=180)
(ROOT/'reports/prototype-repair-results.jsonl').write_text(r.stdout)
if r.returncode:raise RuntimeError(r.stderr[-2000:]+' '+r.stdout[-1200:])
for row in map(json.loads,r.stdout.splitlines()):
 if row.get('step') in predicted and row.get('ok'):
  assert row['result']['id']==predicted[row['step']], 'Allocated ID differs from predicted native ID'
for s in screens:
 svg[s['id']].write(ROOT/s['source'],encoding='utf-8',xml_declaration=False);s['sha256']=hashlib.sha256((ROOT/s['source']).read_bytes()).hexdigest()
(ROOT/'handoff/screen-map.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(ROOT/'handoff/interaction-map.json').write_text(json.dumps(links,ensure_ascii=False,indent=2)+'\n')
report={'status':'APPLIED_PENDING_RENDER_AND_PRESENTER_REVIEW','backup':str(backup),'commands':len(commands),'originalBoards':len(screens),'coverHeight':height,'changes':changes,'newMasterSha256':hashlib.sha256(MASTER.read_bytes()).hexdigest(),'limits':['No runtime/backend changes','Coverage alone is not semantic or visual acceptance','Prototype overlays simulate messages; no real sharing/cancellation/payment']}
(ROOT/'reports/prototype-repair-receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='changes'},indent=2))
