#!/bin/bash
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Builds the BitPOS Mini NEAR product (bitpos_terminal_near) into device/firmware/build-near with its own sdkconfig,
# leaving the standard build untouched. Builds only; never flashes and never opens a serial port. Uses the ESP-IDF
# 5.5.1 toolchain at $BITPOS_IDF_ROOT (default: this checkout's local/toolchains, else the main BitPOS checkout's).
# The host test of the crypto and parser runs first: a build is not produced from code that fails it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$ROOT/tools/firmware/near-host-test/run.sh" >/dev/null || { echo "near-host-test failed; run tools/firmware/near-host-test/run.sh" >&2; exit 1; }
TC="${BITPOS_IDF_ROOT:-$ROOT/local/toolchains}"; [ -d "$TC/esp-idf" ] || TC="$HOME/Desktop/BitPOS/local/toolchains"
export IDF_TOOLS_PATH="$TC/idf-tools" IDF_PATH="$TC/esp-idf" BITPOS_PRODUCT=near
source "$IDF_PATH/export.sh" >/dev/null
exec idf.py -C "$ROOT/device/firmware" -B "$ROOT/device/firmware/build-near" -D SDKCONFIG="$ROOT/device/firmware/build-near/sdkconfig" build
