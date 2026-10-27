#!/usr/bin/env python3
"""Compile actual v2 envelope/order adapters with pinned SDK cJSON; no ESP claims."""
import copy
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'device/firmware/main/main.c').read_text()
start = source.index('static bool text(')
end = source.index('static lv_obj_t *label(', start)
structure = source[source.index('typedef struct {\n    char event'):source.index('static order_t current;')]
defines = source[source.index('#define MESSAGE_MAX'):source.index('static QueueHandle_t inbox;')]
device = '10000000-0000-4000-8000-000000000001'
order = '20000000-0000-4000-8000-000000000001'
quote = '30000000-0000-4000-8000-000000000001'
settlement = {'currency': 'USDG', 'decimals': 6, 'amountMinor': '2700000', 'network': 'solana:devnet',
              'genesisHash': 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
              'mint': '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7',
              'tokenProgram': 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'testToken': True}
payload = {'id': order, 'status': 'PAID', 'version': 1,
           'authority': {'kind': 'versioned', 'target': {'deviceId': device, 'assignmentGeneration': '1'},
                         'serving': {'kind': 'table', 'label': 'Host fixture table'}},
           'total': {'currency': 'USD', 'decimals': 2, 'amountMinor': '270'}, 'settlement': settlement,
           'quoteExpiresAt': '2026-10-08T00:05:00.000Z',
           'paymentUrl': 'https://example.invalid/pay/explicit-host-fixture', 'items': ['1 x Host fixture coffee'],
           'quoteId': quote, 'lineCount': 1, 'pageCount': 1, 'canDismiss': False, 'sound': True, 'effectId': order}
event = {'schemaVersion': 2, 'type': 'ORDER', 'deviceId': device, 'eventId': quote,
         'deviceSeq': '7', 'connectionGeneration': '4294967297', 'screenGeneration': '2',
         'occurredAt': '2026-10-08T00:00:00.000Z', 'payload': payload}
cases = [('authenticated_USD2_order', event, True)]
usdc = copy.deepcopy(event)
usdc['payload']['settlement'].update(currency='USDC',
    mint='4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    tokenProgram='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    denominationPolicy={'id': 'host-usdc-exact', 'numerator': '10000', 'denominator': '1'})
cases.append(('canonical_USDC_exact_settlement', usdc, True))
fraction = copy.deepcopy(usdc)
fraction['payload']['settlement'].update(amountMinor='135', denominationPolicy={'id':'host-exact-half','numerator':'1','denominator':'2'})
cases.append(('exact_divisible_rational_settlement', fraction, True))
remainder = copy.deepcopy(fraction); remainder['payload']['total']['amountMinor'] = '271'
cases.append(('nondivisible_rational_settlement_refused', remainder, False))
overflow = copy.deepcopy(usdc)
overflow['payload']['settlement']['denominationPolicy']['numerator'] = '18446744073709551615'
cases.append(('rational_multiply_overflow_refused', overflow, False))
missing_policy = copy.deepcopy(usdc); del missing_policy['payload']['settlement']['denominationPolicy']
cases.append(('new_asset_missing_policy_refused', missing_policy, False))
wrong_usdc = copy.deepcopy(usdc); wrong_usdc['payload']['settlement']['mint'] = settlement['mint']
cases.append(('USDC_symbol_wrong_mint_refused', wrong_usdc, False))
usdt = copy.deepcopy(usdc)
usdt['payload']['settlement'].update(currency='USDT',assetId='usdt-test-devnet',
    displayLabel='USDT test (BitPOS-issued)',mint='DUZiyxqqJwpVN8UCT3p6jtYeGwnMNije4DcrE2vcvJjr')
cases.append(('canonical_BitPOS_USDT_test_settlement',usdt,True))
issuer_label = copy.deepcopy(usdt);issuer_label['payload']['settlement']['displayLabel']='Tether USDT'
cases.append(('false_USDT_issuer_label_refused',issuer_label,False))
foreign_test = copy.deepcopy(usdt);foreign_test['payload']['settlement']['mint']=usdc['payload']['settlement']['mint']
cases.append(('USDT_test_wrong_mint_refused',foreign_test,False))
for policy_id in ('a' * 64, 'ก' * 21 + 'a', 'a' * 65, 'ก' * 96):
    bounded = copy.deepcopy(usdc)
    bounded['payload']['settlement']['denominationPolicy']['id'] = policy_id
    cases.append((f'new_or_already_frozen_policy_{len(policy_id.encode())}_UTF8_bytes', bounded, True))
too_long = copy.deepcopy(usdc)
too_long['payload']['settlement']['denominationPolicy']['id'] = 'a' * 385
cases.append(('policy_beyond_historical_capacity_refused',too_long,False))
for field, value in [('schemaVersion', 1), ('deviceId', order), ('deviceSeq', '6'), ('deviceSeq', 7),
                     ('connectionGeneration', '1'), ('screenGeneration', '1'), ('type', 'UNAUTHENTICATED')]:
    altered = copy.deepcopy(event); altered[field] = value; cases.append((field + '_refused', altered, False))
for field, value in [('version', -1), ('version', 1.5), ('version', 4294967296), ('status', 'CLIENT_PAID'),
                     ('paymentUrl', 'https://other.invalid/pay/fixture'),
                     ('paymentUrl', 'https://example.invalid/pay/fixture?target=foreign'),
                     ('paymentUrl', 'javascript:paid()'), ('items', ['x'] * 7), ('items', ['x' * 96]),
                     ('lineCount', 51), ('pageCount', 2), ('sound', 'true')]:
    altered = copy.deepcopy(event); altered['payload'][field] = value; cases.append((field + '_refused', altered, False))
for field, value in [('amountMinor', '2.70'), ('amountMinor', '-1'), ('amountMinor', '9' * 19), ('currency', 'THB'), ('decimals', 6)]:
    altered = copy.deepcopy(event); altered['payload']['total'][field] = value
    cases.append(('total_' + field + '_refused', altered, False))
wrong_target = copy.deepcopy(event); wrong_target['payload']['authority']['target']['deviceId'] = order
cases.append(('immutable_target_mismatch', wrong_target, False))
for field, value in [('mint', 'wrong'), ('network', 'solana:mainnet'), ('testToken', False), ('tokenProgram', 'wrong')]:
    altered = copy.deepcopy(event); altered['payload']['settlement'][field] = value
    cases.append(('settlement_' + field + '_refused', altered, False))
legacy = copy.deepcopy(event); legacy['payload']['authority'] = {'kind': 'legacy', 'target': {'legacyTerminalId': 'terminal-fixture'}, 'serving': {'label': 'Legacy counter'}}
legacy['payload']['total'] = {'currency': 'THB', 'decimals': 2, 'amountMinor': '9500'}; legacy['payload']['quoteId'] = None
cases.append(('explicit_legacy_THB_presentation_only', legacy, True))
for count in (12, 50):
    large = copy.deepcopy(event); large['payload'].update(lineCount=count, pageCount=(count + 3) // 4,
        items=['1 x Host fixture coffee'] * 5 + [f'+ {count - 5} more items'])
    cases.append((f'bounded_summary_full{count}_reachable_by_quote_pages', large, True))
snapshot = copy.deepcopy(event); snapshot.update(type='SNAPSHOT', payload={'screen': {'kind': 'order', 'screenGeneration': '2', 'order': copy.deepcopy(payload)}})
cases.append(('snapshot_forces_sound_false', snapshot, True))
pickup = copy.deepcopy(event)
pickup.update(type='PICKUP_READY', assignmentGeneration='1', payload={
    'notificationId': quote, 'orderId': order, 'pickupCode': 'A012',
    'expiresAt': '2026-10-12T12:01:00.000Z', 'effectId': 'pickup:' + quote,
    'sound': True, 'state': 'READY'})
cases.append(('bounded_pickup_ready', pickup, True))
canceled = copy.deepcopy(pickup); canceled['payload']['state'] = 'CANCELED'
cases.append(('bounded_pickup_cancel', canceled, True))
for field, value in [('notificationId', 'not-a-uuid'), ('orderId', 'not-a-uuid'),
                     ('pickupCode', ''), ('pickupCode', 'A' * 17), ('pickupCode', '<script>'),
                     ('effectId', ''), ('effectId', 'x' * 96), ('effectId', 'x\n'),
                     ('expiresAt', '2026-02-30T00:00:00.000Z'), ('sound', 'true'), ('state', 'COLLECTED')]:
    altered = copy.deepcopy(pickup); altered['payload'][field] = value
    cases.append(('pickup_' + field + '_refused', altered, False))
for field, value in [('screenGeneration', '3'), ('assignmentGeneration', '2'),
                     ('connectionGeneration', '1'), ('deviceId', order)]:
    altered = copy.deepcopy(pickup); altered[field] = value
    cases.append(('pickup_' + field + '_fence_refused', altered, False))
header = '''#include <stdbool.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <string.h>\n#include <math.h>\n#include <ctype.h>\n#include <inttypes.h>\n#include "bitpos_table.h"\n'''
header += defines + f'static table_state_t table;\nstatic char terminal[ID_MAX]="terminal-fixture";\n'
main = f'''int main(void){{char line[10000];while(fgets(line,sizeof(line),stdin)){{
 memset(&table,0,sizeof(table));strcpy(table.device,"{device}");strcpy(table.payment_origin,"https://example.invalid");
 table.connection=4294967297ULL;table.configured=true;table.screen=2;table.seq=7;table.assignment=1;
 order_t order={{0}};pickup_t pickup={{0}};bool event=false;cJSON *j=table_json_bounded(line,strlen(line))?cJSON_ParseWithOpts(line,NULL,true):NULL;
 bool ok=j&&table_envelope(&table,j,table.device,&event)&&event;
 if(ok)ok=!strcmp(cJSON_GetObjectItemCaseSensitive(j,"type")->valuestring,"PICKUP_READY")?parse_pickup(j,&pickup):parse(j,&order);
 if(ok&&order.snapshot&&order.sound)return 2;cJSON_Delete(j);puts(ok?"accepted":"rejected");}}return 0;}}\n'''
with tempfile.TemporaryDirectory(prefix='bitpos-v2-parser-') as directory:
    temp = Path(directory); (temp / 'smoke.c').write_text(header + structure + source[start:end] + main)
    cjson = ROOT / 'local/toolchains/esp-idf/components/json/cJSON'
    firmware = ROOT / 'device/firmware/main'
    common = ['cc', '-std=c11', '-Wall', '-Wextra', '-fsanitize=address,undefined', '-I' + str(cjson), '-I' + str(firmware)]
    subprocess.run(common + ['-c', str(cjson / 'cJSON.c'), '-o', str(temp / 'cJSON.o')], check=True)
    subprocess.run(common + ['-Werror', str(temp / 'smoke.c'), str(firmware / 'bitpos_table.c'), str(temp / 'cJSON.o'), '-lm', '-o', str(temp / 'smoke')], check=True)
    result = subprocess.run([str(temp / 'smoke')], input='\n'.join(json.dumps(value) for _, value, _ in cases) + '\n',
        text=True, capture_output=True, check=True, env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0'})
    actual = result.stdout.splitlines(); assert len(actual) == len(cases)
    for (name, _, expected), observed in zip(cases, actual):
        assert observed == ('accepted' if expected else 'rejected'), (name, observed)
proof = {'origin': 'compiled_actual_v2_firmware_order_parser_host', 'physical_render_claim': False,
         'cases': [{'name': name, 'result': observed} for (name, _, _), observed in zip(cases, actual)]}
(ROOT / '.omp/work/evidence/firmware-parser-smoke.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps({'cases': len(cases), 'passed': len(cases), 'physical_render_claim': False}))
subprocess.run(['python3', str(ROOT / 'tools/firmware/idle-menu-smoke.py')], check=True)
