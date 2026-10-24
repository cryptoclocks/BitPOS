#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Repair inspected copy, orphan Thai lines and contrast in the current native master."""
import sys,json,zipfile,hashlib,datetime,shutil,xml.etree.ElementTree as E
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT.parents[1]/'tools/design'));from figcraft_live import call
m=ROOT/'BitPOS-Platform-UI.figcraft';ns=json.loads(zipfile.ZipFile(m).read('document.json'))['nodes'];manifest=json.loads((ROOT/'handoff/screen-map.json').read_text());frames={n['name'].split('-')[0]:n for n in ns.values() if n['type']=='frame'}
def walk(v):
 yield v
 for i in v.get('children',[]):yield from walk(ns[str(i)])
changes={'U14':{'เลื่อนแผนที่ให้หมุดตรงกับจุดส่งอาหา':'เลื่อนหมุดให้ตรงจุดส่งอาหาร','ร':None},'S01':{'เลือกเมนูที่ชอบ แล้วเริ่มมื้ออร่อย':'เลือกเมนู แล้วเริ่มมื้ออร่อย','กัน':None},'S02':{'ลองเปลี่ยนคำค้นหรือขยายพื้นที่จัดส':'ลองเปลี่ยนคำค้น','่ง':'หรือขยายพื้นที่จัดส่ง'},'S09':{'นำรายการที่หมดออก แล้วตรวจยอดอีกคร':'นำรายการที่หมดออก','ั้ง':'แล้วตรวจยอดอีกครั้ง'},'WD14':{'ตรวจรายการเดิม โดยไม่ลงนามหรือสร้างคำขอใหม':'ตรวจรายการเดิม ไม่สร้างคำขอใหม่','่':None},'WD23':{'ตรวจราคาและตัวเลือกอีกครั้งก่อนเพิ่':'ตรวจราคาและตัวเลือกก่อนเพิ่ม','ม':None,'ราคาอาจเปลี่ยนตามตัวเลือกที่คุณเลือ':'ราคาอาจเปลี่ยนตามตัวเลือก'},'R17':{'฿3,420':'฿680'},'R18':{'฿3,420':'฿680'},'R30':{'บ้าน · สุขุมวิท 49':'EmQuartier · จุดส่งผู้โดยสาร'},'W22':{'ส่งฟรีใกล้บ้าน':'ส่งฟรี · สำหรับจัดส่ง','ดูเงื่อนไขร้านที่ร่วมรายการ':'ใช้กับรายการที่โต๊ะไม่ได้'}}
if any(n.get('name')=='Logo contrast plate' and n.get('parent')==frames['P39']['id'] for n in ns.values()):raise SystemExit('Polish already applied; native master preserved')
commands=[];applied=[]
E.register_namespace('','http://www.w3.org/2000/svg')
for code,entries in changes.items():
 screen=next(s for s in manifest['screens'] if s['id']==code);p=ROOT/screen['source'];tree=E.parse(p)
 for old,new in entries.items():
  for n in walk(frames[code]):
   if n.get('characters')==old:
    commands.append({'command':'edit.delete','params':{'ids':[n['id']]}} if new is None else {'command':'node.set','params':{'ids':[n['id']],'text':new}});applied.append({'screen':code,'old':old,'new':new})
  for parent in tree.getroot().iter():
   for child in list(parent):
    if child.tag.endswith('text') and child.text==old:
     if new is None:parent.remove(child)
     else:child.text=new
 tree.write(p,encoding='utf-8');screen['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
# Shared payment-state labels preserve the chosen asset through all desktop views.
variables=json.loads((ROOT/'reports/payment-asset-prototype.json').read_text())['variables']
for code,f in frames.items():
 if not code.startswith('WD'):continue
 for n in walk(f):
  v=n.get('characters');key='summary' if v=='Test USDG · 0.170000' else 'receipt' if v=='0.170000 USDG' else 'symbol' if v=='USDG' else None
  if key:commands.append({'command':'variable.bind','params':{'ids':[n['id']],'field':'characters','variable':variables[key]}})
# Correct passenger identifiers without relabelling food work.
for code in ['R28','R29','R31']:
 f=frames[code];screen=next(s for s in manifest['screens'] if s['id']==code);p=ROOT/screen['source'];tree=E.parse(p)
 for n in walk(f):
  old=n.get('characters','')
  if '#BP1024' in old:
   new=old.replace('#BP1024','#RIDE1024');commands.append({'command':'node.set','params':{'ids':[n['id']],'text':new}})
   for e in tree.getroot().iter():
    if e.tag.endswith('text') and e.text==old:e.text=new
 tree.write(p,encoding='utf-8');screen['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
backup=Path.home()/'.local/share/bitpos-design-backups'/('polish-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));backup.mkdir();shutil.copy2(m,backup/m.name)
call('run_command',{'command':'command.batch','params':{'label':'Inspected Thai copy and payment-state polish','commands':commands}})
# White plate keeps the dark merchant logo readable on the purple login hero.
f=frames['P39'];plate=call('run_command',{'command':'node.create','params':{'type':'rectangle','parent':f['id'],'x':62,'y':46,'width':210,'height':80,'name':'Logo contrast plate','props':{'fill':'#FFFFFF','cornerRadius':12}}})['id'];call('run_command',{'command':'node.reparent','params':{'ids':[plate],'parent':f['id'],'index':2}})
call('run_command',{'command':'file.save','params':{}})
(ROOT/'handoff/screen-map.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');(ROOT/'reports/prototype-polish.json').write_text(json.dumps({'masterSha256':hashlib.sha256(m.read_bytes()).hexdigest(),'backup':str(backup),'changes':applied,'commands':len(commands),'limits':['Fixture amounts only; no financial records changed','Broad montage inspection is not full-size pixel certification']},ensure_ascii=False,indent=2)+'\n');print('Applied',len(commands),'commands')
