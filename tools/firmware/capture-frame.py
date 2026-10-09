#!/usr/bin/env python3
"""Capture real ESP32 LVGL pixels, not HTML/camera/touch evidence.

Parent-only use after stopping capture.py, install/provision/monitor serial owners.
Requires exclusive BitPOS probe driver/log-callback ownership in the firmware;
normal logs retain SIMPLE VFS, never the indefinitely blocking driver-routed VFS.
No status commands, event injection, raw-log output or automatic reset/retry.

Example (use the actual integrated app version):
  local/toolchains/serial-env/bin/python tools/firmware/capture-frame.py \
    --serial-owners-stopped --expected-version 0.2.0 --name native-home

Outputs only .omp/work/evidence/<name>.png and <name>.json after verifying the
complete bounded frame/trailer, pinned identity/version and payload SHA-256.
MAC/version are firmware-reported, not an independent esptool identity check.
The PNG is the logical RGB565 buffer after successful synchronous LCD DMA;
panel rotation/flip/byte swap are reported, not applied to the logical PNG.
This cannot prove panel optical output, physical touch, audio or payment facts.
Protocol: 128-byte little-endian header, packed RGB565-LE payload, 16-byte end.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import sys
import time

from PIL import Image
from serial_port import SerialPort

COMMAND = b"BITPOS_CAPTURE_FRAME_V1\n"
MAGIC = b"BITPOS_FRAME_V1\x00"
TRAILER = b"BITPOS_FRAME_END"
MAX_BYTES = 307200
MAC = "14:c1:9f:4e:62:48"


class CaptureError(Exception):
    """Only public fixed error codes may reach the console."""




def exact(port, count, deadline):
    result = bytearray()
    while len(result) < count:
        if time.monotonic() >= deadline:
            raise CaptureError("incomplete_frame_or_timeout")
        chunk = port.read(count - len(result))
        result.extend(chunk)
    return bytes(result)


def header_start(port, deadline):
    # Discard bounded startup/public logs without printing, decoding or saving.
    window = bytearray()
    for _ in range(65536):
        window.extend(exact(port, 1, deadline))
        if len(window) > len(MAGIC):
            del window[0]
        if window == MAGIC:
            return MAGIC + exact(port, 128 - len(MAGIC), deadline)
    raise CaptureError("frame_marker_not_found")


def receive(port, expected_version):
    deadline = time.monotonic() + 8
    header = header_start(port, deadline)
    header_bytes, width, height, pixel_format, count, flush = struct.unpack_from("<HHHHII", header, 16)
    snapshot_us = struct.unpack_from("<Q", header, 32)[0]
    mac = ":".join(f"{byte:02x}" for byte in header[40:46])
    rotation = struct.unpack_from("<H", header, 46)[0]
    flip = header[48]
    version_bytes = header[56:88]
    # Reject unbounded or undisclosed metadata rather than echoing it.
    if b"\0" not in version_bytes:
        raise CaptureError("invalid_version")
    version, padding = version_bytes.split(b"\0", 1)
    if any(padding) or version != expected_version.encode("ascii"):
        raise CaptureError("version_mismatch")
    if (header_bytes != 128 or pixel_format != 1 or width != 480 or height != 320 or
            count != width * height * 2 or count > MAX_BYTES or flush == 0 or snapshot_us == 0 or
            mac != MAC or rotation not in (0, 90, 180, 270) or flip not in (0, 1) or
            any(header[49:56]) or any(header[120:128])):
        raise CaptureError("invalid_frame_or_identity")
    pixels = exact(port, count, deadline)
    if exact(port, len(TRAILER), deadline) != TRAILER:
        raise CaptureError("invalid_frame_trailer")
    digest = hashlib.sha256(pixels).digest()
    if digest != header[88:120]:
        raise CaptureError("pixel_checksum_mismatch")
    metadata = {
        "schema": "bitpos.native_frame.v1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "origin": "physical_esp32_lvgl_framebuffer",
        "source_boundary": "logical_LVGL_RGB565_buffer_after_successful_synchronous_LCD_DMA",
        "identity_boundary": "MAC_and_app_version_reported_by_firmware_header_not_independent_USB_identity_verification",
        "firmware_reported_mac": mac,
        "firmware_reported_version": expected_version,
        "width": width,
        "height": height,
        "pixel_format": "RGB565_little_endian",
        "payload_bytes": count,
        "payload_sha256": digest.hex(),
        "completed_lcd_flush_counter": flush,
        "snapshot_device_uptime_us": snapshot_us,
        "panel_software_rotation_degrees": rotation,
        "panel_flip180": bool(flip),
        "png_orientation": "logical_framebuffer_no_panel_transform",
        "verification": "full_payload_size_sha256_and_trailer_verified",
        "not_proven": ["camera_or_optical_panel_output", "touch", "audio", "payment_or_ACK_attribution"],
    }
    return pixels, metadata


def rgb565_image(pixels, width, height):
    rgb = bytearray(width * height * 3)
    for index, (pixel,) in enumerate(struct.iter_unpack("<H", pixels)):
        red = (pixel >> 11) & 31
        green = (pixel >> 5) & 63
        blue = pixel & 31
        at = index * 3
        rgb[at] = (red << 3) | (red >> 2)
        rgb[at + 1] = (green << 2) | (green >> 4)
        rgb[at + 2] = (blue << 3) | (blue >> 2)
    return Image.frombytes("RGB", (width, height), bytes(rgb))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial-owners-stopped", action="store_true", required=True,
                        help="Parent explicitly confirms no capture/provision/install/monitor USB owner")
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--name", required=True, help="New evidence basename, no overwrite")
    # Boot/reset is a separate coordinator operation, never a capture option.
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", args.name):
        raise CaptureError("invalid_evidence_name")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,30}", args.expected_version):
        raise CaptureError("invalid_expected_version")
    root = Path(__file__).resolve().parents[2]
    evidence = root / ".omp/work/evidence"
    if not evidence.resolve().is_relative_to(root):
        raise CaptureError("unsafe_evidence_directory")
    png_path = evidence / f"{args.name}.png"
    json_path = evidence / f"{args.name}.json"
    if png_path.exists() or json_path.exists() or png_path.is_symlink() or json_path.is_symlink():
        raise CaptureError("evidence_already_exists")
    with SerialPort() as port:
        if port.write(COMMAND) != len(COMMAND):
            raise CaptureError("command_write_incomplete")
        pixels, metadata = receive(port, args.expected_version)
    image = rgb565_image(pixels, metadata["width"], metadata["height"])
    png = io.BytesIO()
    image.save(png, format="PNG")
    png_bytes = png.getvalue()
    metadata["png_sha256"] = hashlib.sha256(png_bytes).hexdigest()
    metadata["png_path"] = str(png_path.relative_to(root))
    metadata["transport"] = "POSIX_raw_tty_without_modem_line_or_reset_calls"
    metadata["physical_no_reset_claim"] = False  # OS behavior must be observed.
    json_bytes = (json.dumps(metadata, indent=2) + "\n").encode("utf8")
    evidence.mkdir(parents=True, exist_ok=True)
    written = []
    try:
        for path, content in ((png_path, png_bytes), (json_path, json_bytes)):
            with path.open("xb") as output:
                written.append(path)
                output.write(content)
    except OSError:
        for path in written:
            path.unlink(missing_ok=True)
        raise CaptureError("evidence_write_failed") from None
    print(f"Verified native frame: {png_path.relative_to(root)} {json_path.relative_to(root)}")


if __name__ == "__main__":
    try:
        main()
    except CaptureError as error:
        print(f"Capture failed: {error}", file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError):
        # Exception text can contain raw serial bytes/device data: withhold it.
        print("Capture failed: serial_or_file_operation_failed", file=sys.stderr)
        sys.exit(1)
