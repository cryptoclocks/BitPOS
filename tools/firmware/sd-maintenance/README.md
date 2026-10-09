# Temporary BitPOS SD maintenance application — 1.1.0

This is a standalone ESP-IDF **5.5.1 / ESP32-S3** project, not the display runtime.
It has no LVGL, display, WiFi, network, NVS, OTA, flash or formatting operations.
It mounts the existing FAT card read/write only on the authorized board MAC
`14:c1:9f:4e:62:48`, using SDMMC slot 1, 1-bit, CLK12/CMD11/D013 and internal
pullups. Pin provenance is the extracted, unchanged
`device/firmware/components/board_bsp/include/ccp_board.h`. No board/display
component or asset was copied or modified. FAT long filenames use stack buffers
with a 64-character limit. A mount error is reported, **never formatted**.

Exactly17 public final files are supported. IDs0..4 remain under `/sdcard/bitpos/motion/v1`:

| ID | Basename | Bytes | SHA256 |
|---|---|---:|---|
| 0 | coffee-128.gif | 85290 | 618b8395ec723563136c721044fc87ac80622a4825873842fb1366cbfcd3336e |
| 1 | sparkles-128.gif | 22300 | 2d7fe7cd99d9985340500ff1ab9398ac8a5ec24f610d1aad688f8e00c38979e9 |
| 2 | party-popper-128.gif | 36413 | 7003b93a6379b9be0a945c3e8f2235f459b5b8a13ff6a7465c03bddcd4f55e34 |
| 3 | confetti-128.gif | 38606 | 724dd842e824ba5a43fdc3497cf7a77640447be141d307d09a9b2afae499b4d6 |
| 4 | payment-success-device.wav | 20524 | aa78633e92f389a5edc9216aa5068c0493ef1b17a661ebfcf81f0364e82af402 |

IDs5..16 are the twelve manifest-ordered480x200RGB565_LE photos, exactly192000B
each, under `/sdcard/bitpos/menu/v1`: espresso, americano, latte, iced-latte,
cappuccino, matcha, hot-chocolate, croissant, blueberry-muffin, chocolate-brownie,
cheesecake and sandwich (`.rgb565`). Photo hashes/names come directly from parent
`device/firmware/main/bitpos_menu_assets.generated.h`, never invented/copy-pinned
here; the client validates parent `data/menu-assets.json` and bytes prepared at
`local/menu-assets/v1`. The header must exist before the standalone build.

GIF provenance/attribution remains Google Noto Emoji, CC BY 4.0, with technical
128px downscaling (not replacement artwork): `motion-lab/assets/gif/manifest.json`
and its existing license materials. WAV provenance remains the original native
BitPOS synthesized cue in `asset-pack/audio/`. No 512px GIF, manifest, private
input or other card contents can be transferred. Status reports only the17
allowlisted hashes and states, never file data, card identity, a directory listing
or unrelated paths.

## Coordinator lifecycle

Stop competing serial capture before starting. Run from the integrated BitPOS
repository root. Build separately; never use `idf.py flash`, `erase-flash`, a
full-image loader or this application's bootloader/partition-table outputs.
Use the existing parent installer and private recovery backups only.

```sh
bash tools/firmware/build.sh --sd-maintenance
local/toolchains/serial-env/bin/python tools/firmware/provision-motion-sd.py \
  --identity-preflight --allow-identity-reset \
  --esptool local/toolchains/serial-env/bin/esptool.py
local/toolchains/serial-env/bin/python tools/firmware/install.py --update-app --write \
  --build tools/firmware/sd-maintenance/build \
  --buildtarget bitpos_sd_maintenance.bin \
  --esptool local/toolchains/serial-env/bin/esptool.py
local/toolchains/serial-env/bin/python tools/firmware/capture.py \
  --reset --seconds 3 --output .omp/work/evidence/sd-maintenance-explicit-boot.log
```

**The existing `provision.identity` helper enters ROM even with `--after no_reset`.**
Therefore identity preflight is a separate command requiring BOTH flags. It
programmatically consumes that helper's identity/PSRAM/16MB checks without
printing external tool output, and writes only a permissions-600 public receipt
at `local/motion-sd-identity.json` (schema1, MAC, fixed port, public memory sizes,
issue time, purpose). All17 public sources are size/SHA256 authenticated before
USB or receipt mutation. The receipt expires after 1800 seconds, including checks
before each write. If it expires, repeat the lifecycle from explicit preflight;
do not reset a live maintenance session to refresh identity silently.

The installed application's binary is `bitpos_sd_maintenance.bin`. Its generated
partition table deliberately matches the currently owned BitPOS layout so the
installer compares it; **do not write it**. Parent integration now supports the
explicit two-value `--buildtarget` argument; maintenance requires `--update-app`.
App0-only identity/layout checks, private prior-app backup and byte verification
remain mandatory; `bitpos_nvs` at `0xff0000` stays untouched.

Boot explicitly as above after installation if the chip remains in ROM.
`esptool --after hard_reset` alone did not boot this board in the observed
maintenance lifecycle; do not repeat flashing to correct bootstrap. Status/write
never reset or toggle DTR/RTS. Then:

```sh
local/toolchains/serial-env/bin/python tools/firmware/provision-motion-sd.py --status
local/toolchains/serial-env/bin/python tools/firmware/provision-motion-sd.py --write
local/toolchains/serial-env/bin/python tools/firmware/provision-motion-sd.py --status

# Restore the newly built clean runtime afterwards, including after refusal.
local/toolchains/serial-env/bin/python tools/firmware/install.py --update-app --write \
  --build device/firmware/build --buildtarget bitpos_terminal.bin \
  --esptool local/toolchains/serial-env/bin/esptool.py
```

Explicitly boot restored runtime with the same bounded `capture.py --reset`
operation, then verify media and persistent payment dedup separately.
Parent actual proof: maintenance build passed after local SD enum namespacing;
first publish verified five pinned files, second write returned five matching
no-ops (`sd-maintenance-publish.log`, `sd-maintenance-noop.log` in evidence).
Runtime0.2.3 was restored app-only and actual coffee animation/headroom proved
(`physical-gif-v023.json`). Matching SD files alone do not prove audio/touch.

Host dependencies: Python >=3.9 (Path.is_relative_to), POSIX/macOS termios/select,
and the existing `provision.py` beside the script. No pyserial or new pip package
is used. The selected Python must also support the existing esptool installation
for **preflight only**. Firmware uses only IDF built-ins:
`esp_driver_usb_serial_jtag`, `esp_driver_sdmmc`, `fatfs`, `sdmmc`,
`esp_hw_support`, `esp_timer`, `mbedtls` plus the SDK's common heap/FreeRTOS
components. PSRAM is required; no internal-heap fallback exists.

## Binary protocol v2

USB Serial/JTAG uses the actual 5.5.1 API from
`components/esp_driver_usb_serial_jtag/include/driver/usb_serial_jtag.h`:
`usb_serial_jtag_driver_install`, `usb_serial_jtag_read_bytes`,
`usb_serial_jtag_write_bytes`. Driver TX=1024, RX=4096 bytes. Console and app logs
are disabled. The inherited bootloader may still emit public startup text; the
host discards at most 8192 bytes when finding the magic.

Every frame has a fixed 64-byte header; all integers are little-endian:

| Offset | Length | Field |
|---:|---:|---|
| 0 | 4 | ASCII `BPSD` |
| 4 | 1 | Protocol version2; version1 is rejected |
| 5 | 1 | Opcode: hello0, status1, write2; replies OR 0x80 |
| 6 | 1 | Commands must be zero; replies carry result |
| 7 | 1 | Asset ID0..16, or255 for hello/status |
| 8 | 4 | Host request sequence, echoed; hello sequence0 |
| 12 | 16 | Boot/session nonce, required exact match on every command |
| 28 | 4 | Payload bytes (write command = exact pinned asset size) |
| 32 | 32 | Write command = exact pinned SHA256; otherwise all zero |

Hello is sent on boot and every idle second: reply0x80/result0/ID255, payload25.
Payload is MAC6, mount-success1, count1 (=17), then17 file states:
0missing / 1exact-match / 2unknown-conflict / 3unreadable. It exposes protocol
version and fresh nonce without requiring the host to send a discovery command
or touch serial modem lines. Hello caches states; status rehashes all17 files.
Status command has ID255/length0/hash0 and returns this same payload. Wrong
version, flags or nonce cannot mutate the card. Unknown operations are refused.
Nonce is a public session binding, not a password or protection against someone
with physical serial access; this is an explicitly temporary app.

Write command selects an asset ID (never a caller-provided path), exact size/hash,
and current nonce. Reply0x82 has no payload. Results:
0published / 1ready-for-raw-bytes / 2already-matching-no-op / 3conflict /
4IO-error / 5invalid / 6receive-timeout / 7PSRAM-unavailable.
Do **not** send data until result1. Send exactly the pinned bytes; the final reply
is correlated to the same request. A result2 or refusal is terminal without a
payload transfer. The host validates MAC on boot/status and nonce on every reply.
No automatic write retry, reset, flash, or external network operation exists.

## Safety, timeouts and recovery

* Host validates all17 local sources before any serial access, then validates
  the fresh bounded receipt before opening the fixed `/dev/cu.usbmodem101`.
  The serial session uses `os.open`, exclusive tty access, raw8N1, no HUPCL or
  flow control, and **no modem-line ioctl, pyserial, DTR/RTS or reset call**. OS
  driver behavior itself still requires parent observation; this is not physical
  no-reset proof. Errors never print raw serial/tool/file bytes or exception repr.
* Firmware mounts only the existing FAT card, without formatting. Boot/status
  make no directories and never clean staging files. Only an explicitly accepted
  authenticated write can create only the owned motion/menu version directories.
* Firmware receives one exact file in PSRAM (maximum/hard cap192000B),
  authenticates its complete SHA256 **before any directory/temp mutation**, and
  frees it on every completion/receive failure. Header deadline2s, data deadline30s;
  invalid framing/receive timeout discards bounded queued data and renews nonce.
  Host bounds boot discovery/status90s (all17 bounded file hashes), command send2s, initial write reply10s,
  upload20s and final write reply40s. A timeout stops the host, not a blind retry.
* Destinations with exact size/hash are no-op. Unknown bytes, directories or read
  failures are refused, never overwritten/deleted. Host checks all17 states
  before any write, so an existing conflict prevents the entire upload session.
  There is no multi-file transaction; interruption may leave some files installed.
* Each asset has one reserved staging path `.bitpos-sd-v2-ID.tmp` within its owned
  directory. No wildcard scan is used. On a new authenticated write, an existing
  staging regular file is only removed if its length is bounded and every byte
  is an exact prefix of the authenticated public source. Unknown staging bytes
  are refused and preserved. This handles an interrupted temp write without
  adopting/deleting unrelated content. Nothing is automatically cleaned at boot.
* Publish is exclusive temp creation, bounded writes, fsync, close, exact temp
  size/hash readback, destination recheck, then same-filesystem FatFs rename and
  final exact destination verification. IDF's FatFs rename rejects an existing
  destination, rather than replacing it. Prefix inspection/hash loops have3s
  deadlines, temp writes20s, with SD command timeout1s. A filesystem failure leaves
  its reserved staging file for an authenticated convergence attempt. A complete
  destination after a lost reply converges to no-op on retry.
* **FAT is not a journaling filesystem.** Rename is the logical atomic publication
  boundary, not a claim of crash-proof FAT metadata durability or multi-file
  atomicity. A power cut can require card-level recovery; an unknown/damaged final
  destination or temp is refused, not “repaired” by overwriting it. The helper
  never formats a damaged card, erases flash, lists unrelated data or modifies NVS.

This protocol2/17-asset source update is unbuilt and unexercised at hand-off.
The historical protocol1 five-file physical publish/no-op above is preserved,
not extended into a new-source claim. Host helper smoke covers all17 publication,
conflict preservation, exact-size/hash, interruption and idempotent no-op paths.
FAT crash durability and actual board throughput/headroom remain physical gaps.

Parent verification should cover build/config dependencies, source mismatch before
USB, stale receipt, wrong MAC/nonce, bounded malformed frames, receive disconnect,
no-op retry, existing unknown destination/temp refusal, interrupted matching-prefix
temp convergence, actual mount/readback, and restoration of clean runtime. Do not
repeat the already established cached decoder host proof; SD/widget/audio remain
separate physical checks.
