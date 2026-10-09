#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="$ROOT/device/firmware"
if [[ $# -eq 1 && "$1" == "--sd-maintenance" ]]; then
  PROJECT="$ROOT/tools/firmware/sd-maintenance"
elif [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--sd-maintenance]" >&2
  exit 2
fi
export IDF_TOOLS_PATH="$ROOT/local/toolchains/idf-tools"
export IDF_PATH="$ROOT/local/toolchains/esp-idf"
# This helper builds only; never invokes flash, monitor, USB or provisioning.
source "$IDF_PATH/export.sh"
exec idf.py -C "$PROJECT" build
