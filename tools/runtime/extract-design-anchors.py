#!/usr/bin/env python3
"""Extract inspectable SVG geometry; never emit embedded artwork/base64."""
import json,hashlib,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HANDOFF=ROOT/'design/figcraft/handoff'
items=json.loads((HANDOFF/'screen-map.json').read_text())['screens']
result={}
attrs=('id','x','y','x1','x2','y1','y2','width','height','rx','ry','cx','cy','r','transform','fill','stroke','stroke-width','font-family','font-size','font-weight','letter-spacing','text-anchor','dominant-baseline','opacity')
for item in items:
 source=ROOT/'design/figcraft'/item['source'];raw=source.read_bytes();root=ET.fromstring(raw);nodes=[]
 for e in root.iter():
  tag=e.tag.rsplit('}',1)[-1]
  if tag not in ('rect','text','circle','line','g'):continue
  record={'tag':tag,**{k:e.attrib[k] for k in attrs if k in e.attrib}}
  if tag=='text':record['text']=''.join(e.itertext())
  if tag=='g' and set(record)=={'tag'}:continue
  nodes.append(record)
 result[item['id']]={'source':str(source.relative_to(ROOT)),'sha256':hashlib.sha256(raw).hexdigest(),'width':item['width'],'height':item['height'],'elements':nodes}
output=ROOT/'.omp/work/flutter-delivery-20261016/evidence/design-anchors-20261017.json';output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'screens':len(result),'elements':sum(len(v['elements']) for v in result.values()),'output':str(output.relative_to(ROOT))}))
