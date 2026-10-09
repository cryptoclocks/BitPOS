#!/usr/bin/env python3
"""Compile actual v2 runtime/UI with pinned LVGL and explicit host-only adapters."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
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
    (temp / 'smoke.c').write_text('#include "table-host-adapters.h"\n' + media_helpers + body + '\n#include "table-ui-smoke.inc"\n')
    lvgl = ROOT / 'device/firmware/managed_components/lvgl__lvgl'
    fonts = ROOT / 'device/firmware/main'
    cjson = ROOT / 'local/toolchains/esp-idf/components/json/cJSON'
    cmake = f'''cmake_minimum_required(VERSION 3.16)
project(bitpos_ui_smoke C CXX ASM)
set(LV_CONF_PATH "{temp}/lv_conf.h" CACHE STRING "")
set(LV_CONF_BUILD_DISABLE_EXAMPLES ON CACHE BOOL "")
set(LV_CONF_BUILD_DISABLE_DEMOS ON CACHE BOOL "")
set(LV_CONF_BUILD_DISABLE_THORVG_INTERNAL ON CACHE BOOL "")
add_compile_options(-fsanitize=address,undefined -g)
add_link_options(-fsanitize=address,undefined)
add_subdirectory("{lvgl}" lvgl)
add_executable(ui-smoke smoke.c "{fonts}/bitpos_table.c" "{fonts}/bitpos_font_20.c" "{fonts}/bitpos_clock_64.c" "{fonts}/bitpos_logo.c" "{cjson}/cJSON.c")
target_include_directories(ui-smoke PRIVATE "{fonts}" "{cjson}" "{ROOT}/tools/firmware")
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
    result = subprocess.run([str(temp / 'build/ui-smoke'), str(temp), str(ROOT / 'motion-lab/assets/gif/coffee-128.gif')], text=True, capture_output=True,
                            env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0'})
    logs.append(result.stdout + result.stderr)
    (ROOT / '.omp/work/evidence/ui-host-smoke.log').write_text('\n'.join(logs))
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    # Existing read-only RGB565 decoder converts host-rendered frames, not optical evidence.
    spec = importlib.util.spec_from_file_location('capture_frame', ROOT / 'tools/firmware/capture-frame.py')
    capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capture)
    screenshots = []
    for frame in sorted(temp.glob('*.rgb565')):
        target = ROOT / '.omp/work/evidence' / ('host-ui-' + frame.stem + '.png')
        capture.rgb565_image(frame.read_bytes(), 480, 320).save(target)
        screenshots.append(str(target.relative_to(ROOT)))
proof = {'origin': 'pinned_lvgl_9_2_2_actual_v2_runtime_UI_host_fixture',
         'source_boundary': 'actual parser/state/UI/render gate/claim/consumer; explicit host transport/NVS/SHA/transfer/SD adapters',
         'checks': result.stdout.strip().splitlines(), 'sanitizers': ['ASan', 'UBSan'],
         'leak_sanitizer': 'Unsupported on macOS; disabled', 'screenshots': screenshots,
         'physical_touch_sd_sntp_crypto_audio_or_ACK_claim': False}
(ROOT / '.omp/work/evidence/ui-host-smoke.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
