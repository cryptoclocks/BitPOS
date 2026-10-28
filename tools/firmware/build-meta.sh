#!/bin/bash
# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
# Builds the BitPOS Mini Meta product (bitpos_terminal_meta) into device/firmware/build-meta with its own sdkconfig,
# leaving the standard build untouched. Builds only; never flashes. Uses the ESP-IDF 5.5.1 toolchain at
# $BITPOS_IDF_ROOT (default: this checkout's local/toolchains, else the main BitPOS checkout's).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TC="${BITPOS_IDF_ROOT:-$ROOT/local/toolchains}"; [ -d "$TC/esp-idf" ] || TC="$HOME/Desktop/BitPOS/local/toolchains"
export IDF_TOOLS_PATH="$TC/idf-tools" IDF_PATH="$TC/esp-idf" BITPOS_PRODUCT=meta
source "$IDF_PATH/export.sh" >/dev/null
exec idf.py -C "$ROOT/device/firmware" -B "$ROOT/device/firmware/build-meta" -D SDKCONFIG="$ROOT/device/firmware/build-meta/sdkconfig" build
