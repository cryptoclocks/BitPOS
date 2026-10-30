#!/bin/bash
# Build both apps against the OCI-hosted BitPOS API (no fixture flag, no adb reverse) and install on one adb serial.
# Usage: try-apps-oci.sh <adb serial> [--debug]
# Release (debug-key signed per the Android template) is preferred; --debug builds a debug APK instead.
# Override the origin with BITPOS_OCI_ORIGIN (default https://pay.cashlessthailand.com).
set -e
export PATH=$HOME/development/flutter/bin:$HOME/Library/Android/sdk/platform-tools:$PATH
SER="$1"; [ -n "$SER" ] || { echo "usage: $0 <adb serial> [--debug]"; exit 1; }
MODE=release; [ "$2" = "--debug" ] && MODE=debug
ORIGIN="${BITPOS_OCI_ORIGIN:-https://pay.cashlessthailand.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for app in customer driver; do
 (cd "$ROOT/apps/mobile-$app" && flutter build apk --$MODE \
   --dart-define=BITPOS_MOBILE_API="$ORIGIN/api/mobile/v1/" \
   --dart-define=BITPOS_PAYMENT_ORIGIN="$ORIGIN" \
  && adb -s "$SER" install -r build/app/outputs/flutter-apk/app-$MODE.apk)
done
