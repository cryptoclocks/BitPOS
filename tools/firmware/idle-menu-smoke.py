#!/usr/bin/env python3
"""Compile actual v2 catalog/cart/journal core. Host fixtures, never physical proof."""
import copy
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
firmware = ROOT / 'device/firmware/main'
cjson = ROOT / 'local/toolchains/esp-idf/components/json/cJSON'
row = {'productId': '30000000-0000-4000-8000-000000000001', 'catalogKey': 'cafe.espresso',
       'name': 'กาแฟ', 'nameEn': 'Host fixture coffee', 'category': 'Coffee', 'available': 2,
       'basePrice': {'currency': 'USD', 'decimals': 2, 'amountMinor': '270'},
       'unitPrice': {'currency': 'USD', 'decimals': 2, 'amountMinor': '270'},
       'promotion': None, 'assetId': 0}
catalog = {'menuVersion': 'a' * 64, 'priceVersion': 'fixture-price', 'currency': 'USD', 'decimals': 2,
           'generatedAt': '2026-10-08T00:00:00.000Z', 'validUntil': '2026-10-08T00:01:00.000Z',
           'assetManifestVersion': 'bitpos-menu-v1', 'pageIndex': 0, 'pageCount': 5,
           'productCount': 20, 'products': [row]}
cases = [('paged_more_than_twelve_products', catalog, True)]
text = copy.deepcopy(catalog); text['products'][0].update(assetId=None, catalogKey=None, category=None)
cases.append(('missing_photo_text_product_preserved', text, True))
empty = copy.deepcopy(catalog); empty.update(priceVersion=None, currency=None, decimals=None, products=[])
cases.append(('unconfigured_no_fabricated_price', empty, True))
for key, value in [('assetManifestVersion', 'arbitrary'), ('currency', 'THB'), ('decimals', 6),
                   ('validUntil', '2026-10-08T00:01:00.001Z'), ('generatedAt', '2026-02-30T00:00:00.000Z'),
                   ('products', [row] * 5), ('products', [row, row]), ('pageIndex', 5),
                   ('menuVersion', 'quote"injection')]:
    altered = copy.deepcopy(catalog); altered[key] = value; cases.append((key + '_refused', altered, False))
for key, value in [('assetId', 12), ('catalogKey', 'cafe.americano'), ('available', True),
                   ('nameEn', 'unsupported 🍵'), ('nameEn', 'x' * 96), ('category', '\n'),
                   ('unitPrice', {'currency': 'USD', 'decimals': 2, 'amountMinor': '0270'})]:
    altered = copy.deepcopy(catalog); altered['products'][0][key] = value
    cases.append((key + '_refused', altered, False))
percent = copy.deepcopy(catalog)
percent['products'][0].update(unitPrice={'currency': 'USD', 'decimals': 2, 'amountMinor': '230'},
    promotion={'priceVersion': 'fixture-price', 'revision': '1', 'expiresAt': catalog['validUntil'],
               'discount': {'kind': 'percent', 'percent': 15}})
cases.append(('canonical_floor_reduction_270_to230_fixture_not_config', percent, True))
for key, value in [('priceVersion', 'other'), ('expiresAt', '2026-10-08T00:00:59.999Z')]:
    altered = copy.deepcopy(percent); altered['products'][0]['promotion'][key] = value
    cases.append(('promotion_' + key + '_refused', altered, False))
main = r'''
#include <stdio.h>
#include <string.h>
#include "bitpos_table.h"
int main(void){char line[10000];while(fgets(line,sizeof(line),stdin)){
 table_state_t s={0};strcpy(s.price,"fixture-price");
 cJSON *j=table_json_bounded(line,strlen(line))?cJSON_ParseWithOpts(line,NULL,true):NULL;
 bool ok=j&&table_catalog(&s,j);cJSON_Delete(j);puts(ok?"accepted":"rejected");}return 0;}
'''
with tempfile.TemporaryDirectory(prefix='bitpos-table-core-') as directory:
    temp = Path(directory); (temp / 'catalog.c').write_text(main)
    common = ['cc', '-std=c11', '-Wall', '-Wextra', '-fsanitize=address,undefined',
              '-I' + str(cjson), '-I' + str(firmware)]
    subprocess.run(common + ['-c', str(cjson / 'cJSON.c'), '-o', str(temp / 'cJSON.o')], check=True)
    for name, source in [('catalog', temp / 'catalog.c'), ('core', ROOT / 'tools/firmware/table-core-smoke.c')]:
        subprocess.run(common + ['-Werror', str(source), str(firmware / 'bitpos_table.c'),
                                str(temp / 'cJSON.o'), '-lm', '-o', str(temp / name)], check=True)
    environment = {**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0'}
    result = subprocess.run([str(temp / 'catalog')], input='\n'.join(json.dumps(v, ensure_ascii=False) for _, v, _ in cases) + '\n',
                            text=True, capture_output=True, check=True, env=environment)
    actual = result.stdout.splitlines(); assert len(actual) == len(cases)
    for (name, _, expected), observed in zip(cases, actual):
        assert observed == ('accepted' if expected else 'rejected'), (name, observed)
    core = subprocess.run([str(temp / 'core')], text=True, capture_output=True, check=True, env=environment)
proof = {'origin': 'compiled_actual_v2_table_core_host_fixtures', 'physical_claim': False,
         'catalog_cases': [{'name': name, 'result': observed} for (name, _, _), observed in zip(cases, actual)],
         'core_checks': core.stdout.strip().splitlines(), 'sanitizers': ['ASan', 'UBSan']}
(ROOT / '.omp/work/evidence/table-core-smoke.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
