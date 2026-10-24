#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Original editable BitPOS UI artwork. Never reads runtime data or modifies product code."""
from pathlib import Path
from html import escape as E
import base64, json, shutil, subprocess, hashlib, math

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'design/figcraft'; SCREENS=OUT/'source/screens'
CLI=Path.home()/'.local/bin/figcraft-cli'
for d in [SCREENS,OUT/'assets',OUT/'previews',OUT/'reports',OUT/'handoff']:d.mkdir(parents=True,exist_ok=True)
C={'primary':'#64188A','action':'#7145D6','orange':'#FF8500','orangeInk':'#A94800','ink':'#29183F','muted':'#7B7088','bg':'#F8F5FC','white':'#FFFFFF','line':'#E9E1F1','tint':'#EFE6F8','peach':'#FFF0DF','green':'#217657','greenbg':'#E8F5ED','red':'#B63E50','redbg':'#FCECEF','blue':'#446A9F','bluebg':'#EBF1FB','dark':'#21152D'}
TOKENS={'color':C,'font':{'thai':'Noto Sans Thai','latin':'Inter'},'spacing':[4,8,12,16,20,24,32,40,48,64],'radius':{'control':14,'card':20,'sheet':28},'mobile':{'width':390,'height':844,'safe_top':44,'safe_bottom':34,'margin':24,'touch_min':48},'desktop':{'width':1440,'height':1000,'sidebar':232,'margin':32},'motion':{'functional_ms':180,'sheet_ms':240,'reduced_motion':'instant'},'version':'1.0.0','status':'design specification; all records are fictional fixtures'}
(OUT/'handoff/tokens.json').write_text(json.dumps(TOKENS,ensure_ascii=False,indent=2)+'\n')
PHOTO={}
for n in ['latte','espresso','iced-latte','matcha','croissant']:
 p=ROOT/f'asset-pack/menu/{n}.jpg';shutil.copy2(p,OUT/f'assets/{n}.jpg');PHOTO[n]='data:image/jpeg;base64,'+base64.b64encode(p.read_bytes()).decode()
logo=ROOT/'asset-pack/brand/bitpos-logo-large.png';shutil.copy2(logo,OUT/'assets/bitpos-logo.png')
LOGO='data:image/png;base64,'+base64.b64encode(logo.read_bytes()).decode()
ICON={
'back':'M15 5 8 12l7 7','chevron':'m9 5 7 7-7 7','search':'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
'home':'m3 10 9-7 9 7v10H3z M9 20v-7h6v7','orders':'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
'heart':'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15z',
'user':'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a8 8 0 0 1 16 0v3',
'pin':'M19 9c0 6-7 12-7 12S5 15 5 9a7 7 0 0 1 14 0z M14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
'bell':'M5 17h14l-2-4V8a5 5 0 0 0-10 0v5z M10 21h4',
'cart':'M2 4h3l3 12h10l3-9H6 M10 21h.01 M18 21h.01',
'clock':'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 3',
'check':'m5 12 4 4L20 5','plus':'M12 5v14 M5 12h14','minus':'M5 12h14',
'filter':'M4 6h16 M7 12h10 M10 18h4','star':'m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z',
'coffee':'M4 8h13v10H4z M17 9h3v6h-3 M3 22h16 M7 2v3 M12 2v3',
'bike':'M8 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M24 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 17l5-9 5 9H4 M9 8h8l3 9 M8 4h4 M15 4h3l2 5',
'car':'M4 10 7 4h10l3 6v10h-3v-3H7v3H4z M4 10h16 M7 13h1 M16 13h1',
'wallet':'M3 6h18v15H3z M3 6V3h15 M16 12h5v5h-5z',
'chat':'M3 3h18v14H9l-6 4z M7 8h10 M7 12h7',
'shield':'m12 2 8 4v7c0 4-8 9-8 9s-8-5-8-9V6z m-4 10 3 3 5-6',
'settings':'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
'box':'m3 7 9-4 9 4v13l-9 3-9-3z M3 7l9 4 9-4 M12 11v12',
'chart':'M3 3v18h18 M7 16v-5 M12 16V7 M17 16V4',
'card':'M2 5h20v15H2z M2 10h20 M6 16h4','qr':'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h3v3h3v3h-6z',
'cross':'m6 6 12 12 M18 6 6 18','refresh':'M20 7V2l-4 4 M20 7a9 9 0 1 0 1 9','arrow':'M4 12h16 m-6-6 6 6-6 6','mail':'M2 5h20v14H2z M2 5l10 8L22 5','phone':'M5 3 2 7c2 8 7 13 15 15l4-3-5-5-3 2-5-5 2-3z','logout':'M10 3H3v18h7 M8 12h14 m-5-5 5 5-5 5'
}

class SVG:
 def __init__(self,w,h,bg=None):self.w=w;self.h=h;self.a=[];self.i=0;self.links=[];self.rect(0,0,w,h,bg or C['bg'],r=0)
 def rect(self,x,y,w,h,fill=None,r=16,stroke=None,name=None):
  self.a.append(f'<rect'+(f' id="{E(name)}"' if name else '')+f' x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or C["white"]}"'+(f' stroke="{stroke}" stroke-width="1"' if stroke else '')+'/>')
 def line(self,x,y,x2,y2,c=None,width=1):self.a.append(f'<path d="M{x} {y} L{x2} {y2}" fill="none" stroke="{c or C["line"]}" stroke-width="{width}"/>')
 def text(self,x,y,s,size=16,c=None,weight=400,anchor='start'):
  self.a.append(f'<text x="{x}" y="{y}" font-family="Noto Sans Thai" font-size="{size}" font-weight="{weight}" fill="{c or C["ink"]}" text-anchor="{anchor}">{E(str(s))}</text>')
 def wrap(self,x,y,s,maxchars=35,size=15,c=None,lines=3):
  words=[]
  for para in s.split('\n'):
   while len(para)>maxchars:
    k=para.rfind(' ',0,maxchars+1);k=k if k>maxchars//2 else maxchars;words.append(para[:k]);para=para[k:].lstrip()
   words.append(para)
  for i,t in enumerate(words[:lines]):self.text(x,y+i*size*1.65,t,size,c)
  return y+min(len(words),lines)*size*1.65
 def icon(self,n,x,y,size=22,c=None):self.a.append(f'<g transform="translate({x} {y}) scale({size/24})"><path d="{ICON.get(n,ICON["box"])}" fill="none" stroke="{c or C["primary"]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>')
 def photo(self,n,x,y,w,h,r=16):
  self.i+=1;k=f'clip{self.i}';self.a.append(f'<defs><clipPath id="{k}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}"/></clipPath></defs><image x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice" href="{PHOTO[n]}" clip-path="url(#{k})"/>')
 def logo(self,x,y,w=110):self.a.append(f'<image x="{x}" y="{y}" width="{w}" height="{w/3}" href="{LOGO}"/>')
 def pill(self,x,y,s,color='primary',w=None):
  w=w or max(64,len(s)*7.8+26);bg={'primary':'tint','orange':'peach','green':'greenbg','red':'redbg','blue':'bluebg'}.get(color,'tint');self.rect(x,y,w,30,C[bg],r=15);self.text(x+w/2,y+21,s,12,C['orangeInk'] if color=='orange' else C[color],600,'middle');return w
 def btn(self,x,y,w,s,dest=None,style='primary',icon=None,h=52,name=None):
  name=name or f'button-{len(self.links)}-{len(self.a)}';self.a.append(f'<g id="{name}">');fill=C['primary'] if style=='primary' else C['tint'] if style=='secondary' else C['redbg'] if style=='danger' else C['white'];color=C['white'] if style=='primary' else C['red'] if style=='danger' else C['primary'];self.rect(x,y,w,h,fill,14,C['line'] if style=='outline' else None);self.text(x+w/2+(12 if icon else 0),y+h/2+6,s,15,color,600,'middle')
  if icon:self.icon(icon,x+18,y+h/2-11,22,color)
  self.a.append('</g>')
  if dest:self.links.append({'name':name,'dest':dest,'rect':[x,y,w,h]})
 def field(self,x,y,w,label,value='',hint=None,icon=None):
  self.a.append(f'<g id="Field-{len(self.a)}">');self.text(x,y,label,13,C['muted'],500);self.rect(x,y+12,w,52,C['white'],14,C['line']);self.text(x+16+(28 if icon else 0),y+45,value or hint or 'กรอกข้อมูล',15,C['ink'] if value else C['muted'])
  if icon:self.icon(icon,x+14,y+27,21,C['muted'])
  self.a.append('</g>')
 def cardrow(self,x,y,w,title,sub='',icon='box',right='',dest=None,photo=None):
  self.a.append(f'<g id="Card-{len(self.a)}">');self.rect(x,y,w,82,C['white'],18,C['line']);offset=16
  if photo:self.photo(photo,x+12,y+11,60,60,13);offset=86
  elif icon:self.rect(x+14,y+18,44,44,C['tint'],13);self.icon(icon,x+25,y+29);offset=72
  self.text(x+offset,y+31,title,15,weight=600)
  if sub:self.text(x+offset,y+55,sub,12,C['muted'])
  if right:self.text(x+w-15,y+48,right,14,C['primary'],600,'end')
  elif dest:self.icon('chevron',x+w-30,y+29,18,C['muted'])
  if dest:self.links.append({'name':None,'dest':dest,'rect':[x,y,w,82]})
  self.a.append('</g>')
 def metric(self,x,y,w,label,value,sub='',tone='primary'):
  self.a.append(f'<g id="Metric-{len(self.a)}">');self.rect(x,y,w,110,C['white'],18,C['line']);self.text(x+18,y+28,label,13,C['muted']);self.text(x+18,y+68,value,30,C['orangeInk'] if tone=='orange' else C[tone],600)
  if sub:self.text(x+18,y+92,sub,11,C['muted'])
  self.a.append('</g>')
 def save(self,p):p.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'+''.join(self.a)+'</svg>')

SC=[]
def add(code,slug,title,surface,kind,**kw):SC.append(dict(id=code,slug=slug,title=title,surface=surface,kind=kind,**kw))
def mbase(title,section='user',back=True,nav=True,active=0,title_visible=True):
 s=SVG(390,844);s.text(24,29,'9:41',13,weight=600);s.rect(324,16,30,12,C['ink'],4);s.rect(327,19,22,6,C['white'],2)
 if back:s.btn(18,52,44,'',dest='U06' if section=='user' else 'R06',style='outline',h=44,name='back');s.icon('back',29,63,22)
 else:s.logo(24,52,104)
 if title_visible:s.text(76 if back else 24,84 if back else 128,title,20,weight=600)
 if not back:s.icon('bell',342,60)
 if nav:
  s.rect(0,758,390,86,C['white'],0);s.line(0,758,390,758)
  opts=[('home','หน้าแรก','U06'),('orders','กิจกรรม','U23'),('heart','รายการโปรด','U28'),('user','บัญชี','U33')] if section=='user' else [('home','รับงาน','R06'),('orders','ประวัติ','R15'),('wallet','รายได้','R16'),('user','บัญชี','R22')]
  for i,(ic,label,dest) in enumerate(opts):
   x=49+i*97;s.icon(ic,x-11,774,22,C['primary'] if i==active else C['muted']);s.text(x,815,label,11,C['primary'] if i==active else C['muted'],600 if i==active else 400,'middle');s.links.append({'name':None,'dest':dest,'rect':[i*97,758,97,68]})
  s.rect(137,833,116,4,C['ink'],2)
 return s
def mapart(s,x,y,w,h,route=True,stale=False):
 s.rect(x,y,w,h,'#F0ECE4',22);s.i+=1;mid=f'mapclip{s.i}';s.a.append(f'<defs><clipPath id="{mid}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22"/></clipPath></defs><g clip-path="url(#{mid})"><g transform="translate({x} {y})">')
 for a,b,ww,hh in [(15,20,72,55),(105,20,92,42),(230,18,78,62),(20,110,110,52),(166,102,67,72),(263,120,67,64),(28,217,72,80),(150,220,83,70)]:
  if a+ww<w and b+hh<h:s.rect(a,b,ww,hh,'#E4E7D8',9)
 for yy in range(80,int(h),96):s.line(0,yy,w,yy,'#FFFFFF',18)
 for xx in [95,248]:s.line(xx,0,xx-25,h,'#FFFFFF',15)
 s.a.append(f'<path d="M{w*.9} 0 Q{w*.6} {h*.45} {w*.96} {h}" fill="none" stroke="#C5DCD9" stroke-width="32"/>')
 if route:s.a.append(f'<path d="M60 {h-55} V{h*.5} Q60 {h*.4} 90 {h*.4} H{w*.58} V65" fill="none" stroke="{C["muted"] if stale else C["primary"]}" stroke-width="5" stroke-linecap="round"'+(' stroke-dasharray="7 7"' if stale else '')+'/>');s.rect(43,h-74,34,34,C['white'],17);s.icon('bike',49,h-67,22);s.rect(w*.58-15,45,30,30,C['orange'],15);s.icon('pin',w*.58-10,50,20,C['white'])
 s.text(15,h-14,'แผนที่ตัวอย่าง',10,'#817B70');s.a.append('</g></g>')
def order_summary(s,y=150,total='฿205',mobile=True,table_order=False):
 s.cardrow(24,y,342,'Iced latte · Oat milk','หวาน 25% · 1 แก้ว',right='฿95',photo='iced-latte');s.cardrow(24,y+94,342,'Butter croissant','อุ่นร้อน · 1 ชิ้น',right='฿75',photo='croissant');y+=214
 for label,value in ([('ค่าอาหาร','฿170'),('ค่าบริการ','฿0')] if table_order else [('ค่าอาหาร','฿170'),('ค่าจัดส่ง','฿35'),('ส่วนลด','−฿20'),('ค่าบริการ','฿20')]):s.text(24,y,label,14,C['muted']);s.text(366,y,value,14,anchor='end');y+=31
 s.line(24,y-9,366,y-9);s.text(24,y+25,'ยอดรวม',17,weight=600);s.text(366,y+25,total,24,C['primary'],600,'end');return y+50
def timeline(s,x,y,steps,active=1):
 for i,(a,b) in enumerate(steps):
  if i<len(steps)-1:s.line(x+10,y+i*78+16,x+10,y+(i+1)*78,C['tint'],3)
  s.rect(x,y+i*78,21,21,C['primary'] if i<=active else C['line'],11)
  if i<=active:s.icon('check',x+3,y+i*78+3,15,C['white'])
  s.text(x+37,y+i*78+15,a,15,weight=600);s.text(x+37,y+i*78+39,b,12,C['muted'])

# Screen catalogue: stable implementation IDs, not claims of existing runtime features.
USER=[('welcome','ทุกมื้อดี ๆ เริ่มที่ BitPOS','welcome'),('login','เข้าสู่ระบบ','login'),('otp','ยืนยันเบอร์โทรศัพท์','otp'),('location','ส่งความอร่อยถึงที่','permission'),('notifications','ไม่พลาดทุกขั้นตอน','permission'),('home','วันนี้อยากทานอะไร?','home'),('search','ค้นหาร้านและเมนู','search'),('filters','ค้นหาในแบบของคุณ','filters'),('restaurant','BitPOS Coffee House','restaurant'),('product','Iced oat latte','product'),('cart','ตะกร้าของคุณ','cart'),('addresses','ที่อยู่จัดส่ง','addresses'),('address-edit','เพิ่มที่อยู่ใหม่','address'),('map-pin','ปักหมุดจุดรับอาหาร','pin'),('checkout','ตรวจสอบออเดอร์','checkout'),('payment-method','เลือกวิธีชำระเงิน','methods'),('payment-pending','กำลังตรวจสอบการชำระ','pending'),('accepted','ร้านรับออเดอร์แล้ว','timeline'),('preparing','กำลังเตรียมมื้อของคุณ','timeline'),('tracking','อาหารกำลังเดินทาง','tracking'),('delivered','อิ่มอร่อยได้เลย','success'),('order-detail','รายละเอียดออเดอร์','detail'),('history','กิจกรรมของคุณ','history'),('cancel','ยกเลิกออเดอร์','cancel'),('refund','ติดตามการคืนเงิน','refund'),('coupons','คูปองของคุณ','coupons'),('rewards','BitPOS Rewards','rewards'),('favourites','ร้านโปรดของคุณ','favourites'),('chat','คุยกับไรเดอร์','chat'),('help','ให้เราช่วยคุณ','help'),('review','มื้อนี้เป็นอย่างไรบ้าง?','review'),('settings','ตั้งค่าบัญชี','settings'),('profile','บัญชีของคุณ','profile'),('privacy','ความเป็นส่วนตัว','privacy'),('schedule','สั่งล่วงหน้า','schedule'),('group-order','อร่อยด้วยกัน','group'),('multi-merchant','เลือกอร่อยจากหลายร้าน','multi'),('no-rider','กำลังหาไรเดอร์ให้คุณ','no-rider'),('ride-home','เดินทางกับ BitPOS','ride-home'),('ride-quote','เลือกรถที่เหมาะกับคุณ','ride-quote'),('ride-matching','กำลังหาคนขับ','ride-matching'),('ride-trip','เดินทางอย่างอุ่นใจ','ride-trip'),('ride-receipt','ถึงจุดหมายแล้ว','ride-receipt')]
for i,(sl,t,k) in enumerate(USER,1):add(f'U{i:02}',sl,t,'user',k,future=i>=39)
RIDER=[('welcome','ทุกเส้นทาง มีคุณอยู่ด้วย','welcome'),('login','เข้าสู่ระบบไรเดอร์','login'),('identity','ยืนยันตัวตน','identity'),('vehicle','ข้อมูลรถของคุณ','vehicle'),('documents','ตรวจสอบเอกสาร','documents'),('home','พร้อมรับงานวันนี้','rider-home'),('offer','งานใหม่ใกล้คุณ','offer'),('job','รายละเอียดงาน','job'),('to-store','เดินทางไปรับอาหาร','rider-map'),('at-store','ถึงร้านแล้ว','at-store'),('pickup','ยืนยันรับอาหาร','pickup'),('route','กำลังนำส่งอาหาร','rider-map'),('delivery-proof','ยืนยันส่งอาหาร','delivery'),('completed','ส่งสำเร็จ ขอบคุณครับ','rider-done'),('history','ประวัติการรับงาน','rider-history'),('earnings','รายได้ของคุณ','earnings'),('payout','รอบโอนเงิน','payout'),('statement','รายละเอียดรอบโอน','statement'),('chat','คุยกับลูกค้า','chat'),('help','ศูนย์ช่วยเหลือไรเดอร์','help'),('safety','ความปลอดภัยระหว่างงาน','safety'),('profile','บัญชีไรเดอร์','rider-profile'),('location-permissions','ตำแหน่งขณะรับงาน','permissions'),('offline','พักรับงาน','rider-offline'),('failed-delivery','ส่งอาหารไม่สำเร็จ','failed'),('handover','ขอเปลี่ยนผู้รับงาน','handover'),('ride-offer','งานรับส่งผู้โดยสาร','ride-offer'),('ride-arrived','ถึงจุดรับผู้โดยสาร','ride-arrived'),('ride-pin','ยืนยันก่อนเริ่มเดินทาง','ride-pin'),('ride-active','กำลังเดินทาง','rider-ride'),('ride-finished','จบเที่ยวเดินทาง','ride-finished')]
for i,(sl,t,k) in enumerate(RIDER,1):add(f'R{i:02}',sl,t,'rider',k,future=i>=27)
add('R32','otp','ยืนยันเบอร์โทรศัพท์','rider','rider-otp')
POS=[('dashboard','ภาพรวมร้าน','dashboard'),('pos','หน้าขาย','pos'),('bills','บิลขาย','bills'),('bill-detail','รายละเอียดบิล','bill'),('shift','ปิดรอบการขาย','shift'),('products','สินค้าและเมนู','products'),('product-edit','แก้ไขสินค้า','product-edit'),('stock','คลังสินค้า','stock'),('receive','รับเข้าสินค้า','receive'),('rcvHistory','ประวัติรับเข้า','rcvHistory'),('adjust','ปรับปรุงสต็อก','adjust'),('lowstock','สินค้าใกล้หมด','lowstock'),('movement','ความเคลื่อนไหวสินค้า','movement'),('repDaily','รายงานประจำวัน','report'),('repSales','รายงานการขาย','report'),('repReceive','รายงานรับเข้าสินค้า','report'),('repPeriod','รายงานตามช่วงเวลา','report'),('analytics','วิเคราะห์ยอดขาย','analytics'),('top','สินค้าขายดี','top'),('exportC','ส่งออกข้อมูล','export'),('suppliers','ซัพพลายเออร์','suppliers'),('customers','ลูกค้า','customers'),('customer-detail','โปรไฟล์ลูกค้า','customer'),('categories','หมวดสินค้า','categories'),('users','ผู้ใช้งานและสิทธิ์','users'),('activity','ประวัติการใช้งาน','activity'),('printer','เครื่องพิมพ์ใบเสร็จ','printer'),('settings','ตั้งค่าร้าน','settings'),('incoming','ศูนย์ออเดอร์','incoming'),('kitchen','คิวครัว','kitchen'),('online-detail','ออเดอร์จากแอพ','online-detail'),('dispatch','จัดส่งและไรเดอร์','dispatch'),('campaigns','โปรโมชัน','campaigns'),('campaign-edit','ตรวจร่างแคมเปญ','campaign-edit'),('devices','โต๊ะและ BitPOS Mini','devices'),('branches','สาขาและเวลาทำการ','branches'),('refunds','การยกเลิกและคืนเงิน','refunds'),('payouts','ยอดสุทธิและรอบโอน','payouts'),('login','เข้าสู่ระบบร้านค้า','pos-login')]
for i,(sl,t,k) in enumerate(POS,1):add(f'P{i:02}',sl,t,'pos',k)
add('P40','rider-handoff','พร้อมส่งมอบให้ไรเดอร์','pos','online-ready')
add('P41','partial-refund','ขอคืนเงินบางรายการ','pos','refund-edit')
PAY=[('entry','สั่งที่โต๊ะของคุณ','pay-entry'),('menu','เมนูของร้าน','pay-menu'),('product','เลือกเครื่องดื่มของคุณ','product'),('cart','รายการที่เลือก','cart'),('review','ตรวจสอบรายการ','pay-review'),('methods','ชำระเงินอย่างมั่นใจ','methods'),('wallet','เชื่อมต่อกระเป๋าเงิน','wallet'),('promptpay','สแกนเพื่อชำระเงิน','promptpay'),('pending','กำลังตรวจสอบยอดชำระ','pending'),('confirming','กำลังยืนยันธุรกรรม','confirming'),('paid','ชำระเงินสำเร็จ','paid'),('receipt','ใบเสร็จของคุณ','receipt'),('pickup','อาหารพร้อมรับแล้ว','pickup-ready'),('expired','รายการนี้หมดเวลาแล้ว','expired'),('failed','ยังชำระไม่สำเร็จ','pay-failed'),('recovery','กำลังตรวจสอบรายการ','recovery'),('refund','สถานะการคืนเงิน','refund'),('offline','การเชื่อมต่อขาดหาย','offline'),('desktop','ตรวจสอบและชำระเงิน','pay-desktop'),('join-table','เข้าร่วมโต๊ะ','join-table'),('help','ช่วยเหลือเรื่องรายการนี้','pay-help'),('coupon','คูปองสำหรับรายการนี้','pay-coupon')]
for i,(sl,t,k) in enumerate(PAY,1):add(f'W{i:02}',sl,t,'pay',k)

def user_screen(d):
 k=d['kind'];i=d['id'];is_pay=d['surface']=='pay';is_rider=d['surface']=='rider';s=mbase(d['title'],section='rider' if is_rider else 'user',back=k not in ['home','welcome','profile'],nav=not is_pay and k not in ['welcome','login','otp','permission','product','checkout','pending','pin','ride-trip'],active=1 if k in ['history','detail','timeline','tracking'] else 3 if k in ['profile','settings'] else 2 if k=='favourites' else 0,title_visible=k!='welcome')
 if k=='welcome':
  s.photo('latte',24,108,342,304,28);s.pill(44,130,'อร่อยใกล้คุณ',w=120);s.logo(24,442,148);s.text(24,535,'มื้ออร่อย ในจังหวะของคุณ',25,weight=600);s.wrap(24,574,'สั่งจากร้านโปรด แล้วให้ BitPOS\nดูแลทุกขั้นตอนจนถึงมือคุณ',size=16,c=C['muted']);s.btn(24,692,342,'เริ่มต้นใช้งาน','U02');s.text(195,788,'อาหารดี ๆ และร้านใกล้บ้านคุณ',13,C['muted'],anchor='middle')
 elif k=='login':
  s.text(24,165,'ยินดีต้อนรับกลับมา',27,weight=600);s.wrap(24,207,'ใช้เบอร์โทรศัพท์เพื่อสั่งอาหารและติดตามออเดอร์ของคุณ',size=15,c=C['muted']);s.field(24,292,342,'หมายเลขโทรศัพท์','+66  81 234 5678',icon='phone');s.btn(24,416,342,'รับรหัสยืนยัน','U03');s.wrap(24,507,'เมื่อดำเนินการต่อ คุณยอมรับข้อกำหนดการใช้บริการและนโยบายความเป็นส่วนตัว',size=12,c=C['muted'],maxchars=44)
 elif k=='otp':
  s.text(24,174,'ใส่รหัส 6 หลัก',27,weight=600);s.text(24,214,'ส่งไปที่ +66 81 ••• 5678',15,C['muted'])
  for j,n in enumerate('248159'):s.rect(24+j*58,267,50,62,C['white'],12,C['primary'] if j==5 else C['line']);s.text(49+j*58,308,n,24,anchor='middle')
  s.text(24,379,'ส่งรหัสอีกครั้งใน 00:28',14,C['muted']);s.btn(24,464,342,'ยืนยันและไปต่อ','U04')
 elif k=='permission':
  icon='pin' if i=='U04' else 'bell';s.rect(135,170,120,120,C['tint'],40);s.icon(icon,169,204,52);s.text(195,352,d['title'],26,weight=600,anchor='middle');s.wrap(35,399,'เลือกที่อยู่ได้แม่นยำ และค้นหาร้านที่ส่งถึงคุณ' if i=='U04' else 'รับการแจ้งเตือนเมื่อร้านรับออเดอร์และไรเดอร์กำลังนำส่ง',size=16,maxchars=32,c=C['muted']);s.btn(24,622,342,'อนุญาตตำแหน่ง' if i=='U04' else 'เปิดการแจ้งเตือน','U05' if i=='U04' else 'U06');s.btn(24,688,342,'ไว้ภายหลัง','U06',style='outline')
 elif k in ['home','search','favourites','pay-menu']:
  y=156 if k=='home' else 120
  if k=='home':s.icon('pin',24,y,19);s.text(50,y+15,'บ้าน · สุขุมวิท 49',14,C['primary'],600);y+=44
  s.field(24,y,342,'','ค้นหาร้าน เมนู หรือเครื่องดื่ม',icon='search');s.links.append({'name':None,'dest':'U07','rect':[24,y,342,70]});y+=94
  if k=='home':
   s.rect(24,y,342,132,C['primary'],22);s.photo('croissant',236,y+8,120,116,18);s.text(42,y+35,'มื้อเช้าที่ลงตัว',21,C['white'],600);s.text(42,y+65,'กาแฟ + ครัวซองต์',14,'#E9D6F6');s.pill(42,y+84,'ลด ฿20',color='orange',w=100);y+=154
   for j,(ic,t) in enumerate([('coffee','กาแฟ'),('box','อาหาร'),('heart','ของหวาน'),('car','เรียกรถ')]):s.rect(24+j*89,y,76,66,C['white'],16,C['line']);s.icon(ic,49+j*89,y+12,24);s.text(62+j*89,y+53,t,11,anchor='middle');s.links.append({'name':None,'dest':'U39' if j==3 else 'U09','rect':[24+j*89,y,76,66]})
   y+=99
  elif k=='search':
   s.pill(24,y,'ใกล้ฉัน',w=90);s.pill(126,y,'ส่งเร็ว',w=82);s.pill(220,y,'ตัวกรอง',w=92);y+=60
  else:s.text(24,y+10,'บันทึกร้านอร่อยไว้ แล้วกลับมาสั่งได้เสมอ',13,C['muted']);y+=45
  s.text(24,y,'ร้านอร่อยใกล้คุณ' if k=='home' else 'ร้านที่คุณเลือก',19,weight=600);y+=20
  s.cardrow(24,y,342,'BitPOS Coffee House','★ 4.9 · 15–25 นาที · ส่ง ฿35',photo='latte',dest='U09')
  if k!='home':s.cardrow(24,y+96,342,'Morning Bake','★ 4.8 · 20–30 นาที',photo='croissant',dest='U09');s.cardrow(24,y+192,342,'Matcha & More','★ 4.9 · 25–35 นาที',photo='matcha',dest='U09')
 elif k=='restaurant':
  s.photo('latte',0,113,390,192,0);s.pill(24,128,'เปิดอยู่',color='green',w=74);s.text(24,343,'BitPOS Coffee House',24,weight=600);s.text(24,373,'★ 4.9 (128)  ·  คาเฟ่ / เบเกอรี่',14,C['muted']);s.pill(24,392,'15–25 นาที',w=110);s.pill(144,392,'ส่ง ฿35',color='orange',w=90);s.text(24,471,'เมนูแนะนำ',20,weight=600);s.cardrow(24,490,342,'Iced oat latte','หอมกาแฟ นุ่มด้วยนมโอ๊ต',photo='iced-latte',right='฿95',dest='U10');s.cardrow(24,586,342,'Butter croissant','อบใหม่ทุกเช้า',photo='croissant',right='฿75',dest='U10');s.btn(24,688,342,'ดูตะกร้า · 2 รายการ · ฿170','U11',h=50)
 elif k=='product':
  s.photo('iced-latte',0,112,390,238,0);s.text(24,394,'Iced oat latte',27,weight=600);s.text(366,394,'฿95',25,C['primary'],600,'end');s.text(24,430,'เอสเปรสโซหอมเข้มกับนมโอ๊ตเนื้อนุ่ม',14,C['muted']);s.text(24,476,'ระดับความหวาน',16,weight=600)
  for j,t in enumerate(['0%','25%','50%','100%']):s.pill(24+j*88,494,t,'primary' if j==1 else 'blue',76)
  s.text(24,561,'เลือกนม',16,weight=600);s.cardrow(24,580,342,'นมโอ๊ต','เลือกแล้ว · +฿15',icon='check');s.btn(24,744,342,'เพิ่มลงตะกร้า · ฿95','U11' if d['surface']=='user' else 'W04');s.text(24,706,'−      1      +',21,C['primary'],600)
 elif k in ['cart','checkout','detail','pay-review']:
  yy=order_summary(s,137,total='฿170' if is_pay else '฿205',table_order=is_pay)
  if k in ['checkout','detail']:s.cardrow(24,yy+8,342,'บ้าน · สุขุมวิท 49','วางที่โต๊ะรับของหน้าประตู',icon='pin',dest='U12');s.btn(24,730,342,'ยืนยันสั่งอาหาร · ฿205','U17')
  else:s.cardrow(24,yy+8,342,'ใช้คูปองส่วนลด','เลือกคูปองที่ใช้ได้กับออเดอร์นี้',icon='card',dest='U26');s.btn(24,686,342,'เลือกวิธีชำระเงิน · ฿170' if k=='pay-review' else 'ไปตรวจสอบออเดอร์','U15' if d['surface']=='user' else 'W06' if k=='pay-review' else 'W05')
 elif k in ['addresses','address','pin']:
  if k=='addresses':
   s.cardrow(24,139,342,'บ้าน','สุขุมวิท 49 · คลองตันเหนือ',icon='home',dest='U15');s.cardrow(24,234,342,'ออฟฟิศ','อาคารตัวอย่าง · ชั้น 5',icon='box',dest='U15');s.btn(24,348,342,'เพิ่มที่อยู่ใหม่','U13',style='outline',icon='plus')
  elif k=='address':
   for j,(a,b) in enumerate([('ชื่อสถานที่','บ้าน'),('ที่อยู่','สุขุมวิท 49 คลองตันเหนือ'),('ชื่อผู้รับ','นัท · 081 234 5678'),('รายละเอียดเพิ่มเติม','โต๊ะรับของหน้าประตู')]):s.field(24,142+j*103,342,a,b)
   s.btn(24,595,342,'ปักหมุดบนแผนที่','U14',style='outline',icon='pin');s.btn(24,686,342,'บันทึกที่อยู่','U12')
  else:mapart(s,0,112,390,462);s.rect(0,535,390,309,C['white'],28);s.text(24,588,'บ้าน · สุขุมวิท 49',20,weight=600);s.wrap(24,625,'คลองตันเหนือ วัฒนา กรุงเทพฯ\nเลื่อนแผนที่ให้หมุดตรงกับจุดส่งอาหาร',size=14,c=C['muted']);s.btn(24,745,342,'ยืนยันตำแหน่งนี้','U13')
 elif k=='methods':
  s.text(24,158,'ยอดชำระ ฿205',27,weight=600)
  for j,(a,b,ic) in enumerate([('PromptPay','สแกน QR ผ่านแอพธนาคาร','qr'),('บัตรเครดิต / เดบิต','เพิ่มบัตรผ่านผู้ให้บริการชำระเงิน','card'),('กระเป๋า Solana','เลือกสินทรัพย์ที่ร้านรองรับ','wallet')]):s.cardrow(24,208+j*100,342,a,b,icon=ic,dest='U15' if d['surface']=='user' else ('W08' if j==0 else 'W07'))
  s.wrap(24,555,'วิธีชำระที่พร้อมให้บริการขึ้นอยู่กับร้านและผู้ให้บริการ',size=13,c=C['muted']);s.btn(24,686,342,'ใช้วิธีที่เลือก','U15' if d['surface']=='user' else 'W07')
 elif k in ['pending','refund','no-rider']:
  ic='refresh' if k!='no-rider' else 'bike';s.rect(137,170,116,116,C['tint'],58);s.icon(ic,171,204,48);s.text(195,346,d['title'],23,weight=600,anchor='middle');s.wrap(33,390,'เรากำลังตรวจสอบกับผู้ให้บริการ\nคุณสามารถกลับมาตรวจสถานะได้เสมอ' if k!='no-rider' else 'ร้านรับออเดอร์แล้ว เรากำลังหาคนส่ง\nหากรอนาน คุณเลือกทางอื่นได้',size=15,maxchars=34,c=C['muted']);s.cardrow(24,486,342,'ออเดอร์ #BP1024','BitPOS Coffee House · ฿205',icon='orders');s.btn(24,622,342,'ดูสถานะออเดอร์','U18');s.btn(24,688,342,'รับเองที่ร้าน' if k=='no-rider' else 'ติดต่อช่วยเหลือ','U30',style='outline')
 elif k=='timeline':
  s.pill(24,136,'ออเดอร์ #BP1024',w=142);s.text(24,209,'อีกประมาณ 15–25 นาที',26,weight=600);s.text(24,246,'BitPOS Coffee House',15,C['muted']);timeline(s,29,292,[('ร้านรับออเดอร์แล้ว','09:42 · ยืนยันรายการเรียบร้อย'),('กำลังทำอาหาร','เริ่มเตรียมเครื่องดื่มและอบครัวซองต์'),('ไรเดอร์รับอาหาร','เราจะแจ้งเมื่ออาหารออกจากร้าน'),('ส่งถึงคุณ','บ้าน · สุขุมวิท 49')],0 if i=='U18' else 1);s.btn(24,654,342,'ติดตามไรเดอร์','U20',style='outline');s.text(24,733,'ดูรายละเอียดออเดอร์',14,C['primary']);s.links.append({'name':None,'dest':'U22','rect':[24,706,342,42]})
 elif k=='tracking':
  mapart(s,0,112,390,377);s.rect(0,450,390,308,C['white'],28);s.text(24,497,'จะถึงใน 8–12 นาที',26,weight=600);s.text(24,531,'ตำแหน่งล่าสุดเมื่อ 5 วินาทีที่แล้ว',12,C['muted']);s.cardrow(24,551,342,'ก้อง · BitPOS Rider','รถจักรยานยนต์ · ★ 4.9',icon='bike');s.btn(24,657,164,'แชท','U29',style='secondary',icon='chat');s.btn(202,657,164,'รายละเอียด','U22',style='outline')
 elif k in ['success','review','ride-receipt']:
  s.rect(141,155,108,108,C['greenbg'],54);s.icon('check',170,184,50,C['green']);s.text(195,319,'ส่งถึงมือคุณแล้ว' if k!='ride-receipt' else 'ขอบคุณที่เดินทางด้วยกัน',23,weight=600,anchor='middle');s.text(195,356,'ออเดอร์ #BP1024 · ฿205',14,C['muted'],anchor='middle')
  for j in range(5):s.icon('star',69+j*51,408,31,C['orange'])
  s.field(24,492,342,'บอกเล่าประสบการณ์ของคุณ',hint='อาหารอร่อย ไรเดอร์ส่งไว...');s.btn(24,632,342,'ส่งรีวิว','U23');s.btn(24,695,342,'ดูใบเสร็จ','U22',style='outline')
 elif k in ['history','rider-history']:
  s.pill(24,133,'ทั้งหมด',w=86);s.pill(122,133,'กำลังดำเนินการ',w=140);s.text(24,206,'วันนี้',15,C['muted'],600)
  for j,(t,sub,p) in enumerate([('BitPOS Coffee House','ส่งแล้ว · 09:58 · ฿205','latte'),('Morning Bake','รับเองแล้ว · เมื่อวาน · ฿150','croissant'),('Matcha & More','ยกเลิก · 12 ต.ค. · ฿95','matcha')]):s.cardrow(24,224+j*112,342,t,sub,photo=p,dest='U22')
 elif k in ['cancel','filters','privacy','settings']:
  rows={'cancel':[('เปลี่ยนแผนการสั่ง','ยังไม่ได้เริ่มเตรียมอาหาร'),('ใช้เวลานานกว่าที่คาด','ขอให้ทีมช่วยตรวจสอบ'),('อื่น ๆ','ระบุเหตุผลเพิ่มเติม')],'filters':[('เวลาในการส่ง','ภายใน 30 นาที'),('หมวดร้าน','กาแฟ · เบเกอรี่'),('ค่าจัดส่ง','ไม่เกิน ฿40'),('คะแนนร้าน','4.5 ดาวขึ้นไป')],'privacy':[('ตำแหน่งที่ตั้ง','เฉพาะเมื่อใช้บริการ'),('การแจ้งเตือนออเดอร์','เปิด'),('ข่าวสารและโปรโมชัน','ปิด'),('ดาวน์โหลด / ลบข้อมูล','ส่งคำขอได้ในหน้านี้')],'settings':[('ภาษา','ไทย / English'),('อุปกรณ์ที่เข้าสู่ระบบ','โทรศัพท์เครื่องนี้'),('ความเป็นส่วนตัว','จัดการสิทธิ์และข้อมูล'),('ออกจากระบบ','ยืนยันก่อนออก')]}[k]
  for j,(a,b) in enumerate(rows):s.cardrow(24,140+j*104,342,a,b,icon='check' if j==0 else 'settings',dest='U34' if k=='settings' else None)
  s.btn(24,660,342,'ยืนยันยกเลิก' if k=='cancel' else 'ใช้ตัวกรอง' if k=='filters' else 'บันทึกการตั้งค่า','U25' if k=='cancel' else 'U07' if k=='filters' else 'U33',style='danger' if k=='cancel' else 'primary')
 elif k in ['coupons','rewards']:
  s.rect(24,139,342,151,C['primary'],24);s.text(45,178,'สิทธิพิเศษสำหรับคุณ',15,'#E8D5F4');s.text(45,228,'420 แต้ม' if k=='rewards' else 'ลดทันที ฿20',32,C['white'],600);s.text(45,262,'เลือกใช้ก่อนยืนยันออเดอร์',13,'#E8D5F4');s.text(24,337,'คูปองที่ใช้ได้',19,weight=600)
  for j,(a,b) in enumerate([('มื้อเช้าคู่โปรด · ลด ฿20','ขั้นต่ำ ฿150 · ถึง 31 ต.ค.'),('ส่งฟรีใกล้บ้าน','ระยะทางไม่เกิน 3 กม. · ขั้นต่ำ ฿200'),('แลกเครื่องดื่ม 1 แก้ว','ใช้ 500 แต้ม · ดูเมนูที่ร่วมรายการ')]):s.cardrow(24,357+j*104,342,a,b,icon='card',dest='U15')
 elif k=='chat':
  s.cardrow(24,132,342,'นัท · ลูกค้าของคุณ' if is_rider else 'ก้อง · ไรเดอร์ของคุณ','ออเดอร์ #BP1024',icon='user' if is_rider else 'bike');s.rect(24,246,277,78,C['white'],18,C['line']);s.wrap(40,274,'รับอาหารแล้วครับ กำลังเดินทาง\nไปส่ง อีกประมาณ 10 นาทีครับ',size=14);s.rect(78,354,288,77,C['tint'],18);s.wrap(94,382,'ขอบคุณค่ะ วางที่โต๊ะรับของ\nหน้าประตูได้เลยนะคะ',size=14);s.text(24,478,'09:49 · อ่านแล้ว',11,C['muted']);s.field(24,639,282,'','พิมพ์ข้อความ...',icon='chat');s.btn(320,651,46,'↑','U20',h=52)
 elif k=='help':
  s.text(24,163,'เราช่วยเรื่องไหนได้บ้าง?',23,weight=600)
  for j,(a,b,ic) in enumerate([('ออเดอร์และการจัดส่ง','อาหารล่าช้า / รายการไม่ครบ','orders'),('การชำระเงิน','ยอดชำระ / คืนเงิน / ใบเสร็จ','wallet'),('บัญชีและความปลอดภัย','การเข้าถึงบัญชีและข้อมูลของคุณ','shield'),('ติดต่อเจ้าหน้าที่','ติดตามเรื่องที่แจ้งไว้','chat')]):s.cardrow(24,196+j*106,342,a,b,icon=ic,dest='U29')
 elif k=='profile':
  s.rect(24,157,342,125,C['primary'],24);s.rect(44,182,64,64,'#E8D5F4',32);s.icon('user',60,196,32);s.text(128,209,'นัท',24,C['white'],600);s.text(128,241,'สมาชิก BitPOS · 420 แต้ม',13,'#E8D5F4')
  for j,(a,b,ic,dest) in enumerate([('ที่อยู่ของฉัน','บ้าน / ออฟฟิศ','pin','U12'),('คูปองและแต้ม','สิทธิพิเศษของคุณ','card','U26'),('การชำระเงิน','จัดการวิธีชำระ','wallet','U16'),('ตั้งค่าบัญชี','ภาษา / อุปกรณ์ / ความเป็นส่วนตัว','settings','U32')]):s.cardrow(24,308+j*98,342,a,b,icon=ic,dest=dest)
 elif k in ['schedule','group','multi']:
  s.rect(24,140,342,138,C['tint'],24);s.icon('clock' if k=='schedule' else 'user' if k=='group' else 'box',45,164,38);s.text(45,240,'วางแผนความอร่อยไว้ล่วงหน้า',20,weight=600)
  if k=='schedule':s.field(24,322,342,'วันที่รับอาหาร','พรุ่งนี้ · 17 ตุลาคม');s.field(24,433,342,'ช่วงเวลา','08:30–09:00');s.cardrow(24,539,342,'BitPOS Coffee House','รับเองที่ร้าน',icon='coffee')
  elif k=='group':s.field(24,322,342,'ชื่อกลุ่ม','มื้อเช้าทีมเรา');s.cardrow(24,424,342,'นัท · ผู้สร้างกลุ่ม','เลือกแล้ว 2 รายการ · ฿170',icon='user');s.cardrow(24,520,342,'เชิญเพื่อนร่วมสั่ง','แชร์ลิงก์กลุ่ม',icon='plus')
  else:s.cardrow(24,320,342,'BitPOS Coffee House','2 รายการ · ฿170',photo='latte');s.cardrow(24,420,342,'Morning Bake','1 รายการ · ฿75',photo='croissant');s.wrap(24,558,'แต่ละร้านมีออเดอร์ ค่าจัดส่ง\nและสถานะคืนเงินของตัวเอง',size=14,c=C['muted'])
  s.btn(24,686,342,'ยืนยันเวลา' if k=='schedule' else 'แชร์ลิงก์กลุ่ม' if k=='group' else 'ตรวจสอบแยกตามร้าน','U15')
 elif k.startswith('ride'):
  mapart(s,0,112,390,370);s.rect(0,450,390,308,C['white'],28)
  if k=='ride-home':s.text(24,493,'วันนี้จะไปที่ไหน?',24,weight=600);s.field(24,527,342,'จุดรับ','บ้าน · สุขุมวิท 49',icon='pin');s.field(24,625,342,'จุดหมาย','เลือกสถานที่',icon='search');s.btn(24,714,342,'ค้นหารถ','U40',h=44)
  elif k=='ride-quote':s.text(24,493,'เลือกรถของคุณ',22,weight=600);s.cardrow(24,518,342,'BitPOS Car','รับใน 5 นาที · 4 ที่นั่ง',icon='car',right='฿149');s.cardrow(24,612,342,'BitPOS Bike','รับใน 3 นาที · 1 ที่นั่ง',icon='bike',right='฿65');s.btn(24,707,342,'ยืนยันเรียกรถ · ฿149','U41',h=44)
  elif k=='ride-matching':s.text(24,495,'กำลังค้นหาคนขับใกล้คุณ',22,weight=600);s.wrap(24,540,'บ้าน → EmQuartier\nBitPOS Car · ราคาประเมิน ฿149',size=15,c=C['muted']);s.btn(24,652,342,'ดูเที่ยวเดินทาง','U42');s.btn(24,714,342,'ยกเลิกการค้นหา','U39',style='outline',h=44)
  else:s.text(24,496,'ถึงจุดหมายใน 12 นาที',24,weight=600);s.cardrow(24,527,342,'ปกรณ์ · Toyota Corolla','ทะเบียนตัวอย่าง · ★ 4.9',icon='car');s.pill(24,627,'PIN เริ่มเที่ยว  4821',w=203);s.btn(24,694,164,'ความปลอดภัย','U30',style='secondary',icon='shield');s.btn(202,694,164,'รายละเอียด','U43',style='outline')
 return s

def rider_screen(d):
 k=d['kind'];s=mbase(d['title'],'rider',back=k not in ['rider-home','rider-offline','welcome','rider-profile'],nav=k not in ['welcome','login','offer','pickup','delivery','rider-map','ride-pin','rider-ride'],active=2 if k in ['earnings','payout','statement'] else 1 if k=='rider-history' else 3 if k=='rider-profile' else 0,title_visible=k!='welcome')
 if k=='welcome':
  mapart(s,24,119,342,293);s.logo(24,445,150);s.pill(190,463,'RIDER',w=86);s.text(24,540,'ทุกเส้นทาง มีคุณอยู่ด้วย',25,weight=600);s.wrap(24,581,'รับงานใกล้คุณ ดูรายได้ชัดเจน\nพร้อมความช่วยเหลือระหว่างทาง',size=16,c=C['muted']);s.btn(24,702,342,'เริ่มเป็น BitPOS Rider','R02')
 elif k=='login':
  s.text(24,165,'พร้อมออกไปส่งความอร่อย?',24,weight=600);s.field(24,240,342,'หมายเลขโทรศัพท์','+66 81 234 5678',icon='phone');s.btn(24,374,342,'เข้าสู่ระบบด้วยรหัส OTP','R32');s.wrap(24,477,'บัญชีไรเดอร์ใช้แยกจากบัญชีลูกค้า\nดูสถานะการสมัครและเอกสารได้ในแอพ',size=14,c=C['muted'])
 elif k=='rider-otp':
  s.text(24,178,'ใส่รหัส 6 หลัก',27,weight=600);s.text(24,218,'ส่งไปที่ +66 81 ••• 5678',15,C['muted'])
  for j,n in enumerate('248159'):s.rect(24+j*58,267,50,62,C['white'],12,C['line']);s.text(49+j*58,308,n,24,anchor='middle')
  s.text(24,379,'ส่งรหัสอีกครั้งใน 00:28',14,C['muted']);s.btn(24,464,342,'ยืนยันและไปต่อ','R03')
 elif k in ['identity','vehicle','documents','permissions']:
  s.pill(24,136,'ขั้นตอนสมัคร · 2 / 3',w=181);s.text(24,212,d['title'],25,weight=600)
  rows={'identity':[('ชื่อ–นามสกุล','ก้อง ตัวอย่าง'),('เอกสารยืนยันตัวตน','แนบเอกสาร'),('ใบอนุญาตขับรถ','แนบเอกสารและวันหมดอายุ')],'vehicle':[('ประเภทรถ','จักรยานยนต์'),('ทะเบียนรถ','ทะเบียนตัวอย่าง'),('รูปถ่ายและประกัน','แนบเอกสาร')],'documents':[('ยืนยันตัวตน','ตรวจสอบแล้ว'),('ใบอนุญาตขับรถ','ตรวจสอบแล้ว'),('เอกสารรถและประกัน','กำลังตรวจสอบ')],'permissions':[('ตำแหน่งขณะใช้แอพ','อนุญาตแล้ว'),('ตำแหน่งขณะรับงานเบื้องหลัง','เปิดเพื่อให้ลูกค้าติดตามได้'),('การแจ้งเตือนงานใหม่','เปิด')]}[k]
  for j,(a,b) in enumerate(rows):s.cardrow(24,246+j*112,342,a,b,icon='check' if k=='documents' and j<2 else 'shield' if k=='permissions' else 'box')
  s.btn(24,664,342,'เปิดการตั้งค่าตำแหน่ง' if k=='permissions' else 'ดำเนินการต่อ','R06' if k in ['documents','permissions'] else 'R04' if k=='identity' else 'R05');s.text(24,739,'ข้อมูลใช้สำหรับตรวจสอบและให้บริการเท่านั้น',11,C['muted'])
 elif k in ['rider-home','rider-offline']:
  s.rect(24,153,342,60,C['greenbg'] if k=='rider-home' else C['tint'],18);s.text(44,190,'ออนไลน์ · พร้อมรับงาน' if k=='rider-home' else 'ออฟไลน์ · พักรับงาน',17,C['green'] if k=='rider-home' else C['primary'],600);s.rect(302,169,44,27,C['green'] if k=='rider-home' else C['muted'],14);s.rect(322 if k=='rider-home' else 306,173,19,19,C['white'],10);mapart(s,24,231,342,262,False);s.metric(24,515,164,'รายได้วันนี้','฿680','6 งานสำเร็จ');s.metric(202,515,164,'คะแนนของคุณ','4.9','จาก 128 รีวิว',tone='orange');s.btn(24,653,342,'ดูงานใกล้คุณ' if k=='rider-home' else 'เปิดรับงาน','R07' if k=='rider-home' else 'R06')
 elif k in ['offer','ride-offer']:
  mapart(s,0,112,390,266);s.rect(0,348,390,496,C['white'],28);s.pill(24,373,'งานใหม่ · ตอบรับใน 25 วินาที',color='orange',w=260);s.text(24,458,'รายได้ประมาณ ฿55' if k=='offer' else 'รายได้ประมาณ ฿129',28,weight=600);s.text(24,495,'ระยะทางรวม 3.2 กม. · 18 นาที',14,C['muted']);timeline(s,29,530,[('BitPOS Coffee House' if k=='offer' else 'สุขุมวิท 49','จุดรับ · ห่างคุณ 0.8 กม.'),('บ้าน · สุขุมวิท 49' if k=='offer' else 'EmQuartier','จุดส่ง · รายละเอียดหลังรับงาน')],0);s.btn(24,715,342,'รับงานนี้','R08' if k=='offer' else 'R28');s.btn(24,778,342,'ข้ามงาน','R06',style='outline',h=42)
 elif k in ['rider-map','rider-ride']:
  mapart(s,0,112,390,456);s.rect(0,526,390,318,C['white'],28);s.text(24,574,'อีก 5 นาที · 0.8 กม.' if d['id']=='R09' else 'อีก 8 นาที · 2.4 กม.',26,weight=600);s.text(24,611,'BitPOS Coffee House' if d['id']=='R09' else 'บ้าน · สุขุมวิท 49',16,C['muted']);s.btn(24,649,164,'นำทาง','R09',style='secondary',icon='pin');s.btn(202,649,164,'แชท','R19',style='outline',icon='chat');s.btn(24,737,342,'ถึงร้านแล้ว' if d['id']=='R09' else 'จบเที่ยวเดินทาง' if k=='rider-ride' else 'ถึงจุดส่งแล้ว','R10' if d['id']=='R09' else 'R31' if k=='rider-ride' else 'R13')
 elif k in ['job','at-store','pickup','delivery','ride-arrived','ride-pin']:
  s.pill(24,136,'งาน #BP1024',w=130);s.cardrow(24,190,342,'BitPOS Coffee House' if k not in ['delivery','ride-arrived','ride-pin'] else 'บ้าน · สุขุมวิท 49','นัท · จุดนัดรับที่หน้าประตู',icon='coffee' if k not in ['delivery','ride-pin','ride-arrived'] else 'pin');s.text(24,318,'ตรวจสอบก่อนรับอาหาร' if k in ['job','at-store','pickup'] else 'ยืนยันก่อนส่งมอบ' if k=='delivery' else 'ยืนยันก่อนเริ่มเที่ยว',22,weight=600)
  if k in ['pickup','ride-pin']:
   s.text(24,363,'สแกน QR หรือกรอกรหัสจากร้าน' if k=='pickup' else 'กรอก PIN ที่ผู้โดยสารแจ้งให้คุณ',14,C['muted'])
   for j,n in enumerate('4821'):s.rect(24+j*89,406,76,74,C['white'],15,C['primary'] if j==3 else C['line']);s.text(62+j*89,455,n,29,anchor='middle')
   s.btn(24,521,342,'สแกนรหัสรับอาหาร','R12',style='outline',icon='qr') if k=='pickup' else None
  elif k=='delivery':s.field(24,369,342,'รหัสรับอาหารจากลูกค้า','4821');s.rect(24,470,342,127,C['tint'],18);s.icon('box',174,492,40);s.text(195,567,'เพิ่มภาพส่งมอบตามเงื่อนไขงาน',13,C['primary'],anchor='middle')
  elif k=='ride-arrived':s.metric(24,363,342,'เวลารอผู้โดยสาร','02:15','เริ่มนับเมื่อยืนยันถึงจุดรับแล้ว');s.btn(24,521,342,'ติดต่อผู้โดยสาร','R19',style='outline',icon='phone')
  else:s.cardrow(24,350,342,'Iced oat latte × 1','หวาน 25% · นมโอ๊ต',photo='iced-latte');s.cardrow(24,444,342,'Butter croissant × 1','อุ่นร้อน',photo='croissant');s.wrap(24,576,'ตรวจรายการและบรรจุภัณฑ์ให้ครบ\nก่อนยืนยันรับจากร้าน',size=14,c=C['muted'])
  dest='R09' if k=='job' else 'R11' if k=='at-store' else 'R12' if k=='pickup' else 'R14' if k=='delivery' else 'R29' if k=='ride-arrived' else 'R30';label='ไปที่ร้าน' if k=='job' else 'ยืนยันรหัสรับอาหาร' if k=='at-store' else 'รับอาหารและเริ่มนำส่ง' if k=='pickup' else 'ยืนยันส่งสำเร็จ' if k=='delivery' else 'ผู้โดยสารมาถึงแล้ว' if k=='ride-arrived' else 'ยืนยัน PIN และเริ่มเที่ยว';s.btn(24,728 if k in ['pickup','delivery','ride-pin'] else 674,342,label,dest)
 elif k in ['rider-done','ride-finished']:
  s.rect(141,161,108,108,C['greenbg'],54);s.icon('check',171,190,48,C['green']);s.text(195,326,'งานนี้ส่งสำเร็จแล้ว',24,weight=600,anchor='middle');s.metric(24,370,342,'รายได้งานนี้','฿55','งาน #BP1024 · ไม่รวมทิป');s.cardrow(24,508,342,'รายได้บันทึกแล้ว','ตรวจรายละเอียดในหน้ารายได้',icon='wallet');s.btn(24,667,342,'พร้อมรับงานถัดไป','R06')
 elif k in ['earnings','payout','statement']:
  s.rect(24,139,342,149,C['primary'],24);s.text(45,177,'รายได้วันนี้' if k=='earnings' else 'รอบโอน 16 ตุลาคม',14,'#E8D5F4');s.text(45,232,'฿680' if k=='earnings' else '฿3,420',39,C['white'],600);s.text(45,264,'6 งานสำเร็จ · ดูรายละเอียดแต่ละงานได้',12,'#E8D5F4');s.pill(24,312,'วันนี้',w=78);s.pill(114,312,'สัปดาห์นี้',w=102);s.text(24,391,'รายละเอียดรายได้',20,weight=600)
  for j,(a,b,v) in enumerate([('ค่าจัดส่ง','6 งานสำเร็จ','฿580'),('ทิปจากลูกค้า','บันทึกเมื่อได้รับยืนยัน','฿100'),('รอบโอนถัดไป','17 ต.ค. · ตรวจสถานะการโอน','฿680')]):s.cardrow(24,411+j*95,342,a,b,icon='wallet',right=v,dest='R18')
 elif k=='rider-history':
  s.pill(24,136,'ทั้งหมด',w=90);s.pill(126,136,'สำเร็จ',color='green',w=90);s.text(24,206,'วันนี้',15,C['muted'])
  for j,(a,b,v) in enumerate([('#BP1024','BitPOS Coffee House · ส่งแล้ว','+฿55'),('#BP1021','Morning Bake · ส่งแล้ว','+฿45'),('#BP1018','Matcha & More · ส่งแล้ว','+฿60')]):s.cardrow(24,228+j*112,342,a,b,icon='bike',right=v,dest='R08')
 elif k in ['chat','help']:
  proxy={**d,'kind':'history' if k=='rider-history' else k,'title':d['title']};s=user_screen(proxy)
  # Replace consumer nav semantics and destinations without flattening artwork.
  s.links=[{**a,'dest':{'U22':'R08','U29':'R19','U20':'R12','U06':'R06','U23':'R15','U28':'R16','U33':'R22'}.get(a['dest'],a['dest'])} for a in s.links]
 elif k in ['safety','failed','handover']:
  s.rect(24,140,342,122,C['redbg'] if k!='handover' else C['peach'],22);s.icon('shield',44,161,34,C['red'] if k!='handover' else C['orange']);s.text(44,235,'ความปลอดภัยของคุณมาก่อน',20,weight=600)
  choices=[('ติดต่อทีมช่วยเหลือ','ส่งรายละเอียดงานปัจจุบัน'),('ลูกค้าไม่รับสาย / หาจุดส่งไม่พบ','บันทึกการติดต่อก่อนดำเนินการ'),('เกิดอุบัติเหตุ / รถมีปัญหา','ขอความช่วยเหลือระหว่างงาน')] if k!='handover' else [('ขอความช่วยเหลือส่งต่องาน','ทีมงานจะตรวจสอบก่อนเปลี่ยนผู้รับ'),('อาหารอยู่กับคุณแล้ว','อย่าส่งต่อเองโดยไม่ได้รับการยืนยัน'),('ดูประวัติการดำเนินการ','เก็บหลักฐานของงานเดิม')]
  for j,(a,b) in enumerate(choices):s.cardrow(24,289+j*104,342,a,b,icon='chat' if j==0 else 'shield',dest='R20')
  s.btn(24,666,342,'ติดต่อทีมช่วยเหลือ','R20',style='danger' if k=='safety' else 'primary')
 elif k=='rider-profile':
  s.rect(24,153,342,122,C['primary'],24);s.icon('user',44,185,52,C['white']);s.text(119,201,'ก้อง',25,C['white'],600);s.text(119,236,'ไรเดอร์ที่ผ่านการตรวจสอบ · ★ 4.9',12,'#E8D5F4')
  for j,(a,b,dest) in enumerate([('รถและเอกสาร','รถจักรยานยนต์ · ตรวจสอบแล้ว','R04'),('การรับตำแหน่ง','เปิดขณะรับงาน','R23'),('รายได้และบัญชีรับเงิน','ดูสถานะรอบโอน','R17'),('ช่วยเหลือและความปลอดภัย','ติดต่อทีมระหว่างงาน','R21')]):s.cardrow(24,303+j*98,342,a,b,icon='settings',dest=dest)
 return s

NAV=[('chart','ภาพรวม','P01'),('cart','หน้าขาย','P02'),('orders','ศูนย์ออเดอร์','P29'),('coffee','คิวครัว','P30'),('bike','จัดส่ง','P32'),('box','สินค้าและคลัง','P06'),('user','ลูกค้า','P22'),('card','โปรโมชัน','P33'),('chart','รายงาน','P18'),('settings','ตั้งค่า','P28')]
def webbase(title,active=''):
 s=SVG(1440,1000);s.rect(0,0,232,1000,C['white'],0);s.logo(28,27,142);s.pill(28,99,'MERCHANT',w=113)
 for j,(ic,t,dest) in enumerate(NAV):
  y=159+j*66
  if active==dest:s.rect(16,y-9,200,52,C['tint'],14)
  s.icon(ic,31,y+4,22,C['primary'] if active==dest else C['muted']);s.text(68,y+22,t,15,C['primary'] if active==dest else C['muted'],600 if active==dest else 400);s.links.append({'name':None,'dest':dest,'rect':[16,y-9,200,52]})
 s.line(24,862,208,862);s.icon('user',29,890,28);s.text(75,907,'นัท · เจ้าของร้าน',14,weight=600);s.text(28,954,'BitPOS Coffee House',12,C['muted']);s.rect(232,0,1208,86,C['white'],0);s.text(264,51,'BitPOS Coffee House',16,weight=600);s.pill(480,26,'สาขาสุขุมวิท',w=128);s.pill(1111,26,'ไทย / EN',w=100);s.icon('bell',1240,31,24);s.pill(1291,26,'เปิดรับงาน',color='green',w=116);s.text(264,135,title,28,weight=600);s.text(264,164,'จัดการร้านของคุณในที่เดียว',13,C['muted']);return s
def table(s,x,y,w,heads,rows,widths=None):
 widths=widths or [w/len(heads)]*len(heads);s.rect(x,y,w,48,C['tint'],12);xx=x
 for h,ww in zip(heads,widths):s.text(xx+16,y+30,h,12,C['primary'],600);xx+=ww
 for j,row in enumerate(rows):
  yy=y+48+j*65;s.rect(x,yy,w,65,C['white'],0);s.line(x,yy+64,x+w,yy+64);xx=x
  for n,ww in zip(row,widths):s.text(xx+16,yy+38,str(n),13,C['ink']);xx+=ww
def graph(s,x,y,w,h):
 s.rect(x,y,w,h,C['white'],20,C['line']);s.text(x+24,y+34,'ยอดขายตลอดวัน',17,weight=600)
 for j in range(4):yy=y+70+j*(h-110)/3;s.line(x+50,yy,x+w-24,yy);s.text(x+15,yy+5,str(6000-j*2000),10,C['muted'])
 for j,v in enumerate([.2,.36,.6,.4,.8,.65,.9,.72,.95,.75]):
  xx=x+65+j*(w-110)/10;bh=v*(h-104);s.rect(xx,y+h-34-bh,(w-130)/13,bh,C['orange'] if j==8 else C['primary'],7)
 for j,t in enumerate(['08:00','10:00','12:00','14:00','16:00']):s.text(x+55+j*(w-90)/5,y+h-12,t,10,C['muted'])
def pos_screen(d):
 k=d['kind'];s=webbase(d['title'],d['id']);x=264;ww=1144
 if k=='pos-login':
  s=SVG(1440,1000,C['white']);s.rect(0,0,740,1000,C['primary'],0);s.logo(64,56,180);s.photo('latte',66,192,605,430,32);s.text(65,711,'ร้านของคุณ พร้อมทุกออเดอร์',38,C['white'],600);s.text(65,765,'ขายหน้าร้าน รับออเดอร์ออนไลน์ และดูแลลูกค้า',20,'#E9D6F6');s.text(840,250,'ยินดีต้อนรับกลับมา',32,weight=600);s.field(840,328,450,'อีเมล','owner@example.test');s.field(840,445,450,'รหัสผ่าน','••••••••');s.btn(840,567,450,'เข้าสู่ระบบ','P01');s.text(840,668,'BitPOS Merchant · ไทย / English',14,C['muted']);return s
 if k in ['dashboard','analytics','report','top']:
  for j,(a,b,c) in enumerate([('ยอดขายวันนี้','฿18,420','+12.8% จากเมื่อวาน'),('ออเดอร์ทั้งหมด','86','12 ออเดอร์จากแอพ'),('กำลังดำเนินการ','8','3 งานกำลังจัดส่ง'),('ยอดสุทธิร้าน','฿16,980','หลังส่วนลดและค่าธรรมเนียม')]):s.metric(x+j*291,202,271,a,b,c,tone='orange' if j==2 else 'primary')
  graph(s,x,340,738,300);s.rect(1030,340,378,300,C['white'],20,C['line']);s.text(1054,379,'ช่องทางการขาย',18,weight=600)
  for j,(a,b,v) in enumerate([('หน้าร้าน','58%',.58),('แอพจัดส่ง','27%',.27),('รับเอง / โต๊ะ','15%',.15)]):s.text(1054,431+j*62,a,14);s.text(1382,431+j*62,b,14,C['primary'],600,'end');s.rect(1054,444+j*62,326,8,C['tint'],4);s.rect(1054,444+j*62,326*v,8,C['primary'],4)
  s.text(x,690,'ออเดอร์ล่าสุด' if k=='dashboard' else 'รายละเอียดรายงาน',20,weight=600);table(s,x,718,ww,['ออเดอร์','ช่องทาง','สถานะ','ยอดรวม','เวลา'],[['#BP1024','แอพจัดส่ง','กำลังนำส่ง','฿205','09:42'],['#BP1023','หน้าร้าน','ชำระแล้ว','฿170','09:38'],['#BP1022','รับเอง','พร้อมรับ','฿95','09:35']],[210,260,300,170,204])
 elif k in ['incoming','kitchen']:
  for j,t in enumerate(['ทั้งหมด  12','หน้าร้าน','โต๊ะ','แอพจัดส่ง  8','รับเอง  4']):s.pill(x+j*156,195,t,'primary' if j==0 else 'blue',145)
  columns=[('ใหม่ · 3','orange'),('กำลังทำ · 4','primary'),('พร้อมรับ · 3','green'),('จัดส่ง · 2','blue')]
  for j,(name,tone) in enumerate(columns):
   xx=x+j*291;s.rect(xx,252,271,697,'#F0EBF5',18);s.text(xx+16,289,name,18,C[tone],600)
   for l in range(2 if j!=1 else 3):
    yy=314+l*202;s.rect(xx+12,yy,247,186,C['white'],16,C['line']);s.text(xx+28,yy+30,f'#BP{1024-j*3-l}',18,weight=600);s.pill(xx+147,yy+12,'แอพส่ง' if l==0 else 'รับเอง',w=88);s.text(xx+28,yy+67,'Iced latte × 1',14);s.text(xx+28,yy+94,'Croissant × 1',14,C['muted']);s.text(xx+28,yy+128,'฿205 · ชำระแล้ว',13,C['green']);s.btn(xx+25,yy+141,220,'รับออเดอร์ · เหลือ 01:42' if j==0 else 'ดูรายละเอียด','P31',style='primary' if j==0 else 'secondary',h=34)
 elif k in ['online-detail','bill','online-ready']:
  s.rect(x,202,730,721,C['white'],22,C['line']);s.text(x+26,246,'#BP1024 · BitPOS Coffee House',24,weight=600);s.pill(x+26,269,'แอพจัดส่ง',w=105);s.pill(x+145,269,'ชำระแล้ว',color='green',w=104);table(s,x+24,326,682,['รายการ','จำนวน','ยอด'],[['Iced oat latte · หวาน 25%','1','฿95'],['Butter croissant · อุ่นร้อน','1','฿75']],[440,100,142]);s.text(x+28,568,'หมายเหตุจากลูกค้า',15,weight=600);s.text(x+28,603,'วางที่โต๊ะรับของหน้าประตู',15,C['muted']);s.text(x+28,695,'ยอดรวมพร้อมค่าจัดส่ง',17,weight=600);s.text(x+682,695,'฿205',28,C['primary'],600,'end');s.rect(1022,202,386,721,C['white'],22,C['line']);s.text(1046,246,'รับและจัดเตรียมออเดอร์',20,weight=600);s.field(1046,297,338,'เวลาเตรียมโดยประมาณ','15 นาที');s.btn(1046,408,338,'ยืนยันรหัสและส่งมอบ' if k=='online-ready' else 'รับออเดอร์และเริ่มเตรียม','P32' if k=='online-ready' else 'P30');s.btn(1046,475,338,'แจ้งปัญหาการส่งมอบ' if k=='online-ready' else 'ปฏิเสธพร้อมเหตุผล','P37',style='outline');s.cardrow(1046,566,338,'ไรเดอร์ · ก้อง' if k=='online-ready' else 'ยังไม่เริ่มจัดคนส่ง','ตรวจรายการและรหัสก่อนส่งมอบ' if k=='online-ready' else 'เริ่มค้นหาเมื่อร้านรับออเดอร์',icon='bike');s.text(1046,702,'รหัสรับอาหาร   4821' if k=='online-ready' else 'ยังไม่ได้ส่งมอบอาหาร',21,C['primary'],600);s.btn(1046,746,338,'ดูรายการที่เตรียมแล้ว','P40',style='secondary');s.text(1046,842,'ดูประวัติสถานะและการชำระ',13,C['muted'])
 elif k=='dispatch':
  mapart(s,x,202,720,720);s.rect(1012,202,396,720,C['white'],22,C['line']);s.text(1036,246,'งานจัดส่งที่กำลังทำ',22,weight=600)
  for j,(a,b) in enumerate([('#BP1024 · ก้อง','กำลังนำส่ง · อีก 8 นาที'),('#BP1021 · มายด์','รอรับอาหาร · ร้านกำลังทำ'),('#BP1019 · ยังไม่มีคนรับ','ค้นหาไรเดอร์ · รอ 02:10')]):s.cardrow(1036,278+j*122,348,a,b,icon='bike',dest='P31')
  s.btn(1036,720,348,'ช่วยจัดหาคนส่ง','P31',style='secondary');s.wrap(1036,814,'ตำแหน่งแสดงเฉพาะงานที่ได้รับมอบหมาย\nไม่แสดงเมื่อไรเดอร์อยู่นอกงาน',size=13,c=C['muted'],maxchars=36)
 elif k=='pos':
  s.field(x,206,706,'','ค้นหาสินค้าหรือสแกนรหัส',icon='search');s.pill(x,292,'ทั้งหมด',w=95);s.pill(x+108,292,'กาแฟ',w=95);s.pill(x+216,292,'เบเกอรี่',w=105)
  for j,(a,b) in enumerate([('latte','Latte'),('iced-latte','Iced oat latte'),('matcha','Matcha latte'),('croissant','Croissant'),('espresso','Espresso'),('latte','Cappuccino')]):
   xx=x+(j%3)*240;yy=350+(j//3)*251;s.rect(xx,yy,220,231,C['white'],20,C['line']);s.photo(a,xx+12,yy+12,196,139,14);s.text(xx+14,yy+183,b,16,weight=600);s.text(xx+14,yy+214,'฿95',18,C['primary'],600);s.icon('plus',xx+180,yy+193,22)
  s.rect(1012,202,396,721,C['white'],22,C['line']);s.text(1036,246,'ตะกร้า · 2 รายการ',22,weight=600);s.cardrow(1036,276,348,'Iced oat latte','1 × ฿95',photo='iced-latte');s.cardrow(1036,371,348,'Butter croissant','1 × ฿75',photo='croissant');s.field(1036,507,348,'ลูกค้า','ลูกค้าทั่วไป',icon='user');s.text(1036,659,'ยอดชำระ',18,weight=600);s.text(1384,659,'฿170',30,C['primary'],600,'end');s.btn(1036,705,348,'ชำระเงิน','W06');s.btn(1036,774,348,'บันทึกตะกร้า','P02',style='outline')
 elif k in ['product-edit','receive','adjust','customer','campaign-edit','settings','printer','branches','shift','refund-edit']:
  s.rect(x,202,744,719,C['white'],22,C['line']);s.rect(1036,202,372,719,C['white'],22,C['line']);s.text(x+26,248,d['title'],23,weight=600)
  choices={'refund-edit':[('ออเดอร์เดิม','#BP1024 · ชำระ ฿205'),('รายการที่ขอคืน','Butter croissant × 1 · ฿75'),('เหตุผล','รายการไม่ครบ'),('ขั้นตอนถัดไป','รอผู้ให้บริการยืนยันผลคืนเงิน')],'product-edit':[('ชื่อสินค้า','Iced oat latte'),('หมวดสินค้า','กาแฟ'),('ราคา / หน่วย','฿95 / แก้ว'),('ตัวเลือก','ระดับหวาน · นม · ขนาด')],'receive':[('ผู้จำหน่าย','Coffee Supply Co.'),('เลขที่เอกสาร','RCV-20261016-001'),('สินค้า','เมล็ดกาแฟ House blend'),('จำนวน / ต้นทุน','5 กก. / ฿2,400')],'adjust':[('สินค้า','เมล็ดกาแฟ House blend'),('จำนวนปรับ','−0.5 กก.'),('เหตุผล','ตรวจนับปลายวัน'),('หมายเหตุ','ยืนยันจำนวนก่อนบันทึก')],'customer':[('ชื่อลูกค้า','นัท'),('เบอร์โทรศัพท์','081 ••• 5678'),('ความชอบ','หวาน 25% · นมโอ๊ต'),('หมายเหตุของร้าน','ข้อมูลเฉพาะร้านนี้')],'campaign-edit':[('ชื่อแคมเปญ','มื้อเช้าคู่โปรด'),('สินค้าที่ร่วมรายการ','Latte + Croissant'),('ราคาชุด / ส่วนลด','฿150 / ลด ฿20'),('ช่วงเวลา','17–31 ต.ค. · 08:00–11:00')],'settings':[('ชื่อร้าน','BitPOS Coffee House'),('ภาษา','ไทย / English'),('เวลาเปิดรับงาน','08:00–18:00'),('การรับออเดอร์จากแอพ','เปิด · เวลาเตรียม 15 นาที')],'printer':[('เครื่องพิมพ์','Receipt Printer 01'),('ขนาดกระดาษ','80 มม.'),('การเชื่อมต่อ','เชื่อมต่อแล้ว'),('หัวใบเสร็จ','BitPOS Coffee House')],'branches':[('ชื่อสาขา','สาขาสุขุมวิท'),('ที่อยู่','สุขุมวิท 49 กรุงเทพฯ'),('พื้นที่ให้บริการ','รัศมี 5 กม.'),('เวลาทำการ','จันทร์–อาทิตย์ · 08:00–18:00')],'shift':[('รอบการขาย','16 ต.ค. · 08:00–18:00'),('ผู้รับผิดชอบ','นัท · เจ้าของร้าน'),('เงินสดที่นับได้','฿5,200'),('หมายเหตุ','ตรวจยอดก่อนยืนยันปิดรอบ')]}[k]
  for j,(a,b) in enumerate(choices):s.field(x+26,294+j*113,690,a,b)
  s.btn(x+26,805,334,'ส่งคำขอคืนเงิน' if k=='refund-edit' else 'บันทึกร่าง' if k=='campaign-edit' else 'บันทึกข้อมูล','P37' if k=='refund-edit' else 'P33' if k=='campaign-edit' else 'P06' if k=='product-edit' else 'P01');s.btn(x+374,805,342,'ยกเลิก','P01',style='outline');s.text(1060,248,'พรีวิวและรายละเอียด',20,weight=600)
  if k in ['campaign-edit','product-edit']:s.photo('latte',1060,278,324,250,18);s.text(1060,570,'มื้อเช้าที่ลงตัว',22,weight=600);s.text(1060,612,'Latte + Croissant · ฿150',16,C['primary']);s.pill(1060,652,'ร่าง · ยังไม่เผยแพร่',color='orange',w=216)
  else:s.metric(1060,287,324,'สถานะ','พร้อมใช้งาน','ตรวจข้อมูลก่อนบันทึก');s.wrap(1060,453,'การเปลี่ยนแปลงจะบันทึกพร้อมผู้ทำรายการและเวลา เพื่อให้ตรวจสอบย้อนหลังได้',size=15,c=C['muted'],maxchars=30)
 else:
  # Distinct data fixtures and action labels for every legacy POS inventory page.
  headers=['รายการ','รายละเอียด','สถานะ','อัปเดตล่าสุด']
  data={
   'bills':[['#BP1024','แอพจัดส่ง · ฿205','ชำระแล้ว','09:42'],['#BP1023','หน้าร้าน · ฿170','ชำระแล้ว','09:38'],['#BP1022','รับเอง · ฿95','พร้อมรับ','09:35']],
   'products':[['Iced oat latte','กาแฟ · ฿95','เปิดขาย','09:40'],['Butter croissant','เบเกอรี่ · ฿75','เปิดขาย','09:35'],['Matcha latte','ชา · ฿105','หมดชั่วคราว','09:10']],
   'stock':[['House blend','คงเหลือ 12.5 กก.','เพียงพอ','09:40'],['Oat milk','คงเหลือ 8 ลิตร','ใกล้จุดสั่งซื้อ','09:35'],['Croissant','คงเหลือ 24 ชิ้น','เพียงพอ','09:10']],
   'lowstock':[['Oat milk','เหลือ 8 / ขั้นต่ำ 10 ลิตร','ควรรับเข้า','09:35'],['แก้ว 16 oz','เหลือ 48 / ขั้นต่ำ 100','ควรรับเข้า','09:10']],
   'rcvHistory':[['RCV-001','Coffee Supply · ฿2,400','รับเข้าแล้ว','16 ต.ค.'],['RCV-002','Bakery Supply · ฿1,800','รับเข้าแล้ว','15 ต.ค.']],
   'movement':[['House blend','ขาย −0.018 กก. · #BP1024','ตัดสต็อก','09:42'],['Oat milk','ขาย −0.2 ลิตร · #BP1024','ตัดสต็อก','09:42'],['Croissant','รับเข้า +24 ชิ้น','รับเข้า','08:00']],
   'export':[['ยอดขายเดือนตุลาคม','CSV · 1–16 ต.ค.','ดาวน์โหลดได้','10:00'],['รายงานคลังสินค้า','CSV · 16 ต.ค.','ดาวน์โหลดได้','09:00']],
   'suppliers':[['Coffee Supply Co.','เมล็ดกาแฟ / นม','ใช้งาน','15 ต.ค.'],['Morning Bakery','ครัวซองต์ / เค้ก','ใช้งาน','14 ต.ค.']],
   'customers':[['นัท','ลูกค้าประจำ · ชอบนมโอ๊ต','12 ออเดอร์','16 ต.ค.'],['มายด์','สมาชิก BitPOS','8 ออเดอร์','15 ต.ค.'],['ลูกค้าทั่วไป','ไม่ได้ผูกบัญชี','ประวัติร้าน','14 ต.ค.']],
   'categories':[['กาแฟ','6 สินค้า','เปิดแสดง','09:30'],['ชาและช็อกโกแลต','4 สินค้า','เปิดแสดง','09:20'],['เบเกอรี่','5 สินค้า','เปิดแสดง','09:10']],
   'users':[['นัท','Owner · จัดการร้านและสิทธิ์','ใช้งาน','วันนี้'],['มายด์','Manager · จัดการการขาย','ใช้งาน','วันนี้'],['ก้อง','Staff · รับและเตรียมออเดอร์','ใช้งาน','วันนี้']],
   'activity':[['รับออเดอร์ #BP1024','มายด์ · Manager','สำเร็จ','09:43'],['ปรับสต็อก Oat milk','นัท · Owner','สำเร็จ','09:35'],['แก้ไขราคา Latte','นัท · Owner','สำเร็จ','09:30']],
   'campaigns':[['มื้อเช้าคู่โปรด','Latte + Croissant · ฿150','รอตรวจร่าง','16 ต.ค.'],['ขอบคุณลูกค้าประจำ','ส่วนลดตามเงื่อนไข','อนุมัติแล้ว','15 ต.ค.'],['Coffee hour','8–14 ต.ค.','สิ้นสุดแล้ว','14 ต.ค.']],
   'devices':[['Table 1','BitPOS Mini · โต๊ะ 1','ออนไลน์','ตอนนี้'],['Counter 1','จุดขายหน้าร้าน','ออนไลน์','ตอนนี้'],['Table 2','ยังไม่มีเครื่องที่เชื่อมต่อ','ออฟไลน์','—']],
   'refunds':[['#BP1011','ร้านปฏิเสธ · ฿205','คืนเงินแล้ว','16 ต.ค.'],['#BP1008','รายการไม่ครบ · ฿75','กำลังดำเนินการ','15 ต.ค.']],
   'payouts':[['16 ต.ค.','ยอดสุทธิ ฿16,980','รอรอบโอน','วันนี้'],['15 ต.ค.','ยอดสุทธิ ฿14,520','โอนสำเร็จ','15 ต.ค.']]
  }.get(k,[['รายการวันนี้','ดูรายละเอียดรายการ','สำเร็จ','09:42']])
  s.field(x,216,760,'','ค้นหารายการ',icon='search');s.btn(1056,227,352,'เพิ่มสินค้า' if k=='products' else 'เพิ่มลูกค้า' if k=='customers' else 'สร้างโปรโมชัน' if k=='campaigns' else 'ส่งออกข้อมูล' if k=='export' else 'เพิ่มรายการ','P07' if k=='products' else 'P23' if k=='customers' else 'P34' if k=='campaigns' else 'P01',icon='plus');s.pill(x,316,'ทั้งหมด',w=95);s.pill(x+108,316,'ตัวกรอง',w=99);s.text(1408,339,f'{len(data)} รายการตัวอย่าง',12,C['muted'],anchor='end');table(s,x,379,ww,headers,data,[270,470,220,184]);s.rect(x,810,ww,111,C['white'],18,C['line']);s.text(x+24,850,'ดูรายละเอียดก่อนดำเนินการ',17,weight=600);s.text(x+24,885,'การแก้ไขข้อมูลสำคัญแยกตามสิทธิ์ของผู้ใช้งาน และบันทึกประวัติทุกครั้ง',14,C['muted']);s.links.append({'name':None,'dest':'P04' if k=='bills' else 'P07' if k=='products' else 'P23' if k=='customers' else 'P34' if k=='campaigns' else 'P01','rect':[x,427,ww,65]})
 return s

def pay_screen(d):
 k=d['kind']
 if k in ['product','cart','methods','pending','refund','pay-review']:
  s=user_screen({**d,'kind':k,'surface':'pay'});s.a=[a.replace('฿205','฿170') for a in s.a];mapping={'U06':'W02','U11':'W04','U15':'W05','U26':'W22','U30':'W21','U18':'W10','U12':'W20'};s.links=[{**a,'dest':mapping.get(a['dest'],a['dest'])} for a in s.links];return s
 if k=='pay-menu':
  s=user_screen({**d,'kind':'restaurant','surface':'pay'});s.a=[a.replace('15–25 นาที','สั่งที่ร้าน').replace('ส่ง ฿35','โต๊ะ 1') for a in s.a];s.links=[{**a,'dest':{'U06':'W01','U10':'W03','U11':'W04'}.get(a['dest'],a['dest'])} for a in s.links];return s
 if k=='pay-desktop':
  s=SVG(1280,900);s.logo(65,35,132);s.text(1216,67,'ไทย / EN',14,C['muted'],anchor='end');s.rect(64,120,690,700,C['white'],24,C['line']);s.text(96,172,'BitPOS Coffee House',27,weight=600);s.pill(96,200,'โต๊ะ 1 · #BP1024',w=169);s.photo('latte',96,268,270,193,16);s.photo('croissant',391,268,270,193,16);table(s,96,490,626,['รายการ','จำนวน','ยอด'],[['Iced oat latte','1','฿95'],['Butter croissant','1','฿75']],[400,90,136]);s.rect(786,120,430,700,C['white'],24,C['line']);s.text(818,172,'ยอดชำระ',19,weight=600);s.text(818,235,'฿170',48,C['primary'],600);s.cardrow(818,289,366,'PromptPay','สแกนผ่านแอพธนาคาร',icon='qr');s.cardrow(818,385,366,'กระเป๋า Solana','เลือกสินทรัพย์ที่รองรับ',icon='wallet');s.btn(818,595,366,'ดำเนินการชำระเงิน','W06');s.wrap(818,707,'ตรวจรายการและยอดก่อนชำระ\nสถานะจะอัปเดตเมื่อได้รับการยืนยัน',size=14,c=C['muted']);return s
 s=mbase(d['title'],back=True,nav=False);s.logo(24,128,110);s.text(366,153,'โต๊ะ 1',13,C['muted'],anchor='end')
 if k in ['pay-help','pay-coupon']:
  s.text(24,216,'คูปองที่ใช้ได้' if k=='pay-coupon' else 'ให้เราช่วยคุณ',24,weight=600)
  for j,(a,b) in enumerate([('มื้อเช้าคู่โปรด · ลด ฿20','ขั้นต่ำ ฿150 · ถึง 31 ต.ค.'),('ส่งฟรีใกล้บ้าน','ดูเงื่อนไขร้านที่ร่วมรายการ')] if k=='pay-coupon' else [('ตรวจสอบยอดชำระ','ออเดอร์ #BP1024'),('อาหารและการรับสินค้า','ติดต่อพนักงานของร้าน'),('การคืนเงิน','ดูสถานะและหมายเลขเรื่อง')]):s.cardrow(24,253+j*110,342,a,b,icon='card' if k=='pay-coupon' else 'chat',dest='W05' if k=='pay-coupon' else 'W17')
  s.btn(24,686,342,'ใช้คูปองที่เลือก' if k=='pay-coupon' else 'กลับไปที่รายการ','W05')
 elif k in ['pay-entry','join-table']:
  s.photo('latte',24,191,342,228,24);s.text(24,468,'BitPOS Coffee House',25,weight=600);s.text(24,507,'ยินดีต้อนรับ · โต๊ะ 1',17,C['muted']);s.wrap(24,551,'เลือกอาหารจากมือถือ\nร้านจะเตรียมและแจ้งเมื่อพร้อมรับ',size=16,c=C['muted']);s.btn(24,686,342,'เปิดเมนู' if k=='pay-entry' else 'ยืนยันเข้าร่วมโต๊ะ','W02');s.text(195,787,'ตรวจหมายเลขโต๊ะก่อนเริ่มสั่ง',12,C['muted'],anchor='middle')
 elif k in ['wallet','promptpay']:
  s.text(24,216,'ยอดชำระ ฿170',29,weight=600)
  if k=='wallet':s.cardrow(24,259,342,'Phantom','เปิดกระเป๋าเงินเพื่อเชื่อมต่อ',icon='wallet',dest='W10');s.cardrow(24,356,342,'เลือกสินทรัพย์','USDG / สินทรัพย์ที่ร้านรองรับ',icon='card');s.pill(24,461,'เครือข่ายทดสอบ Solana devnet',color='orange',w=293);s.wrap(24,531,'ตรวจสินทรัพย์ ผู้รับ และยอดในกระเป๋า\nก่อนยืนยันการชำระทุกครั้ง',size=15,c=C['muted']);s.btn(24,686,342,'เปิดกระเป๋าเงิน','W10')
  else:
   s.rect(73,252,244,244,C['white'],20,C['line']);s.text(195,283,'QR ตัวอย่างสำหรับงานออกแบบ',10,C['muted'],anchor='middle')
   for a,b in [(99,309),(225,309),(99,414)]:s.rect(a,b,52,52,C['ink'],3);s.rect(a+9,b+9,34,34,C['white'],1);s.rect(a+17,b+17,18,18,C['ink'],1)
   for a in range(7):
    for b in range(5):
     if (a*7+b*3)%4==1:s.rect(166+a*12,375+b*12,9,9,C['ink'],0)
   s.text(195,552,'QR ใช้ได้อีก 04:59',15,C['muted'],anchor='middle');s.btn(24,686,342,'ตรวจสอบสถานะ','W09');s.text(195,787,'ไม่นำ QR ในแบบออกแบบไปชำระเงินจริง',11,C['muted'],anchor='middle')
 elif k in ['paid','receipt','pickup-ready']:
  s.rect(147,193,96,96,C['greenbg'],48);s.icon('check',173,219,45,C['green']);s.text(195,337,'พร้อมรับที่เคาน์เตอร์' if k=='pickup-ready' else 'ชำระเงินสำเร็จ',26,weight=600,anchor='middle');s.text(195,379,'#BP1024 · BitPOS Coffee House',13,C['muted'],anchor='middle');s.metric(24,417,342,'ยอดชำระแล้ว','฿170','16 ตุลาคม · 09:42');s.cardrow(24,554,342,'Iced oat latte + Croissant','2 รายการ · โต๊ะ 1',icon='orders');s.btn(24,686,342,'ดูใบเสร็จ' if k=='paid' else 'ดูสถานะอาหาร' if k=='receipt' else 'รับทราบ','W12' if k=='paid' else 'W13' if k=='receipt' else 'W02');s.text(195,787,'บันทึกประวัติการชำระเรียบร้อยแล้ว',12,C['muted'],anchor='middle')
 else:
  warning=k in ['expired','pay-failed','recovery','offline'];s.rect(147,200,96,96,C['peach'] if warning else C['tint'],48);s.icon('refresh' if k not in ['expired','pay-failed'] else 'clock',173,226,44,C['orange'] if warning else C['primary']);s.text(195,350,d['title'],25,weight=600,anchor='middle');msg={'confirming':'ได้รับธุรกรรมแล้ว กำลังรอการยืนยัน\nไม่ต้องส่งชำระซ้ำ','expired':'ราคาและเวลาชำระของรายการนี้หมดอายุ\nตรวจราคาใหม่ก่อนดำเนินการ','pay-failed':'ยังไม่ได้รับการยืนยันยอดชำระ\nตรวจประวัติก่อนลองอีกครั้ง','recovery':'พบรายการที่ต้องตรวจสอบเพิ่มเติม\nทีมงานจะตรวจยอดและแจ้งผลให้คุณ','offline':'เราจะตรวจสถานะเดิมเมื่อเชื่อมต่อได้\nไม่ต้องสร้างรายการใหม่หรือชำระซ้ำ'}.get(k,'กำลังตรวจสอบการชำระของคุณ');s.wrap(28,402,msg,maxchars=38,size=15,c=C['muted']);s.cardrow(24,518,342,'ออเดอร์ #BP1024','เก็บสถานะรายการเดิมไว้',icon='orders');s.btn(24,686,342,'ตรวจราคาใหม่' if k=='expired' else 'ตรวจสอบสถานะ','W05' if k=='expired' else 'W11' if k=='confirming' else 'W09');s.btn(24,752,342,'ขอความช่วยเหลือ','W21',style='outline')
 return s

def pay_desktop_screen(d):
 k=d['kind'];s=SVG(1440,1000);s.logo(96,28,143);s.text(1250,60,'ไทย / English',14,C['muted'],anchor='end');s.pill(1280,35,'โต๊ะ 1',w=64);s.line(96,98,1344,98);s.text(96,136,'BitPOS Coffee House',14,C['muted']);s.text(96,178,d['title'],29,weight=600)
 s.pill(1096,145,'Solana devnet · Test assets',color='orange',w=248)
 s.rect(96,210,744,680,C['white'],24,C['line']);s.rect(872,210,472,680,C['white'],24,C['line']);s.text(124,253,'รายการของคุณ',20,weight=600);s.text(812,253,'#D1042 · โต๊ะ 1',13,C['muted'],anchor='end')
 if k=='menu':
  s.field(124,286,688,'','ค้นหาเมนูที่ชอบ',icon='search')
  for j,(photo,name,price) in enumerate([('latte','Latte','USD 0.10'),('iced-latte','Iced oat latte','USD 0.095'),('croissant','Butter croissant','USD 0.075'),('matcha','Matcha latte','USD 0.12')]):
   x=124+(j%2)*355;y=384+(j//2)*218;s.rect(x,y,333,201,C['bg'],18);s.photo(photo,x+12,y+12,130,125,14);s.text(x+157,y+46,name,15,weight=600);s.text(x+157,y+82,price,17,C['primary'],600);s.btn(x+157,y+116,162,'ดูเมนู','WD23',style='secondary',h=44)
 elif k=='options':
  s.photo('iced-latte',124,283,337,305,20);s.text(489,314,'Iced oat latte',24,weight=600);s.text(489,353,'USD 0.095',23,C['primary'],600);s.text(489,409,'ระดับความหวาน',15,weight=600)
  for j,t in enumerate(['0%','25%','50%']):s.pill(489+j*103,432,t,w=91)
  s.cardrow(489,500,323,'นมโอ๊ต','เลือกแล้ว',icon='check');s.wrap(124,651,'ตรวจราคาและตัวเลือกอีกครั้งก่อนเพิ่ม\nราคาอาจเปลี่ยนตามตัวเลือกที่คุณเลือก',size=15,c=C['muted']);s.btn(124,771,688,'เพิ่มลงตะกร้า · USD 0.095','WD24')
 elif k=='loading':
  for y,w in [(292,570),(339,688),(396,688),(461,540),(532,600)]:s.rect(124,y,w,28,C['bg'],10)
  s.text(124,650,'กำลังโหลดบิลจากร้าน…',19,C['muted']);s.text(124,692,'เมื่อข้อมูลพร้อม จะแสดงรายการและยอดชำระที่ตรวจสอบได้',14,C['muted'])
 else:
  s.cardrow(124,284,688,'Iced oat latte','หวาน 25% · นมโอ๊ต · 1 แก้ว',photo='iced-latte',right='USD 0.095');s.cardrow(124,380,688,'Butter croissant','อุ่นร้อน · 1 ชิ้น',photo='croissant',right='USD 0.075');s.line(124,503,812,503);s.text(124,543,'ยอดรวมตามบิล',17,weight=600);s.text(812,543,'USD 0.17',27,C['primary'],600,'end');s.text(124,588,'สแกนสั่งที่โต๊ะ 1 · รายการเดิมไม่เปลี่ยนเมื่อเปิดดูเมนู',14,C['muted']);s.btn(124,630,323,'ดูเมนู','WD02',style='outline',icon='coffee');s.btn(462,630,350,'ดูรายละเอียดบิล','WD10',style='outline',icon='orders');s.rect(124,725,688,112,C['bg'],16);s.icon('shield',144,746,26);s.text(186,754,'ตรวจสอบยอดก่อนยืนยัน',16,weight=600);s.wrap(186,787,'ข้อมูลในหน้านี้มาจากบิลของร้าน\nหากส่งธุรกรรมแล้ว ให้ตรวจรายการเดิมแทนการชำระซ้ำ',size=13,maxchars=64,c=C['muted'])
 x=900;w=416
 states={
 'wallet':('เชื่อมต่อกระเป๋าเงิน','เปิดกระเป๋าบนคอมพิวเตอร์เพื่อยืนยัน','wallet'),
 'assets':('เลือกสินทรัพย์ชำระ','เลือกได้จากรายการที่ร้านอนุญาต','wallet'),
 'asset-unknown':('กำลังตรวจคำขอเลือกเหรียญ','คำขอเดิมยังไม่ทราบผล จึงยังเปลี่ยนเหรียญไม่ได้','refresh'),
 'approval':('รออนุมัติในกระเป๋าเงิน','ตรวจผู้รับ สินทรัพย์ และยอดในหน้ากระเป๋า','wallet'),
 'sending':('กำลังส่งธุรกรรม','เก็บรายการเดิมไว้ ไม่ต้องลงนามใหม่','refresh'),
 'confirming':('กำลังยืนยันการชำระ','ยังไม่ต้องชำระอีกครั้ง','clock'),
 'paid':('ได้รับชำระเงินแล้ว','ขอบคุณครับ ร้านได้รับการยืนยันแล้ว','check'),
 'receipt':('ใบเสร็จการชำระ','บันทึกยอดและรายการตามบิลเดิม','orders'),
 'expired':('บิลนี้หมดเวลาแล้ว','อย่าชำระบิลเดิม กรุณาขอรายการใหม่จากร้าน','clock'),
 'recovery':('รายการนี้ต้องตรวจสอบ','อย่าชำระซ้ำ ให้ร้านช่วยตรวจรายการเดิม','shield'),
 'offline':('การเชื่อมต่อขาดหาย','ตรวจสถานะเดิมอีกครั้งเมื่อเชื่อมต่อได้','refresh'),
 'saved':('พบรายการชำระที่บันทึกไว้','ตรวจรายการเดิม โดยไม่ลงนามหรือสร้างคำขอใหม่','shield'),
 'consent':('บันทึกบัญชีกับร้านนี้','เลือกได้เอง ไม่จำเป็นต่อการชำระบิล','user'),
 'pickup':('อาหารพร้อมรับแล้ว','ไปรับที่เคาน์เตอร์ของร้านได้เลย','coffee'),
 'promptpay':('PromptPay','ตัวอย่างช่องทางที่วางแผน ยังไม่เปิดใช้งาน','qr'),
 'refund':('ติดตามการคืนเงิน','ยอดคืนต้องได้รับการยืนยันจากผู้ให้บริการ','wallet'),
 'loading':('กำลังตรวจข้อมูลชำระ','โปรดรอให้ข้อมูลบิลและสินทรัพย์พร้อม','refresh'),
 'error':('ยังชำระไม่สำเร็จ','ตรวจสถานะธุรกรรมก่อนลองใหม่','shield'),
 'x402':('Exact USDC · x402 V2','เลือกได้เมื่อร้านเปิดช่องทางนี้และไม่มีรายการค้าง','wallet'),
 'identity':('บันทึกบัญชีแล้ว','ผูกกับกระเป๋าที่คุณยืนยันกับร้านนี้','user'),
 'join':('ยืนยันโต๊ะของคุณ','ตรวจหมายเลขโต๊ะก่อนเริ่มสั่ง','pin'),
 'done':('เสร็จเรียบร้อย','กลับเมนูใน 10 วินาที','check')}
 if k in states:
  title,sub,ic=states[k];tone='green' if k in ['paid','receipt','pickup','done','identity'] else 'orange' if k in ['expired','recovery','offline','error','promptpay'] else 'primary';s.rect(x+165,247,86,86,C['greenbg'] if tone=='green' else C['peach'] if tone=='orange' else C['tint'],43);s.icon(ic,x+186,269,43,C['green'] if tone=='green' else C['orangeInk'] if tone=='orange' else C['primary']);s.text(x+w/2,377,title,22,weight=600,anchor='middle');s.wrap(x+12,417,sub,size=14,maxchars=42,c=C['muted']);y=493
 else:s.text(x,257,'ยอดชำระ',16,C['muted']);s.text(x,319,'0.170000',42,C['primary'],600);s.text(x+227,317,'USDG',22,C['primary'],600);s.text(x,352,'สินทรัพย์ทดสอบ · ไม่ใช่เงินจริงที่แลกคืนได้',13,C['muted']);y=399
 if k in ['menu','options','cart','checkout','wallet','assets','x402']:
  
  if k!='assets':s.cardrow(x,y,w,'Phantom','กระเป๋าบนคอมพิวเตอร์',icon='wallet',dest='WD03');y+=100
  else:y=475
  if k=='assets':
   for j,(a,b) in enumerate([('Test USDG','0.170000 USDG · เลือกอยู่'),('Test USDC','0.170000 USDC · ตามสิทธิ์ร้าน'),('BitPOS USDT-test','สินทรัพย์ทดสอบที่ร้านอนุญาต')]):s.cardrow(x,y+j*86,w,a,b,icon='check' if j==0 else 'wallet',dest='WD01')
  else:s.field(x,y,w,'สินทรัพย์ที่เลือก','Test USDG · 0.170000',icon='wallet');s.links.append({'name':None,'dest':'WD04','rect':[x,y,w,78]});y+=109;s.text(x,y,'ร้านออกค่าธรรมเนียมเครือข่ายให้',14,C['green']);s.text(x,y+29,'ไม่ต้องเติม SOL เพื่อชำระบิลนี้',13,C['muted'])
  dest='WD23' if k=='menu' else 'WD24' if k=='options' else 'WD01' if k=='cart' else 'WD06';label='ตรวจสอบตะกร้า' if k=='menu' else 'ดูตะกร้า' if k=='options' else 'ตรวจสอบและชำระ' if k=='cart' else 'ยืนยันชำระ 0.170000 USDG';s.btn(x,766,w,label,dest);s.text(x+w/2,853,'อนุมัติการชำระในกระเป๋าเงินของคุณ',12,C['muted'],anchor='middle')
 elif k=='consent':
  for j,(a,b) in enumerate([('อนุญาตบันทึกโปรไฟล์กับร้าน','ใช้ข้อมูลที่คุณยืนยันเท่านั้น'),('อนุญาตใช้ประวัติการซื้อ','เพื่อแสดงบริบทและสิทธิ์ที่เกี่ยวข้อง')]):s.rect(x,y+j*94,23,23,C['white'],5,C['line']);s.text(x+38,y+19+j*94,a,15,weight=600);s.text(x+38,y+49+j*94,b,12,C['muted'])
  s.btn(x,766,w,'ยืนยันความยินยอม','WD22');s.btn(x,828,w,'ไว้ภายหลัง','WD01',style='outline',h=38)
 elif k=='promptpay':s.pill(x,y,'ยังไม่พร้อมให้บริการ',color='orange',w=220);s.wrap(x,y+68,'เปิดได้เมื่อร้านเชื่อมผู้ให้บริการ\nและทดสอบการยืนยันยอดแล้วเท่านั้น',size=15,c=C['muted']);s.btn(x,766,w,'กลับไปวิธีชำระที่พร้อมใช้','WD01',style='outline')
 elif k=='join':s.cardrow(x,y,w,'โต๊ะ 1','BitPOS Coffee House',icon='pin');s.btn(x,766,w,'เข้าร่วมโต๊ะและเปิดเมนู','WD02')
 elif k in ['paid','receipt','pickup','done','identity']:
  s.metric(x,y,w,'ยอดชำระแล้ว','0.170000 USDG','บิล USD 0.17 · หลักฐานตามรายการเดิม');s.text(x,y+156,'ออเดอร์ #D1042 · โต๊ะ 1',14,C['muted']);s.btn(x,766,w,'เสร็จแล้ว' if k=='paid' else 'รับทราบ' if k=='pickup' else 'เปิดเมนูตอนนี้' if k=='done' else 'ดูสถานะอาหาร','WD26' if k=='paid' else 'WD02' if k=='done' else 'WD16');s.text(x+w/2,853,'รับทราบการแจ้ง ≠ รับสินค้าแล้ว' if k=='pickup' else 'ดูใบเสร็จและหลักฐานการชำระได้เสมอ',12,C['muted'],anchor='middle')
 else:
  s.cardrow(x,y,w,'ออเดอร์ #D1042','Test USDG · 0.170000',icon='orders');s.wrap(x,y+128,'การเปลี่ยนสินทรัพย์และการชำระใหม่\nจะถูกพักไว้ขณะตรวจรายการเดิม',size=14,c=C['muted']);dest='WD08' if k in ['saved','sending','approval'] else 'WD09' if k=='confirming' else 'WD04' if k=='asset-unknown' else 'WD01';s.btn(x,766,w,'ตรวจคำขอเลือกเหรียญเดิม' if k=='asset-unknown' else 'ตรวจรายการชำระเดิม' if k=='saved' else 'ตรวจสอบสถานะ',dest);s.text(x+w/2,853,'ขอให้พนักงานช่วยตรวจสอบได้เมื่อจำเป็น',12,C['muted'],anchor='middle')
 s.text(96,946,'Powered by BitPOS',13,C['muted']);s.text(1344,946,'แบบออกแบบ · บิลและสินทรัพย์เป็นข้อมูลตัวอย่าง',12,C['muted'],anchor='end');return s

def foundation():
 s=SVG(1440,1080,C['white']);s.logo(48,40,190);s.text(48,161,'A good day, delivered.',48,weight=600);s.text(48,211,'BitPOS Platform UI · Foundations',21,C['muted']);s.text(48,267,'01 / Colour with a purpose',23,weight=600)
 for j,key in enumerate(['primary','action','orange','ink','bg','line','green','red']):
  x=48+j*170;s.rect(x,294,150,111,C[key],18,C['line']);s.text(x,438,key.title(),15,weight=600);s.text(x,465,C[key],13,C['muted'])
 s.text(48,536,'02 / Typography',23,weight=600);s.text(48,605,'มื้ออร่อย เริ่มที่นี่',40,weight=600);s.text(48,655,'Noto Sans Thai · ไทย / English',20,C['muted']);s.text(48,707,'TH 16 / 26  ·  Caption 12 / 20  ·  Money 28 / 36',16);s.text(780,536,'03 / Rhythm & geometry',23,weight=600)
 for j,v in enumerate([4,8,12,16,24,32,48]):s.rect(780+j*78,579,v,64,C['tint'],min(v/2,12));s.text(780+j*78,675,str(v),14,C['muted'])
 s.text(48,795,'04 / Icon language',23,weight=600)
 for j,key in enumerate(['home','orders','bike','car','pin','wallet','shield','chat','box','chart','settings','qr']):s.rect(48+j*110,825,86,86,C['bg'],20);s.icon(key,74+j*110,850,34);s.text(91+j*110,944,key,11,C['muted'],anchor='middle')
 s.text(48,1021,'44–48 px touch targets · 24 px mobile margins · 8 px spacing rhythm · labels always accompany state colours',16,C['muted']);return s
def cover():
 s=SVG(1600,1000,C['white']);s.rect(0,0,1600,264,C['primary'],0);s.logo(58,45,205);s.text(58,170,'One platform. Every order connected.',49,C['white'],600);s.text(58,222,'BitPOS · Customer / Rider / Merchant / Pay',22,'#E8D5F4');s.text(58,325,'เปิด Pages ทางซ้ายเพื่อเลือกชุดงาน',25,weight=600)
 for j,(ic,title,sub,code) in enumerate([('coffee','01 Customer app','สั่งอาหารและติดตามออเดอร์','U06'),('bike','02 Rider app','รับงาน นำทาง และรายได้','R06'),('orders','03 POS website','ร้าน ครัว คลัง และออเดอร์ออนไลน์','P29'),('wallet','04 Pay website','เมนูโต๊ะ ชำระเงิน และใบเสร็จ','W01')]):
  x=58+j*386;s.rect(x,367,356,305,C['bg'],24,C['line']);s.rect(x+24,392,64,64,C['tint'],18);s.icon(ic,x+40,408,32);s.text(x+24,507,title,24,weight=600);s.wrap(x+24,548,sub,maxchars=27,size=15,c=C['muted']);
  if j in [2,3]:s.btn(x+24,596,145,'Desktop','P29' if j==2 else 'WD01');s.btn(x+181,596,151,'Mobile','S11' if j==2 else 'W01',style='outline')
  else:s.btn(x+24,596,308,'เปิดชุดหน้าจอ',code)
 s.rect(58,719,1484,177,C['tint'],24);s.text(85,766,'UI master · Editable source · v1.0',27,weight=600);s.text(85,810,'อาหารและไรเดอร์มาก่อน / รถรับส่งผู้โดยสารอยู่ในหมวด Later',18);s.text(85,852,'ข้อมูล ราคา ชื่อบุคคล ตำแหน่ง และ QR ทั้งหมดเป็นตัวอย่างงานออกแบบ',15,C['muted']);s.text(58,953,'16 OCT 2026  ·  Foundations, component library, complete flows, error states and implementation handoff',15,C['muted']);return s
def handoff():
 s=SVG(1600,1100,C['white']);s.logo(48,30,150);s.text(48,137,'From design to a working BitPOS',43,weight=600);s.text(48,188,'Implementation contract / ข้อตกลงการนำ UI ไปพัฒนา',21,C['muted'])
 rows=[('FOOD FIRST','U01–U38 / R01–R26,R32 / P01–P41 / W01–W22','อาหาร รับเอง ไรเดอร์ เว็บร้าน และชำระเงิน'),('RIDES LATER','U39–U43 / R27–R31','ออกแบบไว้ครบ แต่นำไปพัฒนาหลัง flow อาหาร'),('AUTHORITATIVE STATE','Payment ≠ Kitchen ≠ Delivery','ชำระแล้ว / รับอาหารจากร้าน / ส่งถึงลูกค้า แยกสถานะ'),('SAFE RECOVERY','Retry same request · Restore snapshot','ออฟไลน์แล้วกลับมาใช้สถานะเดิม ไม่สร้างบิลหรือชำระซ้ำ'),('LOCATION','Permission · Background · Stale / No location','ตำแหน่งขาดหายต้องแสดงตามจริง ไม่สร้างพิกัดสมมติ'),('RIGHTS & PROVENANCE','Upstream UI reference + original BitPOS artwork','เก็บที่มา template ฟอนต์ ภาพ และสิทธิ์ก่อนเผยแพร่')]
 for j,(a,b,c) in enumerate(rows):
  y=233+j*117;s.rect(48,y,1504,98,C['bg'],18);s.text(72,y+33,a,13,C['primary'],600);s.text(359,y+35,b,20,weight=600);s.text(359,y+72,c,16,C['muted'])
 s.text(48,1001,'Screens are design specifications, not proof that live integrations, payments or device tests passed.',17,C['muted']);s.text(48,1044,'Use screen-map.json + tokens.json + interaction-map.json; keep existing server-side roles and payment invariants.',15,C['muted']);return s

PAGES={'cover':'00 - Start here','foundation':'01 - Foundations','components':'02 - Components','reference':'03 - Upstream base reference','user':'10 - User App - Food and Account','user-rides':'11 - User App - Rides Later','rider':'20 - Rider App - Delivery','rider-rides':'21 - Rider App - Rides Later','pos':'30 - POS Website - Desktop','pos-mobile':'31 - POS Website - Mobile','pay-desktop':'40 - Pay Website - Desktop','pay':'41 - Pay Website - Mobile','states':'50 - States and Responsive','handoff':'60 - Developer Handoff'}
manifest=[];links=[];commands=[{'command':'file.new','params':{'name':'BitPOS - Platform UI Master'}}]
def emit(d,s,page,index):
 p=SCREENS/f'{d["id"]}-{d["slug"]}.svg';s.save(p);x=(index%4)*(s.w+96);y=(index//4)*(s.h+116)
 commands.append({'command':'file.import','params':{'path':str(p),'x':x,'y':y}})
 manifest.append({**d,'page':page,'width':s.w,'height':s.h,'source':str(p.relative_to(OUT)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'phase':'later' if d.get('future') else 'food-first','fixture':True})
 links.extend({'source':d['id'],**v} for v in s.links)
def page(name,first=False):commands.append({'command':'page.rename' if first else 'page.add','params':{'name':PAGES[name]}})
page('cover',True);emit({'id':'A00','slug':'cover','title':'Start here','surface':'guide','kind':'cover'},cover(),PAGES['cover'],0)
page('foundation');emit({'id':'D01','slug':'foundations','title':'Design foundations','surface':'system','kind':'foundation'},foundation(),PAGES['foundation'],0)
page('components')
for j,(label,sty,dis) in enumerate([('Primary / Default','primary',False),('Primary / Disabled','primary',True),('Secondary / Default','secondary',False),('Outline / Default','outline',False),('Danger / Default','danger',False)]):
 s=SVG(390,180,C['white']);s.text(24,43,label,16,weight=600);s.btn(24,75,342,'ดำเนินการต่อ',style=sty,name='component-button');
 if dis:s.rect(24,75,342,52,'#FFFFFF99',14)
 emit({'id':f'D{j+2:02}','slug':'button-'+str(j),'title':'Button / '+label,'surface':'system','kind':'component','component':True},s,PAGES['components'],j)
for j,(title,kind) in enumerate([('Search and form fields','fields'),('Order status badges','badges'),('Food and driver cards','cards'),('Navigation and feedback','nav')]):
 s=SVG(700,540,C['white']);s.text(24,46,title,25,weight=600)
 if kind=='fields':s.field(24,102,342,'ที่อยู่จัดส่ง','บ้าน · สุขุมวิท 49',icon='pin');s.field(24,215,342,'ค้นหา',hint='ค้นหาร้านหรือเมนู',icon='search');s.field(24,330,342,'หมายเลขโทรศัพท์','+66 81 234 5678');s.text(24,440,'Error · กรุณาตรวจหมายเลขโทรศัพท์',14,C['red'])
 elif kind=='badges':
  for t,(a,b) in enumerate([('รับออเดอร์แล้ว','primary'),('กำลังทำ','orange'),('พร้อมรับ','green'),('กำลังส่ง','blue'),('ยกเลิกแล้ว','red'),('รอชำระ','orange'),('ชำระแล้ว','green'),('คืนเงินบางส่วน','blue')]):s.pill(24+(t%3)*220,102+(t//3)*95,a,b,195)
 elif kind=='cards':s.cardrow(24,108,600,'Iced oat latte','หวาน 25% · นมโอ๊ต',photo='iced-latte',right='฿95');s.cardrow(24,218,600,'ก้อง · ไรเดอร์','รถจักรยานยนต์ · ★ 4.9',icon='bike');s.metric(24,328,600,'ยอดสุทธิร้าน','฿16,980','ข้อมูลตัวอย่างสำหรับออกแบบ')
 else:
  for t,(ic,txt) in enumerate([('home','หน้าแรก'),('orders','กิจกรรม'),('heart','รายการโปรด'),('user','บัญชี')]):s.icon(ic,50+t*160,118,30);s.text(65+t*160,178,txt,13,anchor='middle')
  s.rect(24,237,652,86,C['greenbg'],18);s.icon('check',43,265,28,C['green']);s.text(94,286,'บันทึกข้อมูลเรียบร้อยแล้ว',18,C['green'],600);s.rect(24,354,652,100,C['peach'],18);s.text(44,393,'ตำแหน่งไม่ได้อัปเดต',18,C['orange'],600);s.text(44,429,'อัปเดตล่าสุด 2 นาทีที่แล้ว',14,C['muted'])
 emit({'id':f'D{j+7:02}','slug':'kit-'+kind,'title':title,'surface':'system','kind':'component-board'},s,PAGES['components'],j+5)
for surf in ['user','rider','pos','pay']:
 for future in ([False,True] if surf in ['user','rider'] else [False]):
  key=surf+'-rides' if future else surf;page(key)
  for j,d in enumerate([a for a in SC if a['surface']==surf and bool(a.get('future'))==future]):emit(d,(user_screen if surf=='user' else rider_screen if surf=='rider' else pos_screen if surf=='pos' else pay_screen)(d),PAGES[key],j)
page('states')
states=[('S01','empty-cart','ตะกร้ายังว่าง','เลือกเมนูที่ชอบ แล้วเริ่มมื้ออร่อยกัน','cart','U09'),('S02','search-empty','ยังไม่พบร้านที่ค้นหา','ลองเปลี่ยนคำค้นหรือขยายพื้นที่จัดส่ง','search','U07'),('S03','network-offline','การเชื่อมต่อขาดหาย','บันทึกตะกร้าไว้แล้ว ตรวจการเชื่อมต่อก่อนสั่ง','refresh','U11'),('S04','gps-denied','ยังไม่ได้เปิดตำแหน่ง','คุณปักหมุดที่อยู่เองได้ หรือเปิดสิทธิ์ในตั้งค่า','pin','U14'),('S05','location-stale','ตำแหน่งไม่ได้อัปเดต','อัปเดตล่าสุด 2 นาทีที่แล้ว กำลังรอการเชื่อมต่อ','bike','U20'),('S06','store-closed','ร้านปิดรับออเดอร์แล้ว','เปิดอีกครั้งพรุ่งนี้ 08:00 เลือกร้านอื่นได้เลย','coffee','U06'),('S07','price-changed','ราคามีการเปลี่ยนแปลง','โปรโมชันเดิมสิ้นสุดแล้ว ตรวจยอดใหม่ก่อนยืนยัน','wallet','U15'),('S08','payment-unknown','กำลังตรวจสถานะรายการเดิม','อย่าชำระซ้ำ เราจะแสดงผลเมื่อได้รับการยืนยัน','shield','W09'),('S09','item-unavailable','บางรายการหมดชั่วคราว','นำรายการที่หมดออก แล้วตรวจยอดอีกครั้ง','box','U11'),('S10','rider-unassigned','ยังไม่มีไรเดอร์รับงาน','รอต่อ รับเอง หรือให้ทีมช่วยดูแลตามเงื่อนไข','bike','U38')]
for j,(code,sl,t,sub,ic,dest) in enumerate(states):
 s=mbase('แจ้งสถานะ',nav=False);s.rect(137,172,116,116,C['tint'],58);s.icon(ic,170,205,50);s.text(195,352,t,23,weight=600,anchor='middle');s.wrap(30,399,sub,size=15,c=C['muted'],maxchars=34);s.btn(24,654,342,'ดูรายละเอียด' if code in ['S05','S08'] else 'ดำเนินการต่อ',dest);s.btn(24,718,342,'ขอความช่วยเหลือ','U30',style='outline');emit({'id':code,'slug':sl,'title':t,'surface':'states','kind':'state'},s,PAGES['states'],j)
for j,(code,sl,src) in enumerate([('S13','customer-dark','U06'),('S14','rider-dark','R06')]):
 d=next(a for a in SC if a['id']==src);v=(user_screen if src[0]=='U' else rider_screen)(d);idx=next(n for n,a in enumerate(v.a) if 'data:image/png' in a);v.a.insert(idx,'<rect x="18" y="47" width="116" height="45" rx="9" fill="#FCFAFE"/>');emit({'id':code,'slug':sl,'title':'Dark mode / '+d['title'],'surface':'states','kind':'dark','dark':True},v,PAGES['states'],j+12)
translations={'วันนี้อยากทานอะไร?':'What are you craving?','บ้าน · สุขุมวิท 49':'Home · Sukhumvit 49','ค้นหาร้าน เมนู หรือเครื่องดื่ม':'Find food, drinks and cafes','มื้อเช้าที่ลงตัว':'A good morning','กาแฟ + ครัวซองต์':'Coffee + croissant','ลด ฿20':'Save ฿20','กาแฟ':'Coffee','อาหาร':'Food','ของหวาน':'Treats','เรียกรถ':'Rides','ร้านอร่อยใกล้คุณ':'Good food nearby','15–25 นาที · ส่ง ฿35':'15–25 min · delivery ฿35','หน้าแรก':'Home','กิจกรรม':'Activity','รายการโปรด':'Saved','บัญชี':'Account','ศูนย์ออเดอร์':'Order center','จัดการร้านของคุณในที่เดียว':'Your store, connected','สาขาสุขุมวิท':'Sukhumvit branch','ไทย / EN':'EN / ไทย','เปิดรับงาน':'Accepting orders','ภาพรวม':'Overview','หน้าขาย':'Register','คิวครัว':'Kitchen','จัดส่ง':'Delivery','สินค้าและคลัง':'Menu and stock','ลูกค้า':'Customers','โปรโมชัน':'Promotions','รายงาน':'Reports','ตั้งค่า':'Settings','นัท · เจ้าของร้าน':'Nat · Owner','ทั้งหมด  12':'All  12','หน้าร้าน':'Counter','โต๊ะ':'Table','แอพจัดส่ง  8':'Delivery  8','รับเอง  4':'Pickup  4','ใหม่ · 3':'New · 3','กำลังทำ · 4':'Preparing · 4','พร้อมรับ · 3':'Ready · 3','จัดส่ง · 2':'Delivery · 2','แอพส่ง':'Delivery','รับเอง':'Pickup','ชำระแล้ว':'Paid','รับออเดอร์ · เหลือ 01:42':'Accept · 01:42 left','ดูรายละเอียด':'View order'}
for j,(code,sl,src) in enumerate([('E01','customer-home-en','U06'),('E02','pos-orders-en','P29')]):
 d=next(a for a in SC if a['id']==src);v=(user_screen if src[0]=='U' else pos_screen)(d)
 v.a=[a for a in v.a]
 for n,a in enumerate(v.a):
  for th,en in sorted(translations.items(),key=lambda z:-len(z[0])):a=a.replace(E(th),E(en))
  v.a[n]=a
 emit({'id':code,'slug':sl,'title':'English / '+d['title'],'surface':'states','kind':'locale'},v,PAGES['states'],j+14)
page('pos-mobile')
for j,code in enumerate(['S11','S12']):
 s=mbase('ศูนย์ออเดอร์' if j==0 else 'ออเดอร์ #BP1024',nav=False);s.pill(24,136,'แอพจัดส่ง',w=114);s.pill(151,136,'ชำระแล้ว',color='green',w=115)
 for l,(t,sub) in enumerate([('#BP1024 · ใหม่','Iced latte + Croissant · ฿205'),('#BP1023 · กำลังทำ','Latte × 2 · ฿170'),('#BP1022 · พร้อมรับ','Croissant × 1 · ฿75')]):s.cardrow(24,202+l*117,342,t,sub,icon='orders',dest='P31')
 s.btn(24,662,342,'รับออเดอร์ · เตรียม 15 นาที','P30');emit({'id':code,'slug':'pos-mobile-'+str(j),'title':'POS mobile adaptation','surface':'states','kind':'responsive'},s,PAGES['pos-mobile'],j)
page('pay-desktop')
DESKTOP_PAY=[('checkout','ตรวจสอบและชำระเงิน','checkout'),('menu','เมนูของร้านบนคอมพิวเตอร์','menu'),('wallet','เชื่อมต่อกระเป๋าเงิน','wallet'),('assets','สินทรัพย์ที่ร้านรองรับ','assets'),('asset-unknown','ตรวจคำขอเลือกสินทรัพย์เดิม','asset-unknown'),('approval','อนุมัติในกระเป๋าเงิน','approval'),('sending','กำลังส่งการชำระ','sending'),('confirming','รอการยืนยันจากเครือข่าย','confirming'),('paid','ชำระเงินสำเร็จ','paid'),('receipt','ใบเสร็จและหลักฐาน','receipt'),('expired','บิลหมดเวลา','expired'),('recovery','รายการต้องตรวจสอบ','recovery'),('offline','การเชื่อมต่อขาดหาย','offline'),('saved','กลับมาตรวจรายการเดิม','saved'),('consent','ความยินยอมและบัญชีลูกค้า','consent'),('pickup','อาหารพร้อมรับ','pickup'),('promptpay-planned','PromptPay - Planned','promptpay'),('refund','ติดตามการคืนเงิน','refund'),('loading','กำลังโหลดบิล','loading'),('error','การชำระยังไม่สำเร็จ','error'),('x402','ชำระ exact USDC ผ่าน x402 V2','x402'),('identity','บัญชีที่ผูกกับร้านนี้','identity'),('options','เลือกตัวเลือกเมนู','options'),('cart','ตรวจสอบตะกร้า','cart'),('join-table','ยืนยันโต๊ะของคุณ','join'),('done','เสร็จแล้วและกลับเมนู','done')]
for j,(sl,title,kind) in enumerate(DESKTOP_PAY):
 d={'id':f'WD{j+1:02}','slug':sl,'title':title,'surface':'pay-desktop','kind':kind,'source_basis':'Payment.tsx / OrderBill.tsx / PayMenu.tsx / TableMenu.tsx','planned':kind in ['promptpay','refund','options']};emit(d,pay_desktop_screen(d),PAGES['pay-desktop'],j)
page('handoff');emit({'id':'A01','slug':'handoff','title':'Developer handoff','surface':'guide','kind':'handoff'},handoff(),PAGES['handoff'],0)

# Keep the original GitHub screens as explicitly labelled visual references inside the SAME file.
page('reference')
upstream=Path('/tmp/bitpos-flutter-base-review-20261016/screens')
for j,n in enumerate(['home_screen.jpg','detail_screen.jpg','add_to_cart_screen.jpg','login_screen.jpg','signin_scren.jpg']):
 if (upstream/n).exists():commands.append({'command':'file.import','params':{'path':str(upstream/n),'x':j*550,'y':100}})
commands.append({'command':'node.create','params':{'type':'text','x':0,'y':0,'text':'REFERENCE ONLY · Tarikul711 Flutter UI (2020) · Original BitPOS redesign is on User App pages','props':{'fontSize':22,'fontFamily':'Inter','fill':C['ink']}}})
(OUT/'reports/import-commands.json').write_text(json.dumps(commands,ensure_ascii=False,indent=2))
(OUT/'handoff/screen-map.json').write_text(json.dumps({'version':'1.0.0','screens':manifest,'count':len(manifest),'pages':PAGES,'upstream_commit':'201e1387c31c3a1cfe4e790680e33b3c9bc6c73b'},ensure_ascii=False,indent=2)+'\n')
(OUT/'handoff/interaction-map.json').write_text(json.dumps(links,ensure_ascii=False,indent=2)+'\n')
print(f'Generated {len(manifest)} original editable screens/boards and {len(links)} prototype destinations.')
if __name__=='__main__':
 with (OUT/'reports/import-results.jsonl').open('w') as log:
  subprocess.run([str(CLI),'run',str(OUT/'reports/import-commands.json'),'--out',str(OUT/'BitPOS-Platform-UI.figcraft')],stdout=log,check=True)
 print('Native FigCraft master saved.')
