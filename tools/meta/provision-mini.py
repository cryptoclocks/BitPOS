#!/usr/bin/env python3
# Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
"""Sends the one-line Meta setup to a BitPOS Mini running bitpos_terminal_meta over USB.

The device key is read from stdin (so it never appears in the command line, shell history or logs), e.g.:
  ssh <oci> 'docker exec -w /app/meta-src bitpos-meta-meta-1 node --import tsx tools/meta/device-key.ts /run/meta/meta.env <device>' \
    | python3 tools/meta/provision-mini.py /dev/cu.usbmodem101 https://meta-pay.cashlessthailand.com <device>
Prints only the device's reply (META_PROVISION ok/failed), never the key."""
import re, sys, time
import serial  # pyserial (ESP-IDF python env)

port, origin, device = sys.argv[1:4]
key = sys.stdin.readline().strip()
if not re.fullmatch(r'https://[a-z0-9.-]+', origin) or not re.fullmatch(r'[0-9a-f-]{36}', device) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', key):
    sys.exit('invalid origin, device or key')
s = serial.Serial(port, 115200, timeout=0.5); s.dtr = False; s.rts = False
time.sleep(4)  # opening the USB port may restart the board; let it boot
s.reset_input_buffer(); s.write(b'META_STATUS\n'); time.sleep(1)
print(next((l for l in s.read(4096).decode('utf-8', 'replace').splitlines() if l.startswith('META_STATUS')), 'no status reply'))
s.write(f'META_PROVISION {origin} {device} {key}\n'.encode()); key = ''
deadline = time.time() + 5; out = ''
while time.time() < deadline and 'META_PROVISION' not in out: out += s.read(512).decode('utf-8', 'replace')
print(next((l for l in out.splitlines() if l.startswith('META_PROVISION')), 'no provision reply'))
s.close()
