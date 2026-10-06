# แยก firmware เครื่องหน้าร้านมาอยู่ BitPOS

ปรับแผนตามผู้ใช้วันที่ 7 ตุลาคม 2026: firmware เครื่องร้านต้องอยู่ในโฟลเดอร์/repo BitPOS ด้วย

สถานะ: ตรวจ source และสร้าง target directory/documentation แล้ว ยังไม่ได้คัดลอก runtime/build/flash/OTA

## ขอบเขตและชื่อเป้าหมาย

- Path: `/Users/cryptoclock/Desktop/BitPOS/device/firmware/`
- Product working name: **BitPOS Terminal**; ใช้ hardware ของ CryptoClock Pro ได้ แต่แยก firmware lifecycle
- Repository: `cryptoclocks/BitPOS`; web/backend/device อยู่ด้วยกันและใช้ contract ชุดเดียวกัน
- Source reference: `/Users/cryptoclock/Desktop/CryptoClockPro/device/firmware/` เก็บของเดิมไว้ ไม่ย้ายไฟล์ออกและไม่เปลี่ยน production machines
- Firmware ต้อง build ได้จาก clone BitPOS โดยไม่ใช้ symlink, absolute include หรือไฟล์ private ใน CryptoClockPro
- Legacy/home CryptoClock notifications ยังเป็น optional adapter คนละขอบเขตกับ firmware ร้านใหม่

## สิ่งที่ตรวจพบ

- ESP-IDF project ชื่อ `cryptoclock_pro`; CMake กำหนด semver + git provenance และ release build gate
- `main/CMakeLists.txt` ผูก board, display, storage, network, connectivity, sync, renderer, WASM, audio, OTA, security, monitor, home UI, local API และ console
- root CMake มี dependency path ไป WAMR ที่ `components/wasm_engine/wasm-micro-runtime`; extraction ต้องตรวจ submodule/vendor/license ไม่ถือว่า copy components directory แล้วจะ build ได้ทันที
- `app_main.c` มี bootstrap, package adoption/readiness, HTTP API calls และ MQTT callbacks ผูกระบบเดิม
- `main/user_config.h` มี endpoint defaults ของระบบเดิม ต้องแทนด้วย BitPOS configuration template และ provisioning ไม่ copy deployment credentials
- Partition table มีสอง OTA slots และ data/SD-related behavior ต้องตรวจ board/flash layout เดิมก่อนเปลี่ยน ห้ามอ้างว่า binary ใหม่ flash ทับเครื่องเก่าได้โดยยังไม่ทดสอบ
- หลักฐานทั้งหมดเป็น source inspection ไม่ใช่ board build หรือ hardware verification

## รายการ extract และวิธีรักษา dependencies

| ส่วนต้นทาง | แนวทาง |
|---|---|
| `board_bsp`, `display_engine` | เก็บ hardware drivers/pin definitions/touch ที่ตรงบอร์ดจริง; บันทึก board revision |
| `ui_renderer`, `ccp_fonts`, `home_ui` | เก็บ rendering primitives/fonts ที่จำเป็น; ทำ store shell/new screen routing; ตรวจ dependency ก่อนตัด Home เดิม |
| `storage`, `net_manager`, `connectivity` | เก็บ SD/Wi-Fi/transport foundations; แยก config, topics, auth และ state ของ BitPOS |
| `audio_engine`, `sys_monitor` | เก็บ sound/health infrastructure; assets ออก namespace ใหม่และตรวจ license |
| `device_security`, `ota_manager` | เก็บ security/rollback patterns; provisioning/key identity/manifest ต้องเป็นของ BitPOS |
| `sync_manager`, `wasm_engine`, `local_api`, `dbg_console` | ตรวจ dependency closure; รักษาที่จำเป็นก่อน แล้วถอดฟีเจอร์ไม่ใช้ด้วยหลักฐาน build/runtime ไม่ลบตามชื่อ |
| `main`, CMake, Kconfig, component manifests, defaults, partitions | สร้าง reproducible project และ safe defaults; แยก product/version/config |
| `device/schema`, `device/wasm-apps`, SD assets | นำมาเฉพาะ contract/runtime/asset ที่ POS ใช้จริง ไม่ copy catalog/ข้อมูล provision ของเครื่องเดิม |

ไม่คัดลอก build directories, binaries/releases เดิม, production SD configuration, credentials, device IDs/keys หรือ package artwork ทั้งชุด อ้างอิง provenance ของ source ที่ใช้และรักษา third-party notices

## เฟส 1B — Baseline ที่ build แยกได้

1. บันทึก source commit และ local changes สำหรับไฟล์ที่เลือกพร้อม hash; เก็บ fixes ปัจจุบัน ไม่ reset ต้นทาง
2. Extract components และ dependency closure; pin SDK/component/vendor versions พร้อม license notices
3. แยก CMake product/version prefix, config template, service endpoints และ device namespace; ไม่แค่ค้นหาแทนที่ `CCP` ทั้งระบบ เพราะมี ABI/storage/protocol compatibility ที่ต้องตรวจ
4. แทน package boot gate ของ CryptoClock ด้วย BitPOS boot/readiness: config valid, display initialized, POS shell render สำเร็จ, transport state แสดงได้ และ assets ที่ต้องใช้ตรวจครบ รองรับเริ่มเครื่องขณะ offline
5. ตรวจ compatibility ของ provisioning/NVS/partition และเลือก factory provisioning flow ที่ไม่ขโมย identity/credentials ของเครื่องเดิม
6. Build firmware จาก repo นี้เอง แล้วตรวจบน dedicated test device: boot, จอ/touch, Wi-Fi reconnect, SD/assets, เสียง, watchdog/memory และ reboot กลับหน้า shell
7. เก็บ baseline commit/build instructions และ hardware evidence; จะอ้าง readiness ได้เมื่อ render บนจอจริง ไม่ใช้ MQTT ACK แทน

## เฟส 4 — POS device behavior

- idle: ticker SOL/USDT, GIF/โฆษณา, preferences เสียง
- active order: รายการอาหาร/ยอด, QR, สลับ PromptPay/USDG, awaiting/confirming/paid
- payment confirmed: event dedup, animation/เสียงครั้งเดียว, render ACK/timestamp
- reward: pending/issued/failed ตาม backend ไม่คำนวณ ownership/random reward บนจอ
- recovery: reconnect/state resync, QR expiry, ไม่ replay เสียงจาก order เก่า
- ที่มาของ paid status ต้องเป็น verified backend event ไม่ใช่การแตะบนจอหรือ sign transaction

จอต้องรัน state machine บน task/event queue ที่เหมาะกับ LVGL ไม่ทำ HTTP/network/asset operations ยาวใน MQTT callback หรือ touch handler ตรวจพฤติกรรมเดิมก่อนแก้ wiring

## Release/OTA boundary ของ BitPOS

- แยก product family, version, signing/provisioning, manifest endpoint, storage path และ rollout targets
- Manifest ต้องตรวจ product/board/layout compatibility ไม่ใช่เพียง hash; CryptoClock เดิมต้องไม่รับ BitPOS OTA โดยอัตโนมัติ และกลับกัน
- Release source clean, binary provenance/hash ตรวจได้; retain rollback image และทดสอบ recovery
- Health gate ใหม่ต้องมี physical display readiness และ boot stability; นำบทเรียนเดิมเรื่อง SD/memory/full-frame/rollback มารักษา แต่ไม่บังคับ P001–P009 เดิมกับ POS
- ไม่ทำ flash หรือ OTA ในรอบวางแผน; เมื่อเริ่มทดสอบให้ระบุเครื่องทดสอบจริงและเก็บหลักฐานก่อน/หลัง

## Acceptance และขอบเขตหลักฐาน

| Gate | ต้องพิสูจน์ |
|---|---|
| Build independence | build จาก BitPOS checkout, ไม่มี dependency กลับไป CryptoClock workspace |
| Hardware baseline | board/flash/partition ถูกต้อง; boot/display/touch/SD/audio/Wi-Fi ผ่านจริง |
| Product isolation | config/auth/topics/provisioning/catalog/OTA ของ BitPOS แยกจากระบบเดิม |
| Payment event | wrong target/duplicate/stale events ไม่ทำให้ขึ้น success; reconnect กู้ state ได้ |
| Performance | วัด backend confirmed → render ACK p95; ไม่อ้าง chain latency เป็น device latency |
| Release recovery | version/hash/manifest match; upgrade/reboot/rollback ตรวจบนเครื่องจริง |

การสร้าง target directory และเอกสารครั้งนี้ยังไม่ผ่าน gates เหล่านี้ งาน firmware จึงยังเป็น implementation backlog
