# BitPOS Terminal firmware

Independent ESP-IDF 5.5.1 / LVGL 9.2.2 application for the extracted JC3248W535C ESP32-S3 N16R8 board. Original pin definitions, QSPI AXS15231B full-frame flush and I2C touch driver are preserved. See `docs/FIRMWARE_PROVENANCE.json` and `docs/FIRMWARE_EXTRACTION_TH.md` for inherited-source provenance; this application and provisioning helper are new BitPOS code. No CryptoClock workspace dependency, catalog, OTA or old service configuration is used.

## Build (coordinator)

From repository root, with the existing local SDK/tools installed:

```sh
bash tools/firmware/build.sh
```

This runs `idf.py -C device/firmware build`, not flash. Generated Sarabun 20px Latin/Thai glyphs are committed; no converter is needed to build. Font source was copied from this repository's `team-guide/assets/fonts/Sarabun-Regular.ttf` without modifications. Regenerate deterministically with:

```sh
npx --yes lv_font_conv@1.5.3 --font device/firmware/fonts/Sarabun-Regular.ttf --size 20 --bpp 4 --range 0x20-0x7e,0x0e00-0x0e7f --format lvgl --no-compress --lv-include lvgl.h --output device/firmware/main/bitpos_font_20.c
```

## Runtime

### Table ordering — source 0.3.0, integration verification pending

The live transport is authenticated **v2 only**. Startup reads the existing
private `ws_url` from `bitpos_nvs/config`, moves its bounded query token into the
WebSocket `Authorization: Bearer` header in RAM, and strips the complete query
before connecting. It does not rewrite provisioning, erase NVS, select a device
from `terminalId`, or fall back to a shared-token/v1 endpoint. The coordinator
must register that credential against one device before cutover. CONFIG supplies
the authenticated device UUID, merchant pin, assignment/pairing generations,
explicit pricing readiness and validated payment origin. SNAPSHOT reconstructs
the exact owner; SESSION_SYNC resolves the durable pending command/submission
before edits become enabled. Connection, screen, assignment, pairing and
monotonic `deviceSeq` are separate decimal-string fences, not order versions.

The bounded assembler supports SDK chunks and RFC continuation frames, rejects
8192-byte messages, noncontiguous chunks, excessive fragments/nesting and binary
messages, and forces reconnect/resync on malformed assembly or inbox overflow.
No outcome or payment event is silently dropped while edits continue. Pending
requests survive that resync. Payment messages and real render ACKs drain ahead
of touch intents, catalog pages and idle media.

The actual 480x320 local flow is Menu/category/photo or text product -> absolute
quantities/cart -> canonical paged review -> explicit Confirm -> exact-order
QR/status. Catalog pages have at most four products, not a twelve-product menu
limit; three visible 48px rows, 44px quantity/paging/action targets and fixed total
keep every one of 50 distinct lines reachable. Quantities are 1..100; zero removes
a line from the absolute draft. All frozen quote pages must agree on quote,
price version, quantity membership and total before Confirm enables. Review
shows both display Money and test USDG settlement. USD/2 and USDG/6 are explicit
server prices; THB is accepted only for tagged historical order presentation.
There are no configured sample prices, FX conversion, wallet secrets or signing.

`bitpos_table.c` owns bounded parsing, money, cart/page reconciliation,
serialization and the compact journal codec; `bitpos_table_runtime.inc` is the
single consumer-side owner. Fixed state plus the shared 4096-byte journal/wire
workspace is compile-time bounded to 32KiB. Transport inbox/JSON, existing LVGL
widgets and immutable SD slab are separate. The largest encoded journal record
is 2029 bytes for acknowledged and desired 50-line carts; two slots are 4058 bytes
before NVS overhead. Sequence and payload are CRC-protected. The next complete
inactive slot commits before any mutation/submit sends; storage failures send
nothing and never erase provisioning or paid-dedup history. Only absolute carts
and exact pending request/quote/key/fences are durable: timeouts never replay
increments or create a replacement submission key. Definite refusal retains a
paused desired draft for explicit resume/fresh review; an expired draft never
restores itself over another live owner.

Cart lease heartbeat is 30s against server-owned 120s leases. Cart, pending
submit, QR, confirming, receipt, unresolved expiry/recovery and offline states
prevent Home/ads from replacing ownership. PAID dwell is presentation only and
does not release a screen. Done sends ORDER_DISMISS only with authoritative
canDismiss; a paid ACK acceptance triggers SESSION_SYNC to acquire that explicit
permission. The device never infers safe expiry or payment success itself.

Touch and idle timer callbacks enqueue small generation-bound intents only:
no allocation, pixel copying, network, SD or NVS there. The consumer executes
persistence/network outside the LCD lock and creates widgets under that lock.
Idle uses the existing once-loaded twelve-photo RGB565 slab (480x200, 2304000
bytes, hash/size allowlist and text/clock fallback), native clock and finite paid
effects. The old live THB IDLE_MENU parser is removed. The existing optional media
startup task still preloads/hash-validates bounded GIF bytes into immutable PSRAM
and publishes the RAM-only `M:` filesystem. Consumer's lowest-priority idle lane
creates the inherited cached GIF/alpha-corrected canvas under the required LVGL
owner lock, only after payment inbox drains and no owner/eligible photo exists.
The inherited timer advances RAM-only frames under that same lock. No SD IO or
GIF preparation runs from touch/network/clock callbacks. Payment preempts and
destroys GIF scene resources before redraw/ACK. First-frame RAM decode still
synchronously holds LVGL; its changed-source delay needs measurement.

Coordinator must run `parser-smoke.py` (including the adapted catalog/core smoke),
`ui-smoke.py`, `photo-media-smoke.py`, `media-smoke.py` and the unchanged helper
smoke, then the independent ESP-IDF build after integration. Native UI now
compiles the actual parser, consumer, NVS/ACK gate and LVGL scenes with explicitly
labeled host transport/NVS/SHA/transfer/media adapters. It is not physical touch,
LCD, cryptographic, SD, audible or payment evidence. This writer ran no builds,
tests, lint, formatters, flash, provisioning, capture or transactions. Historical
0.2.4/0.2.5 builds and old paid30 measurements remain evidence of their original
sources only; v2 needs new actual touch/reconnect/NVS/QR and paid-ACK measurements.

Purple/orange 480x320 landscape shell, 44px logo/table/network/hamburger header, supported Sarabun ASCII/Thai aliases and generated Segment64 clock remain. The six 44px overlay rows expose Home (disabled while owned), Menu, Cart/Bill, Pay QR/Receipt/Status and existing sound/reduced-motion preferences. Confirming/paid retain the inherited 86px ring and finite twelve-particle effect. New full bill lines use the immutable quote's pages rather than silently truncating a 50-line order; historical records without a quote retain their honest bounded summary. Backend device views exclude customer/contact/wallet/history. The payment URL is pinned to authenticated CONFIG's validated public origin and exact `/pay/:opaque` path; query/fragment/foreign origin is refused.

WiFi still uses RAM driver storage and only the owned private provisioning namespace. WSS verifies the SDK certificate bundle. The only plaintext transport exception is the explicitly approved `ws://192.168.1.34:3001/api/device` demo endpoint; it is not production TLS. URI logging stays disabled and no token-bearing URI is passed to the WebSocket client. Existing private provisioning files/helpers are unchanged and coordinator-only.

The consumer invalidates the whole screen and calls `lv_refr_now`; ACK is issued only if the unchanged driver's successful full-frame transfer count advances and the actual order scene is meaningful. The driver increments only after all DMA bands complete, never after timeout/recovery. Failed transfers send no ACK. ACK binds eventId, deviceSeq, connection/screen generations and exact order/version, with `rendered:true`; a command reply is not physical ACK. ACK precedes the durable paid-effect claim and optional audio, and sanitized serial ACKs retain physical flush duration. Superseded screen/connection/sequence or regressed/conflicting order versions cannot acknowledge an unrendered order. Replays and snapshots are silent.

The board's NS4168 amplifier uses actual I2S pins42/2/41. Paid-order SHA256-derived NVS keys are committed after successful physical ACK submission and before finite optional celebration/audio. Snapshots are always silent and mark paid orders heard. Independent bounded audio queue plays the approved original `asset-pack/audio/payment-success-device.wav` only from `/sdcard/bitpos/motion/v1/payment-success-device.wav` after format/SHA validation; otherwise native784/1046Hz two-tone fallback. No fallback restarts after partial PCM submission. NVS/storage/audio failures suppress effects rather than fabricate them; NVS full does not erase history. A power cut can lose a sound but cannot replay a committed success. I2S completion logs are not proof of audible output.

Version0.2.4 uses Philips I2S (one BCLK delay after LRCLK), matching the unchanged original board audio engine and [NS4168 datasheet§10.1–10.2](https://michiel.vanderwulp.be/domotica/Modules/SmartDisplay-ESP32-S3-4.0inch/SCT-NS4168.pdf). Prior MSB/left-justified framing was a source-level defect. Physical0.2.4 completion20480B proves approved PCM reached/drained DMA, not that a speaker is connected/audible. A bounded Mac microphone observer stores only scalar full-cue correlation;0.0546 remains inconclusive. Separately, direct human user confirmation establishes actual finger touch and audible speaker passed (`operator-touch-audio-confirmation.json`); this is not automated optical/waveform, firmware hash attribution or replay validation.

Inherited GIF fallback, immutable `motion-lab/assets/gif/*-128.gif` hashes, read-only disk/VFS enforcement and pinned decoder alpha correction remain in `bitpos_media.c`, with original Noto Emoji CC BY4.0 attribution and technical resize credits in `motion-lab/assets/gif/ATTRIBUTION.md`. Optional startup SD preload is outside LVGL; fallback animation consumes only existing cached RAM bytes/decoder and yields ownership to eligible photos or any cart/order/recovery. No generated assets, board pins, display driver, audio/probe or provisioning/install/capture/build helper changed in this slice.

Prepare approved motion public files locally with `python3 tools/firmware/prepare-motion-media.py`; `--sd-root /Volumes/<explicit-card>` requires an actual mounted card. Parent `tools/runtime/prepare-menu-assets.py` supplies `data/menu-assets.json`, generated firmware header and `local/menu-assets/v1` photo bytes. The standalone maintenance app and `tools/firmware/provision-motion-sd.py` use protocol2 with exactly17 pinned assets: original five under `bitpos/motion/v1` and twelve192000B photos under `bitpos/menu/v1`. No formatting/unrelated deletion, network/private inputs or NVS access. Original five-file publish/no-op proof is historical, not proof of the new17-file protocol. See `tools/firmware/sd-maintenance/README.md`. Header logo conversion remains reproducible with `local/toolchains/serial-env/bin/python tools/firmware/convert-logo.py`; generated source is committed.

## Private provisioning and recovery

`tools/firmware/provision.py` is **coordinator-only**. No worker USB writes were performed. It programmatically consumes permission-600 `local/private/wifi.json` (`ssid`, `password`) and a separate permission-600 device JSON (`ws_url`, `merchant`, `terminal`). Never display these inputs or publish generated NVS binaries. Temporary NVS CSV/binaries/readbacks are created permission-private and deleted automatically. Dry-run validates private inputs/recovery without USB access; `--write` explicitly enables provisioning.

```sh
local/toolchains/serial-env/bin/python tools/firmware/provision.py \
  --idf local/toolchains/esp-idf \
  --esptool local/toolchains/serial-env/bin/esptool.py \
  --device-config <private-device-json>
```

The helper requires the exact 16MB original backup SHA256 `1479cd385c2c8af87c2c1aed410bfd7e7c3fb8591e2ae08ddc213fb7cedb8fbf`. The inspected original region at `0xff0000` is an entirely erased 64KB coredump partition; only that exact verified region is converted to owned `bitpos_nvs`. Unexpected layout or non-erased bytes are refused. Before each USB write, helpers verify ESP32-S3 MAC `14:c1:9f:4e:62:48`, embedded 8MB PSRAM and 16MB flash. Provisioning requires the active owned partition, writes only it and byte-verifies readback. Already populated NVS is refused to preserve paid-order history. Credential updates require a state-preserving operation.

`tools/firmware/install.py` preserves original bootloader, NVS, OTA metadata, app1 and FAT offsets/content. It validates the built table against the inspected original layout, saves a private current full-flash preinstall backup, then writes/byte-verifies only the partition table and app0. Original OTA sequence selects app0; unexpected selection is refused. No full-flash erase or automatic retry. Both original and preinstall backups remain private for recovery. Inspection proved app1 was erased, so it is not claimed to contain a rollback image. Helpers leave the device in bootloader until private provisioning is complete.

For an already provisioned terminal, stop the owned serial capture first and use the app-only update boundary:

```sh
local/toolchains/serial-env/bin/python tools/firmware/install.py \
  --esptool local/toolchains/serial-env/bin/esptool.py --write --update-app
```

This verifies the active owned layout, requires the private full preinstall recovery backup, saves the current complete app0 region privately, rechecks hardware identity immediately before writing, and byte-verifies the new app. It never rewrites the table or populated NVS, preserving success-sound deduplication. An identical app performs no write. Do not use the generic `idf.py flash` command printed by the SDK: it would overwrite preserved regions.

An app-only install leaves bootstrap control unchanged. Boot explicitly with `local/toolchains/serial-env/bin/python tools/firmware/capture.py --reset --seconds 20 --output .omp/work/evidence/<new-boot-log>.log`, never by repeating flash. Default capture, framebuffer probe and SD protocol share raw POSIX exclusive serial transport without modem-line/reset calls; pyserial's previous automatic open reset the MCU. Do not overlap USB owners. Read-only `capture-frame.py --serial-owners-stopped --expected-version 0.2.4 --name <new-evidence-name>` verifies full RGB565 size/hash/trailer and uptime/flush count. Its frame comes from physical ESP32 LVGL after successful LCD DMA, not a camera, touch/audio observation or payment attribution.

## Verification status / acceptance gaps

Coordinator independently built/app-only byte-verified0.2.4 with ESP-IDF5.5.1; app `0x1802f0` fits preserved2MB app0 (25% free). Actual boot reconnects a silent paid snapshot and suppresses sound by persistent NVS dedup.0.2.3 coffee proof retains85290B cache,7569420B free/7471104B largest PSRAM and131072B reserve; two physical frames show762 changed coffee pixels/rising uptime and zero green vs4984 failing-before (`physical-gif-v023.json`). Authorized80M/day devnet policy passed18/18 enabled contracts/typecheck;1M/order and3payer-minute limits remain. Parser25 including12/50, media20, helper32 and host UI8/8574glyphs/214frames/100 teardown cycles remain exercised proof. Actual12-item phone bill retains107000THBminor/30571429USDGminor and six device lines including7-more; physical viewport/total captured. Thirty0.2.4 zero-SOL rounds finalized; all30 actual physical paid ACKs correlated, p95=817ms (`physical-ack-30.json`). First28 ran under60M daily policy, remaining2 under user-authorized80M; firmware binary and delivery source hashes identical, policy fingerprint revised honestly (`authorized-policy-provenance.json`). Prior0.2.3 paid p951714ms failure retained. Actual touch/audible speaker passed by direct user observation, not automated optical/audio proof. `native-v024-backend-offline.png` is a backend contract-fixture PAID1USDG state, not live payment proof. Run device integration fixtures with own live API stopped: two consumers otherwise compete for the durable sound claim. Final acceptance requires fresh native independent review/foreman gate; consult checkpoint/review evidence rather than treating build/latency alone as completion. Android Phantom user-deferred; full POS parity/PromptPay/rewards/OTA roadmap.

### Customer screensaver and concise UI — 0.3.3

Default idle alternates the cafe clock/animation with current product photos and verified offers. One touch opens the table ordering QR; idle QR returns after30seconds when no cart/order/pending request owns the device. A bounded quiet melody repeats every16seconds, stops when ordering/payment begins, and can be muted in the hamburger menu. The success cue keeps its durable once-only claim and priority.

Bill, pay QR/cancel, confirming, received, expiry/recovery and reconnect use short copy, bounded supported-font labels, and a scrollable bill with explicit phone overflow. Serving place is displayed once. Build/host UI/owned app-only install and real framebuffer evidence are recorded in `docs/CHECKPOINT.md`; host tap/audio adapters and historical paid receipts must not be presented as fresh0.3.3 human interaction or chain-payment proof.
