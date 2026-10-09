#!/usr/bin/env python3
"""Capture public BitPOS physical-render evidence only; never expose raw serial logs."""
import argparse, re, time
from pathlib import Path
from serial_port import SerialPort, PORT
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,default=Path('.omp/work/evidence/physical-serial.log'))
p.add_argument('--seconds',type=int,default=3600)
p.add_argument('--reset',action='store_true')
p.add_argument('--until-status',choices=('AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING','PAID','EXPIRED','RECOVERY'),help='Close the exclusive logger after one observed physical render ACK, so a separate read-only frame capture can follow')
a=p.parse_args()
if not a.output.resolve().is_relative_to(Path('.omp/work/evidence').resolve()):raise SystemExit('Evidence output must remain in sanitized evidence directory')
a.output.parent.mkdir(parents=True,exist_ok=True)
# Reset/boot is an explicit separate operation. Default logging never invokes
# pyserial's automatic control-line setup, which reset the first frame capture.
if a.reset:
 import serial
 with serial.Serial(PORT,115200,timeout=1) as boot:
  boot.dtr=False;boot.rts=True;time.sleep(.1);boot.rts=False
with SerialPort() as port,a.output.open('a') as output:
 print('Physical serial capture active; raw serial output suppressed',flush=True)
 deadline=time.monotonic()+a.seconds
 while time.monotonic()<deadline:
  raw=port.readline().decode('utf8',errors='replace')
  public=re.search(r'(BOOT product=bitpos_terminal version=[\w.]+ mac=[0-9a-f:]+|BITPOS_RENDER_ACK event=[\w-]+ order=[\w-]* version=\d+ status=[A-Z_]+(?: flush_ms=\d+)?|BITPOS_PAID_TIMING event=[\w-]+ order=[\w-]+ version=\d+ queue_wait_ms=\d+ lock_wait_ms=\d+ flush_ms=\d+ ws_to_ack_ms=\d+|BITPOS_MEDIA cached bytes=\d+ psram_free=\d+ psram_largest=\d+ decoder_reserve=\d+|BITPOS_MEDIA native reason=[a-z_]+|BITPOS_SOUND order=[\w-]+ version=\d+ bytes=\d+(?: cue=(?:wav|native))?|BITPOS_SOUND_SUPPRESSED order=[\w-]+ reason=dedup|BITPOS_TOUCH page=\d+|BITPOS_OFFLINE_RENDER flush_ms=\d+)',raw)
  if not public:
   public=re.search(r'(BITPOS_MENU open=[01]|BITPOS_PROBE (?:(?:observer|reader)=ready|capture=ready bytes=\d+|unavailable=(?:snapshot_lock|frame_view|psram|driver_preflight|driver_install|init_lock|allocator|task_creation)))',raw)
  if not public:
   public=re.search(r'(BITPOS_MEDIA transparent_canvas pixels=\d+)',raw)
  if not public:
   public=re.search(r'(BITPOS_PHOTOS cached bytes=\d+ reserve=\d+ psram_free=\d+|BITPOS_PHOTOS home reason=validation_or_reserve)',raw)
  if not public:
   public=re.search(r'(BITPOS_MEMORY internal_free=\d+ internal_largest=\d+ inbox_psram_bytes=\d+)',raw)
  if not public:
   public=re.search(r'(BITPOS_ATTRACT_SOUND bytes=\d+)',raw)
  if public:
   line=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())+' '+public.group(0)
   output.write(line+'\n');output.flush();print(line,flush=True)
   if a.until_status and 'BITPOS_RENDER_ACK' in public.group(0) and f'status={a.until_status}' in public.group(0):break
  elif 'Guru Meditation' in raw or 'ESP_ERROR_CHECK failed' in raw or 'abort() was called' in raw:
   output.write('DEVICE_RUNTIME_FAILURE (raw diagnostic withheld)\n');output.flush();print('DEVICE_RUNTIME_FAILURE (raw diagnostic withheld)',flush=True)
