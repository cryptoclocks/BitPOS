#!/usr/bin/env python3
"""Read-only serial panic classifier. Never export raw UART bytes or configuration."""
import json,re,time
from pathlib import Path
from serial_port import SerialPort
result={'origin':'physical_esp32_readonly_panic_diagnostic','raw_serial_exported':False,'panics':[],'backtraces':[],'assertions':[]}
with SerialPort() as port:
 deadline=time.monotonic()+8
 while time.monotonic()<deadline:
  line=port.readline().decode('utf8',errors='replace')
  panic=re.search(r'Guru Meditation Error: Core\s+(\d+)\s+panic\s*\(([A-Za-z0-9 _-]+)\)',line)
  if panic:result['panics'].append({'core':int(panic[1]),'reason':panic[2]})
  trace=re.search(r'Backtrace:\s*((?:0x[0-9a-fA-F]+:0x[0-9a-fA-F]+\s*)+)',line)
  if trace:result['backtraces'].append(trace[1].strip())
  assertion=re.search(r'assert failed:\s*([A-Za-z0-9_]+)\s+([A-Za-z0-9_./-]+):([0-9]+)',line)
  if assertion:result['assertions'].append({'function':assertion[1],'file':assertion[2],'line':int(assertion[3])})
  overflow=re.search(r'A stack overflow in task\s+([A-Za-z0-9_-]+)',line)
  if overflow:result['panics'].append({'reason':'stack_overflow','task':overflow[1]})
  check=re.search(r'ESP_ERROR_CHECK failed: esp_err_t\s+(0x[0-9a-fA-F]+)',line)
  if check:result['panics'].append({'reason':'esp_error_check','code':check[1]})
for key in ['panics','backtraces','assertions']:
 result[key]=list({json.dumps(value,sort_keys=True):value for value in result[key]}.values())
Path('.omp/work/evidence/physical-table-v030-panic.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
