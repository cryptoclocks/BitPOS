#!/usr/bin/env python3
"""Compile actual v2 runtime/UI with pinned LVGL and explicit host-only adapters."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import hashlib

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pickup-transport-output', type=Path,
                    help='Build a JSON-lines production-consumer adapter for an actual WebSocket bridge; do not run fixtures')
parser.add_argument('--promotion-photo', type=Path,
                    help='Exercise promotion production consumer/HTTPS/cache with this real product photograph (explicit host fixture)')
parser.add_argument('--menu-only', action='store_true', help='Only menu pointer/navigation guards; skip unrelated payment/media/audio cases')
parser.add_argument('--evidence-dir', type=Path, default=ROOT / '.omp/work/evidence')
args = parser.parse_args()
if args.menu_only and (args.promotion_photo or args.pickup_transport_output):
    parser.error('menu-only cannot be combined with other variants')
if args.promotion_photo and args.pickup_transport_output:
    parser.error('promotion fixture and pickup transport are separate runs')
args.evidence_dir.mkdir(parents=True, exist_ok=True)
variant = 'menu-host-smoke' if args.menu_only else 'promotion-host-smoke' if args.promotion_photo else 'ui-host-smoke'
source = (ROOT / 'device/firmware/main/main.c').read_text()
# Actual state, parser, callbacks, UI, flush gate, dedup and consumer include;
# excludes SDK startup/WiFi callbacks, not a copy of the feature implementation.
body = source[source.index('#define MESSAGE_MAX'):source.index('/* WebSocket callbacks only assemble')]
media = (ROOT / 'device/firmware/main/bitpos_media.c').read_text()
def media_function(name):
    # One brace-balanced extraction of actual production helper, not a rewrite.
    start = media.rfind('\n', 0, media.index(name + '(')) + 1
    opening = media.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (media[end] == '{') - (media[end] == '}')
        end += 1
    return media[start:end] + '\n'
media_helpers = ''.join(media_function(name) for name in [
    'le16', 'skip_blocks', 'first_transparent_background', 'clear_initial_background',
    'fs_open', 'fs_close', 'fs_read', 'fs_seek', 'fs_tell', 'bitpos_media_prepare_canvas'])
promotion_boundary = ''
if args.promotion_photo:
    media_helpers += ''.join(media_function(name) for name in [
        'media_disk_status', 'media_disk_read', 'media_disk_write', 'media_disk_ioctl',
        'promotion_cache_path', 'bitpos_media_promotion_read', 'bitpos_media_promotion_write'])
    promotion_boundary = '#include "bitpos_promotion_image.c"\n'
config = '''#ifndef LV_CONF_H
#define LV_CONF_H
#define LV_COLOR_DEPTH 16
#define LV_USE_STDLIB_MALLOC LV_STDLIB_CLIB
#define LV_USE_OS LV_OS_NONE
#define LV_USE_LOG 0
#define LV_USE_GIF 1
#define LV_GIF_CACHE_DECODE_DATA 1
#define LV_USE_QRCODE 1
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_28 1
#define LV_FONT_MONTSERRAT_32 1
#define LV_FONT_MONTSERRAT_48 1
#endif
'''
with tempfile.TemporaryDirectory(prefix='bitpos-v2-native-ui-') as directory:
    temp = Path(directory)
    (temp / 'lv_conf.h').write_text(config)
    (temp / 'host_mbedtls_config.h').write_text('#define MBEDTLS_SHA256_C\n')
    if args.promotion_photo:
        # Only SDK interfaces are substituted; production HTTPS loop/cache remain.
        for header in ['esp_http_client.h', 'esp_crt_bundle.h', 'esp_timer.h', 'esp_heap_caps.h',
                       'freertos/FreeRTOS.h', 'freertos/task.h', 'freertos/queue.h']:
            target = temp / header
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('/* Explicit host SDK boundary; declarations in promotion-host-adapters.h. */\n')
    (temp / 'smoke.c').write_text('#include "table-host-adapters.h"\n' + media_helpers + promotion_boundary + body + '\n#include "table-ui-smoke.inc"\n')
    lvgl = ROOT / 'device/firmware/managed_components/lvgl__lvgl'
    fonts = ROOT / 'device/firmware/main'
    cjson = ROOT / 'local/toolchains/esp-idf/components/json/cJSON'
    mbedtls = ROOT / 'local/toolchains/esp-idf/components/mbedtls/mbedtls'
    cmake = f'''cmake_minimum_required(VERSION 3.16)
project(bitpos_ui_smoke C CXX ASM)
set(LV_CONF_PATH "{temp}/lv_conf.h" CACHE STRING "")
set(LV_CONF_BUILD_DISABLE_EXAMPLES ON CACHE BOOL "")
set(LV_CONF_BUILD_DISABLE_DEMOS ON CACHE BOOL "")
set(LV_CONF_BUILD_DISABLE_THORVG_INTERNAL ON CACHE BOOL "")
add_compile_options(-fsanitize=address,undefined -g)
add_link_options(-fsanitize=address,undefined)
add_subdirectory("{lvgl}" lvgl)
add_executable(ui-smoke smoke.c "{fonts}/bitpos_table.c" "{fonts}/bitpos_promotion.c" "{fonts}/bitpos_font_20.c" "{fonts}/bitpos_clock_64.c" "{fonts}/bitpos_logo.c" "{cjson}/cJSON.c" "{mbedtls}/library/sha256.c" "{mbedtls}/library/platform_util.c")
target_include_directories(ui-smoke PRIVATE "{temp}" "{fonts}" "{cjson}" "{ROOT}/tools/firmware" "{mbedtls}/include" "{mbedtls}/library")
target_compile_definitions(ui-smoke PRIVATE MBEDTLS_CONFIG_FILE="host_mbedtls_config.h")
{"target_compile_definitions(ui-smoke PRIVATE BITPOS_PROMOTION_TEST=1 BITPOS_HOST_REAL_SHA=1)" if args.promotion_photo else ""}
{"target_compile_definitions(ui-smoke PRIVATE BITPOS_PICKUP_TRANSPORT=1)" if args.pickup_transport_output else ""}
target_link_libraries(ui-smoke PRIVATE lvgl m)
'''
    (temp / 'CMakeLists.txt').write_text(cmake)
    logs = []
    for command in [['cmake', '-S', str(temp), '-B', str(temp / 'build')],
                    ['cmake', '--build', str(temp / 'build'), '--parallel', '6']]:
        result = subprocess.run(command, text=True, capture_output=True)
        logs.append(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
    if args.pickup_transport_output:
        target = args.pickup_transport_output.resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(temp / 'build/ui-smoke', target)
        print(json.dumps({'host_transport_binary': str(target), 'physical_proof': False}))
        raise SystemExit(0)
    command = [str(temp / 'build/ui-smoke'), str(temp), str(ROOT / 'motion-lab/assets/gif/coffee-128.gif')]
    photo_provenance = None
    if args.promotion_photo:
        from PIL import Image, ImageOps
        image = ImageOps.fit(Image.open(args.promotion_photo).convert('RGB'), (280, 200), method=Image.Resampling.LANCZOS)
        raw = bytearray()
        for red, green, blue in image.getdata():
            pixel = ((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3)
            raw.extend(pixel.to_bytes(2, 'little'))
        photo = temp / 'fixture-photo.rgb565'
        photo.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        command += [str(photo), digest]
        photo_provenance = {'kind': 'actual_product_photo_host_transport_fixture',
                            'source_sha256': hashlib.sha256(args.promotion_photo.read_bytes()).hexdigest(),
                            'rgb565_sha256': digest, 'bytes': len(raw), 'width': 280, 'height': 200}
    result = subprocess.run(command, text=True, capture_output=True,
                            env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0', **({'BITPOS_MENU_ONLY':'1'} if args.menu_only else {})})
    logs.append(result.stdout + result.stderr)
    (args.evidence_dir / (variant + '.log')).write_text('\n'.join(logs))
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    # Existing read-only RGB565 decoder converts host-rendered frames, not optical evidence.
    spec = importlib.util.spec_from_file_location('capture_frame', ROOT / 'tools/firmware/capture-frame.py')
    capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capture)
    screenshots = []
    for frame in sorted(temp.glob('*.rgb565')):
        target = args.evidence_dir / ('host-ui-' + frame.stem + '.png')
        capture.rgb565_image(frame.read_bytes(), 480, 320).save(target)
        screenshots.append(str(target))
proof = {'origin': 'pinned_lvgl_9_2_2_actual_v2_runtime_UI_host_fixture',
         'source_boundary': 'actual parser/state/UI/render gate/claim/consumer; explicit host transport/NVS/transfer/SD adapters; real mbedTLS SHA for promotion variant',
         'checks': result.stdout.strip().splitlines(), 'sanitizers': ['ASan', 'UBSan'],
         'leak_sanitizer': 'Unsupported on macOS; disabled', 'screenshots': screenshots,
         'physical_touch_sd_sntp_crypto_audio_or_ACK_claim': False}
if photo_provenance:
    proof['photo'] = photo_provenance
    proof['real_mbedtls_sha256'] = True
(args.evidence_dir / (variant + '.json')).write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
if not args.promotion_photo and not args.menu_only:
    subprocess.run(['python3', str(ROOT / 'tools/firmware/pickup-audio-smoke.py')], check=True)
