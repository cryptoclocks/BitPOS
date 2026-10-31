#!/bin/bash
# Usage with OCI: try-apps-install.sh <serial> oci  (see try-apps-oci.sh)
# LOCAL-ONLY: build debug APKs of both apps and install them. Usage: try-apps-install.sh emulator-5554|<phone serial>
# Emulator reaches the Mac at 10.0.2.2; a USB phone uses `adb reverse` + 127.0.0.1 (the apps allow plain HTTP only for loopback/10.0.2.2 in fixture mode).
set -e
export PATH=$HOME/development/flutter/bin:$HOME/Library/Android/sdk/platform-tools:$PATH
if [ "$2" = "oci" ]; then exec "$(dirname "$0")/try-apps-oci.sh" "$1"; fi
SER="$1"; [ -n "$SER" ] || { echo "usage: $0 <adb serial>"; exit 1; }
case "$SER" in emulator-*) HOST=10.0.2.2;; *) HOST=127.0.0.1; adb -s "$SER" reverse tcp:3043 tcp:3043;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for app in customer driver; do
 (cd "$ROOT/apps/mobile-$app" && flutter build apk --debug --dart-define=BITPOS_MOBILE_API=http://$HOST:3043/api/mobile/v1/ --dart-define=BITPOS_FIXTURE=true && adb -s "$SER" install -r build/app/outputs/flutter-apk/app-debug.apk)
done
