# BitPOS — ชุดเตรียมถ่ายวิดีโอ 10 ตุลาคม 18:00 Bangkok

**Current public table QR/mobile guest flow: filming acceptance passed.** BitPOS0.3.1 ผ่าน3new current-runtime guest devnet/physical-ACK rounds ตามlatest human filming contract; ไม่ใช่10/30หรือp95 gate. Fresh independent native Sol6.1high review `792c33530ea0447e9c86c4b81717d484` **pass/findings[]** และ `python3 .omp/foreman.py gate` **complete**; receipt `.omp/work/evidence/public-table-foreman-gate.json`. Previous review `94cec5d538bf47da8d4b2b239b874b55` เป็นhistorical ไม่ครอบคลุมsourceนี้. Androidจริงdeferred; marked browserfixtureไม่ใช่มือถือ. Current3physical ACK759/859/1094ms ไม่มีp95/subsecond guarantee.

**Urgent LAN UUID update after that gate:** shared browser helper now supports HTTP LAN cryptographic UUIDs; actual Brave guest reload, canonical merchant Review and exact-key failed-submit/reload/expired-retry passed with native `randomUUID` absent. Reload the LAN page; do not clear pending journals. No new funded rounds. The full-demo gate receipt above belongs to its recorded prior source; current UUID-only review status is in `docs/CHECKPOINT.md` / `.omp/work/checkpoint.json`, not a new full-demo gate claim.

## สิ่งที่แสดงได้จากหลักฐานจริง

- POS English-first สีม่วง พร้อมตัวเลือกไทย: twelve cafe products ใช้ภาพ Unsplash จริงที่เก็บ local พร้อม credits; category/search, cart quantities, guest และ optional contact. ยอด canonical คำนวณโดย server ด้วย integer minor units; product cards ไม่มี simulated/mock labels
- Current table/counter demo prices are explicitly configured USD prices (for example USD0.10 →0.100000 testUSDG), not an exchange-rate claim. Historical THB bills remain unchanged.
- Browser test wallet มีป้ายชัดเจนและ host signer จำกัด order; private key ไม่เข้า browser
- ลงนาม nonce challenge ที่ server ตรวจ tenant/order/address/expiry ก่อนผูก wallet; signature นี้ยังไม่ใช่หลักฐานการจ่าย
- ลูกค้าทดสอบไม่มี SOL; native BitPOS sponsor จ่าย network fee ภายใต้งบ/rate limit ที่เก็บ durable
- สถานะจริง `AWAITING_PAYMENT → CONFIRMING → PAID`: confirmed ยังไม่หัก stock เป็น paid; finalized ที่ตรวจ mint/program/recipient/amount/reference/payer/signatures จึง settle stock/payment/outbox
- ESP32-S3 actual runtime BitPOS0.3.1: purple480×320 table Scan to order QR+compact cafe clock/artwork; no local menu/quantity/Add. Guest public LAN photo menu/cartโดยไม่loginร้าน → immutable device-origin order → distinct order-specific paymentQR/confirming/paid/minimalbill/explicit Done. Original3guest physical ACK759/859/1094ms เก็บครบ,ไม่อ้างp95หรือsubsecondguarantee. Current authenticated clean-close reconnectและhostonce-only sound/ACK smokeผ่าน; actualtouch/audioยังเป็นuser-observedผลเดิม ไม่อ้างnewhashattribution.

## ลำดับภาพแนะนำ (90–120 วินาที)

| เวลา | ภาพ | คำอธิบายที่ใช้ได้ |
|---|---|---|
| 0–10s | ชื่อ BitPOS และอุปกรณ์จริงแสดง Scan to order QR | Independent BitPOS; devnet test assets only; QR ของโต๊ะก่อนมีบิล |
| 10–30s | เปิดassigned guest URL ในbrowser390px เลือก Latte/จำนวนแล้ว Review | ไม่ login ร้าน; photo menu/cart; server canonical USD0.10 quote/โต๊ะ/target |
| 30–45s | Confirm order & pay → Order ID/QR ของบิลบนจอ480×320 | Entry QR ≠ payment QR; immutable table/amount; ไม่มีข้อมูลติดต่อบนจอ |
| 45–65s | Browser wallet fixture และ verification | แสดงป้าย TEST WALLET FIXTURE ค้างไว้; wallet proof ไม่ใช่ payment |
| 65–90s | Sign & submit, CONFIRMING, PAID | Native sponsor / zero-SOL test customer / finalized server verification |
| 90–105s | จอ ESP32 จริง success | ถ่ายอุปกรณ์จริง ไม่ใช้ concept artwork แทน; success sound อ้างได้เมื่อได้ยินจริง |
| 105–120s | Receipt และข้อจำกัด | Browser fixture ≠ Android Phantom test; full POS parity / mainnet integrations ยัง roadmap |

อย่าตัดป้าย fixture หรือคำว่า devnet ออกจากภาพ และอย่าแสดง email/password, device token, provisioning, wallet vault, `.env`, SSH key หรือ private backups ในวิดีโอ

English spoken script: “The terminal shows a table’s Scan to order QR. Open that table’s guest menu, choose an item, and review the server-confirmed bill—no merchant login. Confirming creates this exact order and its separate payment QR. This is a clearly labeled browser test wallet on Solana devnet, not a physical Phantom phone test. The customer has no SOL; BitPOS sponsors the fee within a durable budget. A wallet signature is not payment. Confirmed transactions remain confirming; only finalized server verification marks paid, commits inventory and emits the event to this assigned physical display.”

## หลักฐานภาพที่มีแล้ว

- Current0.3.1 table entry: `.omp/work/evidence/native-public-table-entry-qr.png` / `native-public-table-entry-qr-decoded.json`; guest cart observer `native-public-table-phone-cart.png`.
- Actual guest photo menu390px: `public-table-mobile-menu-390.png`; canonical server bill `public-guest-round-1-canonical-review.png`, `public-table-mobile-quote-reload.json`.
- Distinct actual payment QR: `public-guest-round-1-physical-payment-qr.png`; actual finalized-success frame `public-guest-round-1-physical-paid.png`; marked browser receipts `public-guest-round-{1,2,3}-wallet-paid.png`.
- Current original finalized receipts/physical samples: `public-guest-three-round-reconciled-receipts.json`, `public-guest-physical-ack-three-round.json`; all3new guest samples759/859/1094ms kept. Do not substitute faster reconnects or historical30/p95 numbers.

- `.omp/work/evidence/browser-current-canonical-qr.png`
- `.omp/work/evidence/browser-current-wallet-bound.png`
- `.omp/work/evidence/browser-current-wallet-paid.png`
- `.omp/work/evidence/phantom-fixture-rejected.png`
- `.omp/work/evidence/browser-current-live-receipt.json`
- `.omp/work/evidence/browser-current-physical-receipt.json`
- `.omp/work/evidence/browser-v023-live-receipt.json` และ `browser-v023-wallet-paid.png`: actual Chromium, labeled fixture, real devnet CONFIRMING→PAID โดยไม่ใช่มือถือ
- `.omp/work/evidence/native-v023-idle-gif-a.png`, `native-v023-idle-gif-b.png`, `native-v023-confirming.png`, `native-v023-paid.png`: framebuffer จาก ESP32 จริงหลัง LCD DMA สำเร็จ ไม่ใช่ concept artwork
- `.omp/work/evidence/physical-gif-v023.json`: coffee ROI เปลี่ยน762pixels, uptime/flushเพิ่ม, green background0pixels เทียบ failing-before4984pixels
- `.omp/work/evidence/worker-clean-restart-before.json` / `worker-clean-restart-after.json`: signature persistedก่อนbroadcast, restarted worker settleครั้งเดียว
- `.omp/work/evidence/native-v024-bill12.png`, `public-full-bill12.json`:12สินค้าเต็มบนphone checkout, canonical ฿1070.00/30.571429testUSDG; deviceเก็บ6บรรทัดรวม7-more/scroll viewport/fixedtotal โดยไม่แอบลดบิล
- `.omp/work/evidence/physical-ack-v023-failed.json`:30 paid renderACK p951714ms failed ไม่ใช่pass; `device-combined-analysis.json` เป็น unfunded delivery diagnosisเท่านั้น
- `.omp/work/evidence/physical-v024-boot.log`: actual0.2.4 boot + silent verified snapshot/persistent sound suppression; ไม่ใช่audible proof
- `.omp/work/evidence/native-v024-final-series-paid.png`: actual0.2.4 ESP32 finalized Espresso bill1.571429testUSDG; framebufferหลังLCD DMA ไม่ใช่optical camera
- Historical0.2.4 baseline: `demo-rounds-v024-final30.json`, `authorized-final-two.log`, `authorized-policy-provenance.json`; not current-source acceptance. Historical0.3.0 funded30 receipts: `demo-table-funded160m-30-receipts.json`; its full latency result `physical-ack-funded160m-30-failed.json` is preserved. Do not use the mutable `physical-ack-30.json` alias to describe historical817ms. Latest human3-round filming decision supersedes these former blocking thresholds.
- Current table browser receipt: `table-first-browser-payment-reconciled.json` and `table-first-browser-paid.png`; real devnet with labeled browser signer fixture, not mobile. Current actual ESP32 framebuffer idle views: `native-table-funded-idle-series-*.png`, not optical photographs. `heartbeat-cutover-smoke-summary.json` has only3diagnostic samples, not a30-sample pass.
- Latest current0.3.0 browser smoke: `browser-frame-priority-live-payment.json`, `browser-frame-priority-payment-reconciled.json`, `physical-frame-priority-browser-smoke.log`. Actual Tablet canonical USD0.10→explicit TEST WALLET FIXTURE→CONFIRMING→PAID; original physical ACK682ms/105ms flush. One sample, **not p95 acceptance**. `browser-current-wallet-bound.png` / `browser-current-wallet-paid.png` now show this exact order, not the older fixture.
- Historical settlement013/notification cohort: all30 finalized customer0SOL, **p951011ms FAILED under the former gate**, no samples removed (`physical-ack-settlement013-notify-30-failed.json`, `demo-table-settlement013-notify-30-receipts.json`). Subsequent committed-frame-priority fix has failing-before/passing-after evidence. New30/p95 pass is no longer required by the latest human filming decision; historical failure stays a failure.
- Actual physical0.3.0 HOME→Iced Latte photo/USD0.10→HOME captures: `native-frame-priority-idle-timed-0.png`, `-2.png`, `-5.png`, timing manifest `native-frame-priority-idle-timed.json`. Framebuffers, not camera/finger/audio proof. Tablet incoming hover corrected and visually verified: `tablet-incoming-hover-fixed-viewport.png`.

ภาพ browser ไม่ใช่ physical phone. ภาพ `native-v023-*` เป็น framebuffer จาก ESP32 จริงหลัง LCD DMA ไม่ใช่ optical camera photograph/touch/audio proof. ถ่ายอุปกรณ์จริงสำหรับช็อตอุปกรณ์; ห้ามใช้ team-guide/asset-pack concepts แทนหลักฐาน runtime. `native-v022-paid.png` เป็น failing-before unsynced Home จาก pyserial reset-on-open ไม่ใช่ paid proof; ใช้ POSIX capture ที่ไม่เปลี่ยน modem/reset lines.

## วิธีเตรียมที่ปลอดภัย

1. ใช้ single actual-use BitPOS Supabase บน OCI ที่มีอยู่เท่านั้น; DB identities ไม่ร่วม CryptoClock
2. เปิดเฉพาะ BitPOS application/static allowlists. ห้าม whole-repo HTTP server
3. ตรวจว่า API, worker, web และ physical capture เป็นบริการของ BitPOS ที่ coordinator เปิดเอง; ไม่แตะ Terminal/service ของโครงการอื่น
4. Login ด้วย demo owner จาก private local credential ผ่าน host automation; ไม่คัดลอก credential ลงเอกสารหรือภาพ
5. ใช้ dedicated devnet role wallets เดิมเท่านั้น. ตรวจ genesis ก่อนสร้าง transaction; persist signed signature ก่อนส่ง; ambiguous send ต้อง reconcile ไม่สร้าง transfer ใหม่
6. Firmware update ใช้ `tools/firmware/install.py --write --update-app` หลังหยุด serial capture และตรวจ identity; ไม่ใช้ generic SDK flash/full erase และไม่ reprovision NVS ที่มี dedup state
7. ตรวจ `python3 .omp/foreman.py ready`, fresh independent review และ `gate` ก่อนติดป้าย acceptance passed

### URL / setup / reset สำหรับถ่ายรอบนี้

- Primary filming flow starts at **Scan to order** on the actual0.3.1 device, then its assigned `http://192.168.1.34:4321/table/<opaque-entry>` public guest page, no merchant login. Framebufferdecoded URL is in `native-public-table-entry-qr-decoded.json`; decoding it is not a phone-camera test. Merchant fallback stays at LAN`/` or Mac`http://127.0.0.1:4321/`. Exact orderQR opens `/pay/<opaque-order-access>` only after canonical Confirm. Phantom browse/provider compatibility is implemented, but Androidphysicalscan/payment staysdeferred. HTTP-LAN demo is not publicHTTPS/native Solana Pay/Blink endpoint.
- บริการที่เปิดใช้อยู่: web4321, API3001, workerของBitPOS; Supabaseใช้stackOCIเดิมผ่านtunnel18780–18783เท่านั้น. ห้าม restartบริการของโครงการอื่นหรือเปิดwhole-repo server.
- Primary guest path uses **Devnet demo table1**, assigned **BitPOSClock demo14:c1:9f:4e:62:48**; no merchant credentials. Optional merchant flow uses realserverrole demo Owner/Manager/Staff buttons; owner-only settings remainenforced. Ordinary private login credentials must never be shown. Prices USD0.10→0.100000testUSDG are fictional configured demo prices, not FX/redeemable money.
- ถ่ายtable entryQR→guest photo/cart→Review server bill→Confirm order & pay→exact billQR/checkout→challenge verification→sign payment→CONFIRMING→server-finalized PAID→actualassigneddisplay. Keep TEST WALLET FIXTURE visible; test harness uses explicitloopback walletfixture after actualLANguestorder, not physicalmobile/realPhantomprovider execution.
- Safe reset จากrootBitPOS: `node --env-file=.env .omp/helpers/reset-filming-screen.mjs`. ใช้authenticated staff contractเฉพาะPAID/EXPIREDที่renderedหรือreconciledแล้ว; pending/confirming/recovery/cartจะถูกปฏิเสธ ไม่ล้างjournalหรือส่งเงินซ้ำ. Table-local orderใช้Doneบนเครื่องเมื่อserverอนุญาต.
- **ครบ3new current-source roundsแล้ว ไม่ scheduleเพิ่ม.** Reconcile/read-only collector: `node --env-file=.env tools/runtime/collect-public-guest-receipts.mjs`. It verifies exactoriginalevent/generation/serialACK and durable singleeffects without signing/submitting. Browserguest runner `tools/runtime/public-table-browser-demo.mjs` is for explicitly authorized fixture use only, refusesunknownpendingoutcomes; never rerun to replace an ambiguous send.
- หลักฐานล่าสุดคือ `public-guest-three-round-reconciled-receipts.json`, `public-guest-physical-ack-three-round.json`, `public-guest-round-{1,2,3}-browser-live-payment.json`, `public-table-current-regression.json`, `public-table-browser-negative-replay.json`. Everyround stores actual runtime bytefingerprint; tooling-only collectors do not relabelhistoricalsource. Historical0.3.0 receipts below remainhistorical.


## ข้อจำกัดที่ต้องพูดตรง ๆ

- **Physical Android Phantom scanning/payment: user deferred on 2026-10-08.** Browse/provider contract และ browser fixture ไม่เท่ากับมือถือจริง
- Sponsor นี้เป็น strict native BitPOS fallback; **ไม่ใช่ Kora integration**
- เตรียม full POS feature inventory/parity ไว้ใน roadmap; ไม่อ้างว่าถอดทั้ง 25 screens แล้ว
- Mainnet, Grab, WiFi hotspot, home notifications, CLOCK token and OTA rollout remain after submission. Native Actions/Blinksยังdeferred; automatic personalized offersยังแยกpending real product model configuration ไม่บล็อก core filming. Plain exact-order web QRไม่ใช่Blink และbrowser fixturesไม่ใช่Phantomมือถือจริง. Reference: https://docs.phantom.com/developer-powertools/solana-actions-and-blinks .
- อย่าอ้าง audible sound/touch gesture จาก source หรือ I2S write log เพียงอย่างเดียว; ต้องมี actual observation
- Microphone observerเก็บเฉพาะscalarไม่มีrawaudio; actual WAV I2S completion20480B ไม่พิสูจน์audible. แก้ MSB→Philips one-bit-delayตาม NS4168/originalsourceใน0.2.4แล้ว แต่ automated microphone correlation0.0546ยัง inconclusive. **แยกจากผลนี้ ผู้ใช้ยืนยันเสียงจากspeakerจริงผ่านแล้ว** ใน `operator-touch-audio-confirmation.json`; อ้างได้เฉพาะ user-observed ไม่ใช่ automated waveform/replay proof. Reference: [NS4168 datasheet §10.1–10.2](https://michiel.vanderwulp.be/domotica/Modules/SmartDisplay-ESP32-S3-4.0inch/SCT-NS4168.pdf)
- **Physical finger touch passed by direct user observation**: ผู้ใช้รายงาน “ลองแล้ว ผ่านทั้งการแตะและเสียง”; evidence `.omp/work/evidence/operator-touch-audio-confirmation.json`. ไม่ใช่ automated optical proof/firmware hash attribution และไม่เพิ่มจำนวน ACK samples. Android phone testing ยังคง deferred.
