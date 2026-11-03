#!/bin/bash
# Build both apps against the OCI-hosted BitPOS API (no fixture flag, no adb reverse) and install on one adb serial.
# Usage: try-apps-oci.sh <adb serial> [--debug]
# Demo quick-sign-in buttons (fixed test OTP numbers) are compiled in.
# Release (debug-key signed per the Android template) is preferred; --debug builds a debug APK instead.
# Override the origin with BITPOS_OCI_ORIGIN (default https://pay.cashlessthailand.com).
set -e
export PATH=$HOME/development/flutter/bin:$HOME/Library/Android/sdk/platform-tools:$PATH
SER="$1"; [ -n "$SER" ] || { echo "usage: $0 <adb serial> [--debug]"; exit 1; }
MODE=release; [ "$2" = "--debug" ] && MODE=debug
ORIGIN="${BITPOS_OCI_ORIGIN:-https://pay.cashlessthailand.com}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Optional Firebase client config (private, outside the repo): BITPOS_FIREBASE_JSON=<google-services.json holding both apps>.
FB="${BITPOS_FIREBASE_JSON:-$HOME/Desktop/BitPOS-Devnet-Private/firebase/google-services-all.json}"
for app in customer driver; do
 PUSH=()
 if [ -f "$FB" ]; then
  read -r KEY APPID SENDER PROJ < <(python3 - "$FB" "com.bitpos.bitpos_$app" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]));c=next(x for x in d['client'] if x['client_info']['android_client_info']['package_name']==sys.argv[2])
print(c['api_key'][0]['current_key'],c['client_info']['mobilesdk_app_id'],d['project_info']['project_number'],d['project_info']['project_id'])
PY
)
  PUSH=(--dart-define=BITPOS_PUSH_FIREBASE_API_KEY="$KEY" --dart-define=BITPOS_PUSH_FIREBASE_APP_ID="$APPID" --dart-define=BITPOS_PUSH_FIREBASE_SENDER_ID="$SENDER" --dart-define=BITPOS_PUSH_FIREBASE_PROJECT_ID="$PROJ")
 fi
 (cd "$ROOT/apps/mobile-$app" && flutter build apk --$MODE "${PUSH[@]}" \
   --dart-define=BITPOS_MOBILE_API="$ORIGIN/api/mobile/v1/" \
   --dart-define=BITPOS_PAYMENT_ORIGIN="$ORIGIN" --dart-define=BITPOS_DEMO_QUICK_SIGNIN=true \
  && adb -s "$SER" install -r build/app/outputs/flutter-apk/app-$MODE.apk)
done
