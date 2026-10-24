#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Replace duplicated mobile list artwork with a dedicated merchant order detail."""
import sys,json,hashlib,shutil,datetime,zipfile,xml.etree.ElementTree as E
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT.parents[1]/'tools/design'));from figcraft_live import call
m=ROOT/'BitPOS-Platform-UI.figcraft';doc=json.loads(zipfile.ZipFile(m).read('document.json'));ns=doc['nodes'];frames={n['name'].split('-')[0]:n for n in ns.values() if n['type']=='frame'};f=frames['S12']
if any(n.get('name')=='Merchant mobile order body' for n in ns.values()):raise SystemExit('Dedicated merchant detail already applied')
backup=Path.home()/'.local/share/bitpos-design-backups'/('pos-mobile-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));backup.mkdir();shutil.copy2(m,backup/m.name)
def run(c,p):return call('run_command',{'command':c,'params':p})
def create(kind,parent,x,y,w,h,name,text=None,props=None):
 p={'type':kind,'parent':parent,'x':x,'y':y,'width':w,'height':h,'name':name,'props':props or {}}
 if text is not None:p['text']=text
 return run('node.create',p)['id']
run('edit.delete',{'ids':f['children']});xmlns='http://www.w3.org/2000/svg';E.register_namespace('',xmlns);svg=E.Element('{'+xmlns+'}svg',{'width':'390','height':'844','viewBox':'0 0 390 844'})
def rect(x,y,w,h,fill='#FFFFFF',radius=14,name='Card'):
 i=create('rectangle',f['id'],x,y,w,h,name,props={'fill':fill,'cornerRadius':radius});E.SubElement(svg,'{'+xmlns+'}rect',{'x':str(x),'y':str(y),'width':str(w),'height':str(h),'rx':str(radius),'fill':fill});return i
def text(x,y,w,h,value,size=14,color='#29183F',weight=400,name=None):
 i=create('text',f['id'],x,y,w,h,name or value,text=value,props={'fontFamily':'Noto Sans Thai','fontSize':size,'fontWeight':weight,'fill':color});E.SubElement(svg,'{'+xmlns+'}text',{'x':str(x),'y':str(y+size),'font-family':'Noto Sans Thai','font-size':str(size),'font-weight':str(weight),'fill':color}).text=value;return i
rect(0,0,390,844,'#F8F5FC',0,'Merchant mobile order body');text(24,12,48,24,'9:41',13,weight=600)
back=rect(18,52,44,44,name='back');text(30,58,24,28,'‹',24);text(76,59,290,32,'ออเดอร์ #BP1024',20,weight=600);run('proto.interaction.add',{'id':back,'action':{'type':'back'}})
rect(24,112,116,32,'#EEE5F7',16);text(38,118,100,24,'แอพจัดส่ง · ใหม่',12)
rect(152,112,104,32,'#E5F5ED',16);text(166,118,90,24,'ชำระแล้ว',12,'#087C59')
rect(24,164,342,128)
text(40,179,238,26,'Iced latte · Oat milk × 1',14,weight=600);text(308,179,48,26,'฿95',14,'#64188A',600);text(40,207,270,22,'หวาน 25% · นมโอ๊ต',12,'#81758E')
text(40,240,238,26,'Butter croissant × 1',14,weight=600);text(308,240,48,26,'฿75',14,'#64188A',600)
for j,(label,value) in enumerate([('ค่าอาหาร','฿170'),('ค่าจัดส่ง','฿35'),('ส่วนลด','−฿20'),('ค่าบริการ','฿20')]):text(24,314+j*27,240,24,label,14,'#81758E');text(314,314+j*27,52,24,value,14)
rect(24,431,342,1,'#E9E1F1',0);text(24,448,230,30,'ยอดรวม',17,weight=600);text(300,444,66,36,'฿205',22,'#64188A',600)
rect(24,502,342,106);text(40,516,300,25,'บ้าน · สุขุมวิท 49',15,weight=600);text(40,549,300,25,'วางที่โต๊ะรับของหน้าประตู',13,'#81758E');text(40,579,300,22,'ยังไม่เริ่มจัดคนส่ง · รอร้านรับออเดอร์',12,'#81758E')
text(24,632,342,25,'เวลาเตรียมโดยประมาณ · 15 นาที',14)
text(24,666,342,22,'ข้อมูลตัวอย่างสำหรับทดสอบการกดเท่านั้น',11,'#81758E')
button=rect(24,708,342,52,'#64188A',14,'Accept merchant order');text(70,720,270,28,'รับออเดอร์ · เตรียม 15 นาที',15,'#FFFFFF',600)
# Reviewable local confirmation; no fabricated runtime acceptance.
page=next(n for n in ns.values() if n['type']=='page' and n['name'].startswith('50 -'));overlay=create('frame',page['id'],8600,1200,342,280,'Overlay-Merchant-prototype-overlay',props={'fill':'#FFFFFF','cornerRadius':24})
create('text',overlay,24,24,294,50,'Title',text='ตัวอย่างการรับออเดอร์',props={'fontFamily':'Noto Sans Thai','fontSize':20,'fill':'#29183F'})
create('text',overlay,24,86,294,100,'Disclosure',text='แบบจำลองการรับออเดอร์\nในแอพจริงต้องรอผลยืนยันจากร้าน\nPrototype นี้ไม่เปลี่ยนข้อมูลจริง',props={'fontFamily':'Noto Sans Thai','fontSize':14,'fill':'#29183F'})
close=create('frame',overlay,24,208,294,48,'Close overlay',props={'fill':'#64188A','cornerRadius':14});create('text',close,82,12,170,28,'Close label',text='กลับไปดูรายการ',props={'fontFamily':'Noto Sans Thai','fontSize':15,'fill':'#FFFFFF'});run('proto.interaction.add',{'id':close,'action':{'type':'closeOverlay'}});run('proto.interaction.add',{'id':button,'action':{'type':'openOverlay','dest':overlay,'position':'center'}})
# The first mobile order opens this mobile detail, never desktop P31.
for n in ns.values():
 if n.get('parent')==frames['S11']['id'] and n.get('name')=='Hotspot / S11 to P31':run('proto.interaction.clear',{'ids':[n['id']]});run('proto.interaction.add',{'id':n['id'],'dest':f['id']})
run('file.save',{})
manifest=json.loads((ROOT/'handoff/screen-map.json').read_text());s=next(s for s in manifest['screens'] if s['id']=='S12');p=ROOT/s['source'];E.ElementTree(svg).write(p,encoding='utf-8');s['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();(ROOT/'handoff/screen-map.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
links=json.loads((ROOT/'handoff/interaction-map.json').read_text());links=[l for l in links if l['source']!='S12']
for l in links:
 if l['source']=='S11' and l.get('dest')=='P31':l['dest']='S12'
links.extend([{'source':'S12','name':'back','action':{'type':'back'},'rect':[18,52,44,44]},{'source':'S12','name':'Accept merchant order','action':{'type':'openOverlay','dest':overlay,'position':'center'},'rect':[24,708,342,52]}]);(ROOT/'handoff/interaction-map.json').write_text(json.dumps(links,ensure_ascii=False,indent=2)+'\n')
(ROOT/'reports/pos-mobile-detail-repair.json').write_text(json.dumps({'masterSha256':hashlib.sha256(m.read_bytes()).hexdigest(),'backup':str(backup),'limits':['Design fixture only; no real order accepted','Native mobile detail now distinct from list/desktop']},indent=2)+'\n');print('S12 detail and S11 mobile navigation repaired')
