#!/usr/bin/env python3
"""Public-only SD maintenance client. No serial reset, flashing or network access.

Identity preflight is a SEPARATE, explicitly reset-authorized operation using the
existing provision.identity helper. See sd-maintenance/README.md for ordering.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import stat
import struct
import sys
import tempfile
import time

from provision import MAC, PORT, identity, private_json
from serial_port import SerialPort

ROOT = Path(__file__).resolve().parents[2]
RECEIPT = ROOT / 'local/motion-sd-identity.json'
MAX_RECEIPT_AGE = 1800
MAX_FILE = 192000
PROTOCOL = 2
MENU_FILES = ('espresso', 'americano', 'latte', 'iced-latte', 'cappuccino', 'matcha',
              'hot-chocolate', 'croissant', 'blueberry-muffin', 'chocolate-brownie',
              'cheesecake', 'sandwich')
def menu_assets():
    # Generated public manifest is the sole source of photo hashes. Never infer
    # paths from network input, accept private sources, or accept a foreign root.
    path = ROOT / 'data/menu-assets.json'
    if path.resolve(strict=True) != ROOT / 'data/menu-assets.json':
        raise ValueError('Public menu manifest path refused')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
            raise ValueError('Public menu manifest refused')
        manifest = json.load(source)
    if (manifest.get('schemaVersion') != 1 or manifest.get('version') != 'bitpos-menu-v1' or
        manifest.get('width') != 480 or manifest.get('height') != 200 or
        manifest.get('pixelFormat') != 'RGB565_LE' or manifest.get('maxPhotos') != 12 or
        manifest.get('sdRoot') != '/sdcard/bitpos/menu/v1' or len(manifest.get('assets', [])) != 12):
        raise ValueError('Public menu manifest contract refused')
    rows = []
    for name, row in zip(MENU_FILES, manifest['assets']):
        digest = row.get('sha256', '')
        if (row.get('file') != name + '.rgb565' or row.get('catalogKey') != 'cafe.' + name or
            row.get('bytes') != MAX_FILE or len(digest) != 64 or
            any(c not in '0123456789abcdef' for c in digest)):
            raise ValueError('Public menu asset identity refused')
        rows.append((row['file'], MAX_FILE, digest, 'local/menu-assets/v1'))
    return tuple(rows)
ASSETS = (
    ('coffee-128.gif', 85290, '618b8395ec723563136c721044fc87ac80622a4825873842fb1366cbfcd3336e', 'motion-lab/assets/gif'),
    ('sparkles-128.gif', 22300, '2d7fe7cd99d9985340500ff1ab9398ac8a5ec24f610d1aad688f8e00c38979e9', 'motion-lab/assets/gif'),
    ('party-popper-128.gif', 36413, '7003b93a6379b9be0a945c3e8f2235f459b5b8a13ff6a7465c03bddcd4f55e34', 'motion-lab/assets/gif'),
    ('confetti-128.gif', 38606, '724dd842e824ba5a43fdc3497cf7a77640447be141d307d09a9b2afae499b4d6', 'motion-lab/assets/gif'),
    ('payment-success-device.wav', 20524, 'aa78633e92f389a5edc9216aa5068c0493ef1b17a661ebfcf81f0364e82af402', 'asset-pack/audio'),
) + menu_assets()
HEADER = struct.Struct('<4sBBBBI16sI32s')
HELLO, STATUS, WRITE = 0, 1, 2
OK, READY, NOOP, CONFLICT, IO_ERROR, INVALID, TIMED_OUT, NO_MEMORY = range(8)
STATES = ('missing', 'matching', 'conflict', 'unreadable')
RESULTS = ('ok', 'ready', 'no-op', 'conflict', 'io-error', 'invalid', 'timeout', 'no-psram')


class Refused(Exception):
    """A deliberately sanitized boundary error, containing no external input."""


def sources():
    """Authenticate all seventeen public files before USB or receipt mutations."""
    approved = []
    for name, size, digest, directory in ASSETS:
        base = ROOT / directory
        if base.resolve(strict=True) != ROOT.resolve(strict=True) / directory:
            raise Refused('Public source directory escaped its approved path')
        path = base / name
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(base.resolve(strict=True)):
            raise Refused('Public source escaped its approved directory')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != size or size > MAX_FILE:
                raise Refused('Public source size/type mismatch')
            data = source.read(size + 1)
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            raise Refused('Public source authentication failed')
        approved.append(data)
    return approved


def receipt_value():
    if not RECEIPT.is_file() or RECEIPT.is_symlink() or RECEIPT.stat().st_size > 512:
        raise Refused('Fresh bounded identity receipt required; run explicit preflight before flashing')
    value = private_json(RECEIPT)
    expected = {'schema', 'purpose', 'mac', 'port', 'flash_bytes', 'psram_bytes', 'issued_at'}
    if not isinstance(value, dict) or set(value) != expected:
        raise Refused('Identity receipt schema refused')
    issued = value['issued_at']
    if (value['schema'] != 1 or value['purpose'] != 'bitpos-motion-sd' or
            value['mac'] != MAC or value['port'] != PORT or
            value['flash_bytes'] != 16777216 or value['psram_bytes'] != 8388608 or
            type(issued) is not int or not -5 <= time.time() - issued <= MAX_RECEIPT_AGE):
        raise Refused('Identity receipt is stale or does not match the authorized board')
    return value


def preflight(tool):
    # provision.identity's esptool --after no_reset DOES still enter ROM. This
    # function can only be reached through BOTH explicit identity/reset flags.
    identity(tool)
    value = {'schema': 1, 'purpose': 'bitpos-motion-sd', 'mac': MAC, 'port': PORT,
             'flash_bytes': 16777216, 'psram_bytes': 8388608, 'issued_at': int(time.time())}
    parent = RECEIPT.parent
    if parent.is_symlink():
        raise Refused('Receipt directory cannot be a symlink')
    parent.mkdir(exist_ok=True)
    if RECEIPT.exists() or RECEIPT.is_symlink():
        if RECEIPT.is_symlink() or not RECEIPT.is_file() or RECEIPT.stat().st_size > 512:
            raise Refused('Unknown receipt destination refused')
        previous = private_json(RECEIPT)
        if not isinstance(previous, dict) or previous.get('purpose') != 'bitpos-motion-sd':
            raise Refused('Unknown receipt destination refused')
    payload = (json.dumps(value, sort_keys=True) + '\n').encode('ascii')
    if len(payload) > 512:
        raise Refused('Receipt exceeded bound')
    fd, temp = tempfile.mkstemp(prefix='.motion-sd-identity-', dir=parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, RECEIPT)
    finally:
        Path(temp).unlink(missing_ok=True)
    print(json.dumps({'identity_preflight': 'accepted', 'mac': MAC,
                      'receipt_valid_seconds': MAX_RECEIPT_AGE,
                      'reset_into_rom': True, 'next': 'parent app-only flash, then manual boot'}))


class Session(SerialPort):
    """POSIX serial I/O: never pyserial, modem ioctls, DTR/RTS, reset or flash."""
    def __init__(self):
        super().__init__()
        self.buffer = bytearray()
        self.nonce = None
        self.request = 0


    def send(self, data, until):
        offset = 0
        view = memoryview(data)
        while offset < len(data):
            remaining = until - time.monotonic()
            if remaining <= 0 or not select.select([], [self.fd], [], remaining)[1]:
                raise Refused('Serial send deadline exceeded; no automatic retry')
            try:
                count = os.write(self.fd, view[offset:offset + 4096])
            except BlockingIOError:
                continue
            if count <= 0:
                raise Refused('Serial disconnected; no automatic retry')
            offset += count

    def packet(self, until):
        discarded = 0
        while True:
            at = self.buffer.find(b'BPSD')
            if at < 0:
                discard = max(0, len(self.buffer) - 3)
                discarded += discard
                del self.buffer[:discard]
            elif at:
                discarded += at
                del self.buffer[:at]
            if discarded > 8192:
                raise Refused('Not the bounded maintenance protocol')
            if len(self.buffer) >= HEADER.size:
                fields = HEADER.unpack_from(self.buffer)
                magic, version, op, result, asset, request, nonce, length, digest = fields
                if (version != PROTOCOL or op not in (0x80, 0x81, 0x82) or result > NO_MEMORY or
                        length not in (0, 8 + len(ASSETS)) or digest != bytes(32) or nonce == bytes(16)):
                    raise Refused('Maintenance response header refused')
                if len(self.buffer) >= HEADER.size + length:
                    payload = bytes(self.buffer[HEADER.size:HEADER.size + length])
                    del self.buffer[:HEADER.size + length]
                    return op, result, asset, request, nonce, payload
            remaining = until - time.monotonic()
            if remaining <= 0 or not select.select([self.fd], [], [], remaining)[0]:
                raise Refused('Maintenance protocol deadline exceeded; no reset or retry')
            try:
                data = os.read(self.fd, 1024)
            except BlockingIOError:
                continue
            if not data:
                raise Refused('Serial disconnected; no reset or retry')
            self.buffer.extend(data)
            if len(self.buffer) > 2048:
                raise Refused('Maintenance receive bound exceeded')

    def report(self, payload):
        if (len(payload) != 8 + len(ASSETS) or payload[:6].hex(':') != MAC or
                payload[6] not in (0, 1) or payload[7] != len(ASSETS) or
                any(state > 3 for state in payload[8:])):
            raise Refused('Firmware MAC or public status refused')
        return {'mac': MAC, 'mounted': bool(payload[6]), 'files': [
            {'name': name, 'bytes': size, 'sha256': digest, 'status': STATES[state]}
            for (name, size, digest, _), state in zip(ASSETS, payload[8:])]}

    def boot(self):
        # Full initial report hashes17 files with separate bounded SD deadlines.
        until = time.monotonic() + 90
        while True:
            op, result, asset, request, nonce, payload = self.packet(until)
            if op == 0x80 and result == OK and asset == 255 and request == 0:
                status = self.report(payload)
                self.nonce = nonce
                return status

    def response(self, op, asset, request, until):
        while True:
            rop, result, rid, seq, nonce, payload = self.packet(until)
            if nonce != self.nonce:
                raise Refused('Firmware reboot/session timeout detected; reopen only after reconciliation')
            if rop == 0x80 and result == OK and rid == 255 and seq == 0:
                self.report(payload)
                continue
            if rop != op | 0x80 or rid != asset or seq != request:
                raise Refused('Maintenance response attribution refused')
            if op == STATUS:
                if result != OK:
                    raise Refused('Maintenance status refused')
                return result, self.report(payload)
            if payload:
                raise Refused('Unexpected write response payload')
            return result, None

    def command(self, op, asset=255, size=0, digest=bytes(32)):
        self.request += 1
        self.send(HEADER.pack(b'BPSD', PROTOCOL, op, 0, asset, self.request,
                              self.nonce, size, digest), time.monotonic() + 2)
        return self.request

    def status(self):
        request = self.command(STATUS)
        return self.response(STATUS, 255, request, time.monotonic() + 90)[1]

    def write(self, asset, data):
        name, size, digest, _ = ASSETS[asset]
        request = self.command(WRITE, asset, size, bytes.fromhex(digest))
        result, _ = self.response(WRITE, asset, request, time.monotonic() + 10)
        if result == READY:
            # Whole transfer fits the device's 30-second bound; no blind replay.
            self.send(data, time.monotonic() + 20)
            result, _ = self.response(WRITE, asset, request, time.monotonic() + 40)
        print(json.dumps({'name': name, 'bytes': size, 'sha256': digest, 'result': RESULTS[result]}), flush=True)
        if result not in (OK, NOOP):
            raise Refused('Allowlisted write refused or failed; reconcile status before retry')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--identity-preflight', action='store_true')
    action.add_argument('--status', action='store_true')
    action.add_argument('--write', action='store_true', help='Explicitly publish all seventeen approved files only')
    parser.add_argument('--allow-identity-reset', action='store_true', help='Only for preflight: authorize existing helper to enter ROM')
    parser.add_argument('--esptool', type=Path, help='Existing esptool.py path; only for preflight')
    args = parser.parse_args()
    if args.identity_preflight:
        if not args.allow_identity_reset or args.esptool is None:
            parser.error('Preflight requires --allow-identity-reset and --esptool')
    elif args.allow_identity_reset or args.esptool is not None:
        parser.error('Reset authorization/esptool are forbidden in status/write sessions')
    os.umask(0o077)
    data = sources()
    if args.identity_preflight:
        preflight(args.esptool)
        return
    receipt_value()
    with Session() as session:
        session.boot()
        status = session.status()
        if args.write:
            if not status['mounted'] or any(row['status'] not in ('missing', 'matching') for row in status['files']):
                print(json.dumps(status), flush=True)
                raise Refused('SD unavailable or an unknown destination exists; no files written')
            for asset, payload in enumerate(data):
                # Refuse if receipt expires during the bounded asset session.
                receipt_value()
                session.write(asset, payload)
            status = session.status()
            if not status['mounted'] or any(row['status'] != 'matching' for row in status['files']):
                print(json.dumps(status), flush=True)
                raise Refused('Post-write public hash status incomplete')
        print(json.dumps(status), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Refused as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Never emit tool output, file content, serial bytes or exception repr.
        print('SD maintenance refused/failed; external output withheld. No automatic reset/retry.', file=sys.stderr)
        sys.exit(1)
