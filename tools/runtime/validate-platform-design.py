#!/usr/bin/env python3
"""Validate proposed design artifact structure; not runtime implementation proof."""
import csv,hashlib,json,pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[2]
p=ROOT/'docs/plans/database-20261017/proposed-platform-v1.json'
spec=json.loads(p.read_text());issues=[];refs=[];ops=[]
def walk(v,path='$'):
 if isinstance(v,dict):
  if '$ref'in v:
   r=v['$ref'];refs.append(r)
   if not r.startswith('#/'):issues.append(path+': external ref '+r)
   else:
    target=spec
    try:
     for k in r[2:].split('/'):target=target[k.replace('~1','/').replace('~0','~')]
    except (KeyError,TypeError):issues.append(path+': unresolved '+r)
  if v.get('type')=='object' and v.get('additionalProperties') is not False:issues.append(path+': non-strict object')
  for k,x in v.items():walk(x,path+'/'+k)
 elif isinstance(v,list):
  for n,x in enumerate(v):walk(x,path+'/'+str(n))
walk(spec)
for path,item in spec['paths'].items():
 for method,op in item.items():
  if method not in ['get','post','put','patch','delete','head','options']:continue
  ops.append(op['operationId'])
  if op.get('x-implementation-status')!='proposed':issues.append(path+': route not proposed')
  names={x['name'] for x in item.get('parameters',[])+op.get('parameters',[]) if x.get('in')=='path'}
  if set(re.findall(r'{([^}]+)}',path))!=names:issues.append(path+': path parameters mismatch')
  for security in op.get('security',spec.get('security',[])):
   for name in security:
    if name not in spec['components']['securitySchemes']:issues.append(path+': undefined security '+name)
if len(set(ops))!=len(ops):issues.append('duplicate operationId')
legacy=json.loads((ROOT/'packages/openapi/mobile-v1.json').read_text())
for name,original in legacy['components']['schemas'].items():
 current=dict(spec['components']['schemas'][name]);current.pop('x-source-contract',None)
 if current!=original:issues.append('legacy schema changed '+name)
catalog=json.loads((p.parent/'proposed-schema.json').read_text())
tables={t['name'] for t in catalog['tables']}
for path,item in spec['paths'].items():
 for method,op in item.items():
  if method not in ['get','post','put','patch','delete','head','options']:continue
  for table in op.get('x-tables',[]):
   if table not in tables:issues.append(op['operationId']+': missing physical table '+table)
expected_ui=set()
for source in ['UI_RUNTIME_COVERAGE_20261017.csv','UI_SUPPLEMENTAL_COVERAGE_20261017.csv']:
 with (ROOT/'docs/plans'/source).open() as f:expected_ui.update(row['screen_id'] for row in csv.DictReader(f))
mapped_ui=[row['screenId'] for row in spec['x-ui-crosswalk']]
if set(mapped_ui)!=expected_ui or len(mapped_ui)!=len(expected_ui):issues.append('UI crosswalk IDs missing/duplicated/extra')
fingerprints=json.loads((p.parent/'contract-source-fingerprints.json').read_text())
if set(fingerprints)!=set(spec['x-input-artifacts']):issues.append('source fingerprint input set mismatch')
for name,digest in fingerprints.items():
 if hashlib.sha256((ROOT/name).read_bytes()).hexdigest()!=digest:issues.append('stale source fingerprint '+name)
receipt={'status':'FAIL'if issues else 'PASS_structural_only','operations':len(ops),'schemas':len(spec['components']['schemas']),'localRefs':len(refs),'issues':issues,'notVerified':['OpenAPI metaschema','runtime routes','authorization','state/financial invariants','provider readiness']}
out=ROOT/'.omp/work/flutter-delivery-20261016/evidence/platform-contract-structure-20261017.json';out.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2));raise SystemExit(bool(issues))
