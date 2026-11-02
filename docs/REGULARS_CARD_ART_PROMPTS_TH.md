# ภาพการ์ดตรา Regulars: ที่ทำแล้ว และพรอมต์สำหรับอัปเกรดเป็น 3D/การ์ตูน

## ที่มีอยู่ตอนนี้ (2026-11-01)
การ์ดสะสมแนวตั้ง 5:7 สามระดับ วาดเป็นเวกเตอร์ (SVG) แล้วเรนเดอร์เป็น PNG 1000×1400: มาสคอตแก้วกาแฟหน้ายิ้ม + ของประดับตามระดับ
(Regular = เมล็ดกาแฟ, Gold = มงกุฎ, Platinum = มงกุฎ + ปีก) พื้นหลังฟอยล์รุ้ง ตัวหนังสือ "Non-transferable · Solana devnet · no monetary value" บนการ์ด
ไฟล์: `apps/web/public/loyalty/card-{1,2,3}.{svg,png}` และ metadata `badge-{1,2,3}.json` (แบบ Metaplex) ตัวสร้าง: `design/figcraft/handoff/generators/gen_regulars_cards.py`
mint บน devnet อ้าง `https://pay.cashlessthailand.com/loyalty/badge-N.json` — **ภาพจะขึ้นในกระเป๋าเมื่อ deploy เว็บแล้วเท่านั้น** (proxy ลูกค้า allowlist `/loyalty/*.png|json` เพิ่มแล้วใน `infra/oci/customer-proxy.py`)

## อัปเกรดเป็นภาพ 3D/การ์ตูนจริง (ต้องใช้เครื่องมือสร้างภาพภายนอก เช่น ChatGPT Images)
ผมสร้างภาพ 3D เรนเดอร์เองไม่ได้ ถ้าจะอัปเกรด ให้สร้าง PNG 1000×1400 ตามพรอมต์ แล้ววางทับชื่อไฟล์เดิม (`card-1.png` ฯลฯ) ได้เลย ไม่ต้องมินต์ใหม่
(กระเป๋าบางตัวแคชภาพไว้ อาจต้องรอหรือรีเฟรช) ใช้โครงเดียวกันทั้ง 3 ใบเพื่อให้ดูเป็นชุด

โครงร่วม: "Vertical collectible trading card, 5:7, premium glossy 3D-rendered cartoon style, soft studio lighting, deep plum (#3C0F5A) card body with a
thin metallic border, a rounded art window with a purple-pink radial glow, a cute smiling coffee-cup mascot with rosy cheeks sitting on a saucer, light
holographic foil sheen across the card, small sparkles. Header ribbon with the level name, bottom plate reading 'BITPOS REGULARS' in gold and the small line
'Non-transferable · Solana devnet · no monetary value'. No real brands, no people, no extra text."

- Level 1 Regular: "a single coffee bean on the cup lid, bronze-copper metallic border"
- Level 2 Gold: "a small gold crown with pink and cyan gems floating above the cup, gold metallic border"
- Level 3 Platinum: "a gold crown plus soft white feathered wings, platinum-silver border, extra sparkles"

ข้อกำหนดไฟล์: PNG 1000×1400, ไม่เกิน 1.5 MB, พื้นทึบ, ข้อความบนการ์ดอ่านออก, ไม่มีโลโก้แบรนด์จริง ตรวจด้วย `pnpm exec tsx --test tests/loyalty-card-art.test.ts`
