# BitPOS — diagrams การทำงานของโปรแกรม

อัปเดต 24 ตุลาคม 2026 · สร้างจาก source และ checkpoint ในเครื่อง ด้วย **Pele 1.9.0**

เปิด [ตัวดู diagram แบบ offline](index.html) เพื่อเลือกแผนภาพ ซูม และดู Mermaid source หรือเปิด SVG ด้านล่างโดยตรง

| แผนภาพ | ไฟล์ | ขอบเขต |
|---|---|---|
| ภาพรวมระบบ | [SVG](01-system.svg) / [Mermaid](01-system.mmd) | Customer/Rider/POS/Pay → API → Postgres, workers และ events |
| ขั้นตอนสั่งอาหาร | [SVG](02-food-order.svg) / [Mermaid](02-food-order.mmd) | quote → order → ร้านรับ → ยืนยันเงิน → เตรียม → ไรเดอร์ → ส่งสำเร็จ |
| การยืนยันเงินและกู้คืน | [SVG](03-payment-recovery.svg) / [Mermaid](03-payment-recovery.mmd) | ตรวจหลักฐานฝั่ง server, unknown outcome, deduplication และ refund ที่แยกจาก paid |
| Workflow พัฒนา UI | [SVG](04-ui-development.svg) / [Mermaid](04-ui-development.mmd) | Customer/Rider/POS ทำขนาน ตรวจเอง แล้ว review และบันทึกสถานะรายหน้า |

**การอ่านสถานะ:** แผนภาพอธิบายโครงสร้างและกฎการทำงานตามโค้ด ไม่ใช่หลักฐานว่าทุกลูกศรผ่าน end-to-end แล้ว เส้นประคือ boundary/ข้อจำกัด/ความสัมพันธ์ประกอบ ไม่ได้แปลว่า integration ใช้งานจริงครบ การจ่ายเงินหรือ provider ที่ใช้ fixture ต้องติดป้ายตามเดิม และ earning obligation ไม่เท่ากับจ่ายเงินให้ไรเดอร์แล้ว

ตอนสร้างเอกสารพบว่า OMP หยุดหลัง provider error และ goal เป็น paused; monitor ยังทำงานแต่ไม่มีข้อมูลยืนยัน automatic-pause origin จึงไม่ปลุกเอง ทั้งที่เห็นบัญชีใช้ได้ 3 บัญชี ตัวเลข TODO แบบกลุ่มใหญ่จึงไม่เพียงพอสำหรับยืนยันความเคลื่อนไหว ต้องดู timestamp ของคำสั่ง/source/evidence และสถานะ native goal ด้วย สถานะสดหลังจากสร้างเอกสารให้ดู `docs/CHECKPOINT.md`; หน้านี้ไม่ใช่ live monitor

## ต้นทางที่ตรวจ

- [API routes](../../../apps/api/src/index.ts), [mobile food](../../../apps/api/src/mobile-food.ts), [orders](../../../apps/api/src/orders.ts), [fulfillment](../../../apps/api/src/fulfillment.ts)
- [Worker](../../../apps/worker/src/index.ts), [food dispatch](../../../apps/worker/src/food-dispatch.ts)
- [Customer](../../../apps/mobile-customer/lib/food_page.dart), [Rider](../../../apps/mobile-driver/lib/food_work_page.dart), [POS](../../../apps/web/src/components/IncomingOrders.tsx), [Payment](../../../apps/web/src/components/Payment.tsx)
- [แผน UI-first](../../plans/UI_FIRST_IMPLEMENTATION_RESET_TH_20261023.md), [checkpoint](../../CHECKPOINT.md), [work packages](../../plans/IMPLEMENTATION_WORK_PACKAGES_TH_20261021.md)

## สร้างใหม่

จาก repository root:

```sh
npm ci --prefix tools/diagram-renderer --ignore-scripts --no-audit --no-fund
npm run build --prefix tools/diagram-renderer
```

เครื่องมือและ lockfile แยกใน `tools/diagram-renderer/` ไม่เพิ่ม runtime dependency หรือเปลี่ยน root lockfile ของแอพ ผลลัพธ์มี SVG, HTML และ manifest ระบุ hash ของ Mermaid/source references; เปิด offline ได้โดยไม่เรียก CDN

Pele: [repository และ API เบื้องต้น](https://github.com/obsidianmd/pele) · MIT license; ใบอนุญาตที่ใช้สร้างอยู่ใน `pele-LICENSE.txt` ไม่ได้ฝัง library runtime ใน HTML
