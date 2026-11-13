#!/bin/bash
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Builds the pure-C parts of the BitPOS Mini NEAR firmware with the Mac's cc and runs their tests: RFC 8032
# Ed25519 vectors, encoders, the witness message and the bounded get_bill parser. Then prints the fixed-seed
# witness vector as JSON and, when node is available, checks it against Node's own Ed25519. No ESP-IDF, no device.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../../device/firmware/main"
OUT="${TMPDIR:-/tmp}/bitpos-near-host-test.$$"
mkdir -p "$OUT"; trap 'rm -rf "$OUT"' EXIT
cc -std=c11 -O2 -Wall -Wextra -Werror -Wconversion -Wno-sign-conversion -fsanitize=address,undefined -fno-sanitize-recover=all \
  -DBITPOS_NEAR_HOST -I"$SRC" "$SRC/bitpos_near_ed25519.c" "$SRC/bitpos_near_core.c" "$HERE/near_host_test.c" -o "$OUT/near_host_test"
"$OUT/near_host_test" | tee "$OUT/log"
VECTOR="$("$OUT/near_host_test" vector)"
echo "VECTOR $VECTOR"
if command -v node >/dev/null; then
  node "$HERE/verify.mjs" "$VECTOR" "$(awk '/^INFO sha512-200a /{print $3}' "$OUT/log")"
else
  echo "SKIP node cross-check (node not found)"
fi
