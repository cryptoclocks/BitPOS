#!/usr/bin/env python3
"""Read-only native FigCraft -> bounded, versioned layout IR. Never emits app logic."""
import argparse,collections,hashlib,json,math
from pathlib import Path
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[2]
MASTER=ROOT/'design/figcraft/BitPOS-Platform-UI.figcraft'
IDENTITY=[1,0,0,1,0,0]
def compose(a,b):
 return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
def bounds(matrix,w,h):
 points=[(matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]) for x,y in [(0,0),(w,0),(w,h),(0,h)]]
 xs,ys=zip(*points);return [round(min(xs),4),round(min(ys),4),round(max(xs)-min(xs),4),round(max(ys)-min(ys),4)]
def validate_variables(variables):
 byid={v['id']:v for v in variables}
 def visit(key,path):
  if key in path:raise ValueError('Variable alias cycle: '+' -> '.join([*path,key]))
  if key not in byid:raise ValueError('Missing variable binding: '+key)
  for val in byid[key].get('values',{}).values():
   if val.get('type')=='alias':visit(val['value'],[*path,key])
 for key in byid:visit(key,[])
 return byid
SUPPORTED={'frame','group','rectangle','text','line','instance','component','componentSet','ellipse','vector','boolean','star','polygon'}
# Vector/mask/instance paint cannot be reconstructed by generic Flutter positioning.
MANUAL={'vector','boolean','instance','component','componentSet'}
def extract(doc,screen,sha,tokens):
 nodes=doc['nodes'];parents={str(c):str(n['id']) for n in nodes.values() for c in n.get('children',[])}
 matches=[n for n in nodes.values() if n['type']=='frame' and n['name'].split('-')[0]==screen and nodes.get(parents.get(str(n['id']),''),{}).get('type')=='page']
 if len(matches)!=1:raise ValueError(f'Expected exactly one top-level frame for {screen}, found{len(matches)}')
 frame=matches[0];variables=validate_variables(doc.get('variables',{}).get('variables',[]));warnings=[];rows=[];seen=set()
 def walk(key,parent_matrix,depth):
  if depth>100:raise ValueError('Excessive node depth')
  if key in seen:raise ValueError('Node cycle/duplicate child '+key)
  seen.add(key);n=nodes[key];matrix=IDENTITY if n['id']==frame['id'] else compose(parent_matrix,n.get('transform',IDENTITY));typ=n['type'];bindings=n.get('bound',{})
  for variable in bindings.values():
   if isinstance(variable,str) and variable not in variables:raise ValueError('Missing variable '+variable)
  if typ not in SUPPORTED:warnings.append({'id':n['id'],'reason':'unknown-node-type','type':typ})
  if typ in MANUAL or n.get('mask') or n.get('is_mask'):warnings.append({'id':n['id'],'reason':'review-component-or-vector-mapping','type':typ})
  if abs(matrix[1])+abs(matrix[2])>1e-6:warnings.append({'id':n['id'],'reason':'transformed-layout-requires-review'})
  row={'id':n['id'],'parent':n.get('parent'),'name':n.get('name'),'type':typ,'boundsInScreen':bounds(matrix,n.get('width',0),n.get('height',0)),'localTransform':n.get('transform',IDENTITY),'visible':n.get('visible',True),'role':'prototype-hotspot' if n.get('name','').startswith('Hotspot /') else 'text' if typ=='text' else 'unmapped','bindings':bindings}
  for keyname in ['characters','style','fills','strokes','effects','layout','child_layout','component_id','component_properties','interactions','corner_radius','corners','children','mask','is_mask']:
   if keyname in n:row[keyname]=n[keyname]
  rows.append(row)
  for child in n.get('children',[]):
   if str(child) not in nodes:raise ValueError('Missing child '+str(child))
   walk(str(child),matrix,depth+1)
 walk(str(frame['id']),IDENTITY,0)
 return {'schemaVersion':1,'screen':screen,'masterSha256':sha,'frameId':frame['id'],'viewport':{'width':frame['width'],'height':frame['height']},'coordinateSpace':'screen-relative; affine bounds; reference pixels, not responsive intent','semanticTokens':tokens,'nativeVariables':list(variables.values()),'nodes':rows,'reviewRequired':warnings,'automaticWidgetGenerationReady':False,'limits':['Explicit coordinates require reviewed responsive/component mappings','Prototype links and fixture text are not runtime business facts','No rasterization or app/controller replacement is performed']}
def main():
 p=argparse.ArgumentParser();p.add_argument('--screens',nargs='+',default=['U26','R07','WD01']);p.add_argument('--check',action='store_true');a=p.parse_args();sha=hashlib.sha256(MASTER.read_bytes()).hexdigest();doc=json.loads(ZipFile(MASTER).read('document.json'));tokens=json.loads((ROOT/'design/figcraft/handoff/tokens.json').read_text());out=ROOT/'design/figcraft/reports/layout-ir';out.mkdir(exist_ok=True)
 for screen in a.screens:
  ir=extract(doc,screen,sha,tokens);payload=json.dumps(ir,ensure_ascii=False,indent=2)+'\n';path=out/(screen+'.json')
  if a.check:
   if not path.exists() or path.read_text()!=payload:raise SystemExit('STALE IR: '+screen)
  else:path.write_text(payload)
  print(json.dumps({'screen':screen,'nodes':len(ir['nodes']),'reviewMappings':len(ir['reviewRequired']),'sha256':sha,'check':'PASS' if a.check else 'EXTRACTED'}))
 if hashlib.sha256(MASTER.read_bytes()).hexdigest()!=sha:raise RuntimeError('Master changed during extraction')
if __name__=='__main__':main()
