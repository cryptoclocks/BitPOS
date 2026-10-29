import sys; from hl import *
src, dst = sys.argv[1:3]
# P16 receive report: ledger table with a total row
F = 5839; setc(5891, 'รายการรับสินค้าเข้าสต็อกจากบันทึกของเซิร์ฟเวอร์')
rect(F, 232, 190, 1208, 810, BG)
rect(F, 264, 200, 1144, 520, '#FFFFFF', LINE, 16)
rect(F, 272, 212, 1128, 40, '#EFE6F8', None, 10)
for x, s in ((288, 'เวลา'), (520, 'สินค้า'), (900, 'จำนวน'), (1100, 'เหตุผล')): text(F, s, x, 222, 13, 'SemiBold', PUR)
rows = (('29 ต.ค. 09:12', 'Iced latte beans 1 kg', '+12', 'รับสินค้าเข้า'), ('29 ต.ค. 08:40', 'Oat milk 1 L', '+24', 'รับสินค้าเข้า'), ('28 ต.ค. 16:05', 'Butter croissant', '+30', 'รับสินค้าเข้า'), ('28 ต.ค. 10:20', 'Matcha powder 500 g', '+6', 'รับสินค้าเข้า'), ('27 ต.ค. 15:44', 'Paper cup 12 oz', '+200', 'รับสินค้าเข้า'))
for i, r in enumerate(rows):
    y = 268 + i * 52
    for x, s in zip((288, 520, 900, 1100), r): text(F, s, x, y + 8, 14, 'Regular' if x != 900 else 'SemiBold', INK)
    rect(F, 272, y + 44, 1128, 1, LINE)
rect(F, 272, 540, 1128, 44, '#F8F5FC', None, 10); text(F, 'รับเข้าทั้งหมด', 288, 551, 14, 'SemiBold', INK); text(F, '+272', 900, 551, 14, 'SemiBold', PUR)
text(F, 'ไม่รวมการปรับยอดสต็อก · แสดงเฉพาะรายการล่าสุด ยอดนี้ไม่ใช่ยอดคงเหลือ', 264, 740, 13, 'Regular', MUTE)
text(F, 'ข้อมูลตัวอย่างสำหรับเดโม', 264, 766, 12, 'Regular', MUTE)
# P19 top products: ranked bars from paid orders only
G = 6260; setc(6312, 'สินค้าที่ขายได้มากที่สุดจากออเดอร์ที่ชำระแล้ว')
rect(G, 232, 190, 1208, 810, BG)
rect(G, 264, 200, 1144, 520, '#FFFFFF', LINE, 16)
text(G, 'อันดับสินค้า (สูงสุด 10 รายการ)', 288, 220, 18, 'SemiBold', INK)
items = (('Iced latte', 42), ('Butter croissant', 31), ('Matcha latte', 24), ('Americano', 19), ('Chocolate cake', 11))
for i, (n, q) in enumerate(items):
    y = 276 + i * 80
    text(G, '%d' % (i + 1), 288, y, 15, 'SemiBold', PUR); text(G, n, 324, y, 15, 'SemiBold', INK); text(G, '%d หน่วย' % q, 1290, y, 14, 'SemiBold', PUR, 100, 'right')
    rect(G, 324, y + 32, 1000, 14, '#EFE6F8', None, 7); rect(G, 324, y + 32, int(1000 * q / 42), 14, PUR, None, 7)
text(G, 'นับหน่วยจากออเดอร์ที่ชำระแล้วเท่านั้น คำนวณจากออเดอร์ที่โหลดอยู่ในหน้านี้', 264, 740, 13, 'Regular', MUTE)
run(src, dst, 'p16')
