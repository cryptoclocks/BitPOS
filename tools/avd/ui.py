#!/usr/bin/env python3
"""Tiny adb + uiautomator driver for the local Android emulator (emulator-5554).

Local test tooling only: it taps visible labels, fills text fields and swipes. Flutter exposes its semantics labels
to uiautomator, so `tap` matches the text or content description (whitespace collapsed, case-insensitive).
  ui.py texts | tap <label> | field <index> | type <text> | swipe-up
"""
import os, re, subprocess, sys, time, xml.etree.ElementTree as ET
ADB = os.environ.get('ADB', os.path.expanduser('~/Library/Android/sdk/platform-tools/adb'))
SERIAL = os.environ.get('ANDROID_SERIAL', 'emulator-5554')

def adb(*args):
    return subprocess.run([ADB, '-s', SERIAL, *args], capture_output=True, text=True, check=True).stdout

def dump():
    adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml')
    return ET.fromstring(adb('exec-out', 'cat', '/sdcard/ui.xml'))

def labelled(root):
    for node in root.iter('node'):
        label = ' '.join((node.get('text') or node.get('content-desc') or '').split())
        match = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds') or '')
        if label and match:
            x1, y1, x2, y2 = map(int, match.groups())
            yield label, ((x1 + x2) // 2, (y1 + y2) // 2)

def texts():
    return [label[:60] for label, _ in labelled(dump())]

def tap(text, wait=8):
    end = time.time() + wait
    while time.time() < end:
        for label, (x, y) in labelled(dump()):
            if text.lower() in label.lower():
                adb('shell', 'input', 'tap', str(x), str(y))
                return label
        time.sleep(0.7)
    raise SystemExit('NOT FOUND: %s | %s' % (text, ' / '.join(texts())))

def field(index=0):
    edits = [n for n in dump().iter('node') if n.get('class') == 'android.widget.EditText']
    x1, y1, x2, y2 = map(int, re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', edits[index].get('bounds')).groups())
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))

if __name__ == '__main__':
    command, args = sys.argv[1], sys.argv[2:]
    if command == 'texts': print(' | '.join(texts()))
    elif command == 'tap': print('tapped', tap(args[0]))
    elif command == 'field': field(int(args[0]) if args else 0)
    elif command == 'type': adb('shell', 'input', 'text', args[0].replace(' ', '%s'))
    elif command == 'swipe-up': adb('shell', 'input', 'swipe', '540', '1700', '540', '600', '400')
    else: raise SystemExit(__doc__)
