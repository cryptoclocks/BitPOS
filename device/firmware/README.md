# BitPOS Terminal firmware

ตำแหน่งสำหรับ firmware เครื่องหน้าร้านที่แยกจาก CryptoClock Pro ภายใน repo BitPOS

สถานะ: **planning scaffold** ยังไม่ได้คัดลอก firmware source, build หรือ flash เครื่อง

อ่าน [แผนแยก firmware](../../docs/FIRMWARE_EXTRACTION_TH.md) ก่อนเริ่มเฟส 1B

เป้าหมายคือ ESP-IDF/LVGL project ที่ build ได้จาก repo นี้เอง มี product/version/config/provisioning/OTA ของ BitPOS และรับ order/payment events จาก BitPOS backend โดยไม่พึ่ง workspace หรือ catalog ของ CryptoClock Pro
