import sys; from hl import *
src, dst = sys.argv[1:3]
def head(f, s):
    rect(f, 70, 50, 290, 44, BG); text(f, s, 76, 60, 20, 'SemiBold', INK, 290)
def clear(f, y0=110, y1=700): rect(f, 0, y0, 390, y1 - y0, BG)
def btn(f, s, y=728, fill=PUR, ink='#FFFFFF'):
    rect(f, 24, y, 342, 52, fill, None, 14); text(f, s, 24, y + 14, 15, 'SemiBold', ink, 342, 'center')
def field(f, label, value, y, h=48):
    text(f, label, 24, y, 12, 'Regular', MUTE); rect(f, 24, y + 22, 342, h, '#FFFFFF', LINE, 12); text(f, value, 40, y + 22 + (h - 20) // 2, 14, 'Regular', INK, 310)
def tile(f, y, t, s, h=76):
    rect(f, 24, y, 342, h, '#FFFFFF', LINE, 16); text(f, t, 44, y + 14, 15, 'SemiBold'); text(f, s, 44, y + 40, 12, 'Regular', MUTE, 300)
def warn(f, s, y, h=64):
    rect(f, 24, y, 342, h, '#FDE8EA', None, 14); text(f, s, 40, y + 12, 13, 'Regular', '#B3261E', 310)
# R11 pickup: a single token field (proof secret is a 32-64 char token); QR scan is planned
f = 3090; rect(f, 20, 340, 350, 250, BG)
text(f, 'กรอกรหัสที่ร้านให้ ตรวจสอบที่เซิร์ฟเวอร์', 24, 352, 14, 'Regular', MUTE, 342)
field(f, 'รหัสจากร้าน/ลูกค้า (32–64 ตัวอักษร)', 'วางรหัสที่นี่', 396)
text(f, 'การสแกน QR ยังเป็นแผนในอนาคต', 24, 480, 12, 'Regular', MUTE, 342)
# R13 delivery proof: token field, photo proof not supported
f = 3181; rect(f, 20, 330, 350, 290, BG)
text(f, 'ยืนยันก่อนส่งมอบ', 24, 292, 22, 'SemiBold') if False else None
field(f, 'รหัสส่งมอบจากลูกค้า (32–64 ตัวอักษร)', 'วางรหัสที่นี่', 366)
rect(f, 24, 460, 342, 70, '#EFE6F8', None, 16); text(f, 'ขั้นตอนนี้ยังไม่รองรับภาพหลักฐาน', 24, 485, 14, 'SemiBold', PUR, 342, 'center')
# R20 help
f = 3531; head(f, 'ช่วยเหลือและความปลอดภัย'); clear(f)
warn(f, 'ระหว่างงาน ใช้ปุ่มรายงานเหตุในหน้างาน นี่ไม่ใช่บริการฉุกเฉิน หากอันตรายให้ติดต่อหน่วยฉุกเฉินก่อน', 130, 80)
tile(f, 230, 'บัญชีและเอกสาร', 'ส่งคำขอไปศูนย์ช่วยเหลือ'); tile(f, 322, 'รายได้และรอบโอน', 'สอบถามเรื่องรายได้และการโอน'); tile(f, 414, 'ติดต่อฝ่ายช่วยเหลือ', 'ดูคำขอเดิมและส่งคำขอใหม่')
# R21 safety: the app's incident dialog with its seven categories
f = 3593; head(f, 'รายงานเหตุ / ขอความช่วยเหลือ'); clear(f)
cats = ('ขอความช่วยเหลือทั่วไป', 'SOS ฉุกเฉิน', 'ชนหรืออุบัติเหตุ', 'ถูกคุกคาม', 'สินค้าหาย', 'ปัญหาการดูแลอาหาร', 'สงสัยทุจริต')
for i, c in enumerate(cats):
    y = 124 + i * 48; rect(f, 24, y, 342, 42, '#FFFFFF', PUR if i == 0 else LINE, 12); text(f, c, 40, y + 10, 14, 'SemiBold' if i == 0 else 'Regular')
field(f, 'รายละเอียดส่วนตัว (จำเป็น)', 'อธิบายสถานการณ์', 468, 72)
text(f, 'ไม่ใช่บริการฉุกเฉิน', 24, 574, 12, 'Regular', '#B3261E', 342)
rect(f, 20, 652, 350, 70, BG); btn(f, 'ส่งรายงาน', 640)
# R25 failed delivery: report a delivery problem
f = 3828; head(f, 'รายงานปัญหาการส่ง'); clear(f)
warn(f, 'งานจะหยุดชั่วคราว คุณยังต้องดูแลอาหารต่อ นี่ไม่ใช่การยกเลิก คืนเงิน หรือจบงาน', 130, 80)
field(f, 'รายละเอียดส่วนตัว (จำเป็น)', 'อธิบายว่าส่งอาหารไม่ได้เพราะอะไร', 240, 96)
btn(f, 'ส่งรายงาน', 640)
# R26 handover: pre-pickup withdrawal only
f = 3887; head(f, 'ถอนตัวจากงานก่อนรับอาหาร'); clear(f)
for i, c in enumerate(('รถมีปัญหา', 'ไปรับไม่ทัน', 'ปัญหาส่วนตัว', 'อื่น ๆ')):
    y = 124 + i * 52; rect(f, 24, y, 342, 44, '#FFFFFF', PUR if i == 0 else LINE, 12); text(f, c, 40, y + 12, 14, 'SemiBold' if i == 0 else 'Regular')
warn(f, 'หลังรับอาหารแล้วปล่อยงานเองไม่ได้ ต้องให้เจ้าหน้าที่ประสาน', 350, 64)
btn(f, 'ถอนตัวจากงาน', 640)
# S11 / S12 POS mobile
f = 9926; rect(f, 20, 650, 350, 80, BG)
text(f, 'รับออเดอร์ได้ในหน้ารายละเอียดเท่านั้น', 24, 676, 13, 'Regular', MUTE, 342, 'center')
f = 9970; rect(f, 20, 300, 350, 130, BG); text(f, 'ยอดอาหาร', 24, 318, 15, 'Regular', MUTE); text(f, '฿170', 300, 318, 15, 'Regular', INK, 66, 'right')
text(f, 'ค่าส่งและค่าบริการดูในรายการที่ล็อกไว้', 24, 352, 13, 'Regular', MUTE, 342)
rect(f, 20, 624, 350, 60, BG); text(f, 'ใส่เวลาเตรียม 1–1440 นาที', 24, 634, 15, 'SemiBold'); text(f, 'ไม่ใช่เวลาที่รับประกันว่าพร้อม', 24, 660, 12, 'Regular', MUTE)
rect(f, 24, 708, 342, 52, '#CBB9D6', None, 14); text(f, 'ใส่เวลาเตรียมก่อนรับออเดอร์', 24, 722, 15, 'SemiBold', '#FFFFFF', 342, 'center')
head(475, 'ค้นหาร้าน')
run(src, dst, 'r2')
