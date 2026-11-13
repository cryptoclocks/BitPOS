<!-- NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. -->
# BitPOS Mini — NEAR firmware on real hardware (14 Nov 2026)

- Board: ESP32-S3 (QFN56) rev v0.2, 8 MB PSRAM, 16 MB flash, MAC 14:c1:9f:4e:62:48, USB port /dev/cu.usbmodem1201.
- Backup first: full 16 MB read before any write, kept privately outside the repository
  (sha256 faffbab50092e4b62d2deb21662ac252f044b8dbfa74bbd987688459cb385869).
- Installed: `device/firmware/build-near/bitpos_terminal_near.bin` (1,597,408 bytes,
  sha256 073e94e42add725ed403eca324f5e871f0344fe8eb4d2b41a0cc1117cf8ddbf5) written to app1 (0x210000);
  `verify_flash` digest matched. OTA data selects slot 1. The standard firmware in app0, NVS and the FAT partition were not written.
- Note: `otatool.py write_ota_partition` failed while reading the partition table after it had already switched the
  slot, so app1 was written directly with `esptool write_flash 0x210000` and verified.

## Boot log (filtered)

```
I (660) app_init: Project name:     bitpos_terminal_near
I (660) app_init: App version:      0.5.0-near
I (666) BitPOS: BOOT product=bitpos_terminal version=0.5.0-near mac=14:c1:9f:4e:62:48
I (1098) BitPOS: BOOT product=bitpos_terminal_near version=0.5.0-near
I (1626) BitPOS: NEAR_KEY created
I (1933) BitPOS: NEAR_KEY pk=f787eca7e33691245f52e63217235b01ac972b84f90c40d3b19115a6ead4233e
NEAR_STATUS configured=0 device=- version=0.5.0-near pk=f787eca7e33691245f52e63217235b01ac972b84f90c40d3b19115a6ead4233e near_pk=ed25519:HfFuzNsjfdXpDmZDqu4XuQQ9gCoCcU5bHcMdqta3rUwF contract_pin=- rpc_pin=- last_witnessed=-
NEAR_SELFTEST rfc8032=ok device_key=ok ms=2151
```

## What this proves / what it does not

- Proves: the NEAR product boots on the device, creates its own ed25519 key on first boot, and the on-chip RFC 8032 test
  vector and device-key sign/verify self-test pass (2.15 s).
- Not yet run on hardware: provisioning to a shop, WiFi, TLS to the NEAR RPC, the screen-flush-gated witness signature
  and a device_ack on testnet. These need a public HTTPS origin (the hosted demo, not approved yet); the browser
  simulated screen runs the same protocol and was verified against testnet.
- Roll back: select slot 0 again (`otatool.py switch_ota_partition --slot 0`) or restore the private full backup.
