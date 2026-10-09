#!/usr/bin/env python3
"""Coordinator-only NVS provisioning. Never writes application/bootloader/partition table."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile

PORT = '/dev/cu.usbmodem101'
MAC = '14:c1:9f:4e:62:48'
BACKUP_HASH = '1479cd385c2c8af87c2c1aed410bfd7e7c3fb8591e2ae08ddc213fb7cedb8fbf'
OFFSET, SIZE = 0xff0000, 0x10000


def run(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=1200)
    if result.returncode:
        raise RuntimeError('Tool failed; output withheld to protect provisioning material')
    return result.stdout


def private_json(path):
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise RuntimeError('Private input must be a regular permissions-600 file')
    return json.loads(path.read_text())


def identity(tool):
    base = [sys.executable, str(tool), '--chip', 'esp32s3', '--port', PORT, '--baud', '921600', '--connect-attempts', '3', '--after', 'no_reset']
    output = run(base + ['read_mac']).decode(errors='replace').lower()
    if MAC not in output or 'esp32-s3' not in output or 'embedded psram 8mb' not in output:
        raise RuntimeError('Device identity or PSRAM mismatch')
    output = run(base + ['flash_id']).decode(errors='replace')
    if not re.search(r'Detected flash size:\s*16\s*MB', output, re.I):
        raise RuntimeError('Flash size mismatch')
    return base


def partition_entries(raw):
    entries = []
    for pos in range(0, 0xc00, 32):
        row = raw[pos:pos + 32]
        if len(row) != 32:
            raise RuntimeError('Incomplete partition table')
        magic = struct.unpack_from('<H', row)[0]
        if magic == 0xffff or magic == 0xebeb:
            break
        if magic != 0x50aa:
            raise RuntimeError('Invalid partition table')
        _, kind, subtype, offset, size, name, flags = struct.unpack('<HBBII16sI', row)
        entries.append((name.rstrip(b'\0').decode('ascii'), kind, subtype, offset, size))
    return entries


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--idf', type=Path, required=True)
    p.add_argument('--esptool', type=Path, required=True)
    p.add_argument('--nvs-python', type=Path,
                   default=Path('local/toolchains/idf-tools/python_env/idf5.5_py3.9_env/bin/python'),
                   help='SDK Python environment containing esp_idf_nvs_partition_gen')
    p.add_argument('--wifi', type=Path, default=Path('local/private/wifi.json'))
    p.add_argument('--device-config', type=Path, required=True,
                   help='Private JSON: ws_url (wss endpoint including token), merchant, terminal')
    p.add_argument('--backup', type=Path, default=Path('local/private/device-original.bin'))
    p.add_argument('--write', action='store_true', help='Coordinator explicitly authorizes own partition write')
    args = p.parse_args()
    os.umask(0o077)
    if args.backup.is_symlink() or args.backup.stat().st_mode & 0o077:
        raise RuntimeError('Backup permissions must remain private')
    backup = args.backup.read_bytes()
    if len(backup) != 16 * 1024 * 1024 or hashlib.sha256(backup).hexdigest() != BACKUP_HASH:
        raise RuntimeError('Recoverable original backup mismatch')
    original = partition_entries(backup[0x8000:0x9000])
    overlaps = [(name, kind, subtype, offset, size) for name, kind, subtype, offset, size in original
                if offset < OFFSET + SIZE and offset + size > OFFSET]
    # The verified original layout reserves this exact erased region for coredump.
    # Conversion to owned BitPOS NVS is recoverable from the full private backup.
    if overlaps != [('coredump', 1, 3, OFFSET, SIZE)]:
        raise RuntimeError('Unexpected original ownership/layout at BitPOS NVS region')
    if backup[OFFSET:OFFSET + SIZE] != b'\xff' * SIZE:
        raise RuntimeError('Original reserved region is not erased; refusing to overwrite unknown data')
    wifi, device = private_json(args.wifi), private_json(args.device_config)
    from urllib.parse import urlparse, parse_qs
    parsed = urlparse(device['ws_url'])
    query = parse_qs(parsed.query)
    secure = parsed.scheme == 'wss' or (parsed.scheme == 'ws' and parsed.hostname == '192.168.1.34' and parsed.port == 3001)
    if not secure or not parsed.hostname or parsed.path != '/api/device' or not query.get('token') or query.get('terminalId') != [device['terminal']]:
        raise RuntimeError('Invalid authenticated device endpoint')
    values = {'ssid': wifi['ssid'], 'password': wifi['password'], 'ws_url': device['ws_url'],
              'merchant': device['merchant'], 'terminal': device['terminal']}
    limits = {'ssid': 32, 'password': 64, 'ws_url': 767, 'merchant': 95, 'terminal': 95}
    for key, value in values.items():
        if not isinstance(value, str) or not value or len(value.encode()) > limits[key] or '\0' in value:
            raise RuntimeError('Invalid private provisioning field')
    if not args.write:
        print('Private inputs and recovery layout accepted. No USB access or writes performed.')
        return
    with tempfile.TemporaryDirectory(prefix='bitpos-provision-') as directory:
        temp = Path(directory)
        base = identity(args.esptool)
        table = temp / 'table.bin'
        run(base + ['read_flash', '0x8000', '0x1000', str(table)])
        active = partition_entries(table.read_bytes())
        if ('bitpos_nvs', 1, 2, OFFSET, SIZE) not in active:
            raise RuntimeError('Active device lacks exact BitPOS-owned partition; no partition table changes are performed by this helper')
        if any(name != 'bitpos_nvs' and offset < OFFSET + SIZE and offset + size > OFFSET for name, _, _, offset, size in active):
            raise RuntimeError('Active partition overlap')
        previous = temp / 'previous.bin'
        run(base + ['read_flash', hex(OFFSET), hex(SIZE), str(previous)])
        if previous.read_bytes() != b'\xff' * SIZE:
            raise RuntimeError('Own NVS already contains state; refusing reprovisioning that would erase paid-order dedup')
        source, binary = temp / 'nvs.csv', temp / 'nvs.bin'
        with source.open('w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['key', 'type', 'encoding', 'value'])
            writer.writerow(['config', 'namespace', '', ''])
            for key, value in values.items():
                writer.writerow([key, 'data', 'string', value])
        generator = args.idf / 'components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py'
        run([str(args.nvs_python), str(generator), 'generate', str(source), str(binary), hex(SIZE)])
        # Recheck immediately before the only USB write. esptool erases only this range.
        base = identity(args.esptool)
        run(base + ['write_flash', hex(OFFSET), str(binary)])
        readback = temp / 'readback.bin'
        run(base + ['read_flash', hex(OFFSET), hex(SIZE), str(readback)])
        if readback.read_bytes() != binary.read_bytes():
            raise RuntimeError('Own partition readback mismatch')
        print('BitPOS private NVS provisioned and byte-verified; no credential output.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Provisioning refused or failed. No tool output or private values disclosed.', file=sys.stderr)
        sys.exit(1)
