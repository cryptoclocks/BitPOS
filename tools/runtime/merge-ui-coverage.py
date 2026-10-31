#!/usr/bin/env python3
"""Merge independent source-only inventories without treating intended routes as wired."""
import csv, io, re, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/plans/UI_RUNTIME_COVERAGE_20261017.csv'
WORK=ROOT/'.omp/work/flutter-delivery-20261016/evidence'
flutter=(WORK/'ui-source-inventory-flutter.txt').read_text()
web=(WORK/'ui-source-inventory-web.txt').read_text()
paths={'C':'apps/mobile-customer/lib/main.dart','F':'apps/mobile-customer/lib/food_page.dart','A':'apps/mobile-customer/lib/account_page.dart','O':'apps/mobile-customer/lib/product_options_sheet.dart','H':'apps/mobile-customer/lib/order_history_sheet.dart','Q':'apps/mobile-customer/lib/order_refunds_sheet.dart','R':'apps/mobile-driver/lib/main.dart','M':'packages/mobile_shared/lib/mobile_api.dart','B':'docs/plans/PLATFORM_DATABASE_BLUEPRINT_20261017.md'}
webpaths={'POS':'apps/web/src/components/Pos.tsx:29-46;240-257','INC':'apps/web/src/components/IncomingOrders.tsx:18-100','PAY':'apps/web/src/components/Payment.tsx:85-228','TABLE':'apps/web/src/components/TableMenu.tsx:64-146','MENU':'apps/web/src/components/PayMenu.tsx:12-24','BILL':'apps/web/src/components/OrderBill.tsx:7-16','CRM':'apps/web/src/components/Customers.tsx:11-29','CONSENT':'apps/web/src/components/CustomerConsent.tsx:11-58','PROMO':'apps/web/src/components/Promotions.tsx:85-118;192-206','PROXY':'apps/web/src/pages/api/[...path].ts:3-52','CSS':'apps/web/src/styles/app.css:1-21;apps/web/src/styles/pos-workspace.css:1-21','CHECKOUTCSS':'apps/web/src/styles/customer-checkout.css:1-2;70','TABLECSS':'apps/web/src/styles/table-menu.css:1-12','HANDOFF':'design/figcraft/handoff/IMPLEMENTATION.md:1-55','GUIDE':'team-guide/README.md:5-40','DESIGN':'design/figcraft/handoff/screen-map.json','DB':'docs/plans/PLATFORM_DATABASE_BLUEPRINT_20261017.md'}
def expand(value,mapping):
    return re.sub(r'\b('+ '|'.join(sorted(mapping,key=len,reverse=True))+r')\b',lambda m:mapping[m[0]],value)
mapped={}
for report,expected,is_flutter in [(flutter,7,True),(web,8,False)]:
    for line in report.splitlines():
        if not re.match(r'^[A-Z]+\d\d,',line):continue
        cells=next(csv.reader([line]))
        # Original reports omit the state cell for these two explicitly missing screens.
        if not is_flutter and len(cells)==7 and cells[0] in ('W13','W22'):
            cells.insert(3,{'W13':'proposed pickup-ready projection','W22':'proposed coupon selector'}[cells[0]])
        if len(cells)!=expected:raise ValueError(f'{cells[0]}: expected {expected} fields; got {len(cells)}; fix source report explicitly')
        if is_flutter:
            sid,route,component,api,domain,status,evidence=cells
        else:sid,route,component,state,api,domain,status,evidence=cells
        if sid in mapped:raise ValueError('Duplicate '+sid)
        if is_flutter:
            component=expand(component,paths)
            route='intended:'+route+'; actual:anonymous/inline state' if status!='missing' else 'proposed:'+route
            evidence=expand(evidence,paths)+'; .omp/work/flutter-delivery-20261016/evidence/ui-source-inventory-flutter.txt'
        else:
            evidence=expand(evidence,webpaths)+'; design/figcraft/handoff/screen-map.json#'+sid
            component=component+' [state: '+state+']'
        mapped[sid]=dict(runtime_route=route,component=component,api_contract=api,database_domain=domain,runtime_status=status,evidence=evidence)
rows=list(csv.DictReader(BASE.open()));ids=[r['screen_id'] for r in rows]
if len(rows)!=192 or len(set(ids))!=192:raise ValueError('Master must retain192 unique IDs')
if set(ids)!=set(mapped):raise ValueError({'missing':sorted(set(ids)-set(mapped)),'extra':sorted(set(mapped)-set(ids))})
for row in rows:row.update(mapped[row['screen_id']])
buf=io.StringIO();writer=csv.DictWriter(buf,fieldnames=rows[0].keys(),lineterminator='\n');writer.writeheader();writer.writerows(rows);BASE.write_text(buf.getvalue())
counts={}
for row in rows:counts[row['runtime_status']]=counts.get(row['runtime_status'],0)+1
receipt={'masterRows':len(rows),'uniqueIds':len(set(ids)),'blankRequiredFields':sum(not r[k] for r in rows for k in ('runtime_route','component','api_contract','database_domain','runtime_status','evidence')),'statusCounts':counts,'verification':'source inventory only; no runtime/visual acceptance inferred; intended routes explicitly labelled','physicalTesting':'deferred_by_user_2026-10-16'}
(WORK/'ui-source-coverage-20261017.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
