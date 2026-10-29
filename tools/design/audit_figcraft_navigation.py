#!/usr/bin/env python3
"""Read-only native prototype graph audit; findings are candidates, not UI acceptance."""
import json,hashlib
from pathlib import Path
from zipfile import ZipFile
from collections import defaultdict,deque
ROOT=Path(__file__).resolve().parents[2];master=ROOT/'design/figcraft/BitPOS-Platform-UI.figcraft'
with ZipFile(master) as z:doc=json.loads(z.read('document.json'))
nodes=doc['nodes'];screens=json.loads((ROOT/'design/figcraft/handoff/screen-map.json').read_text())['screens'];ids={s['id'] for s in screens}
frames={str(n['id']):n['name'].split('-')[0] for n in nodes.values() if n['type']=='frame' and n['name'].split('-')[0] in ids}
parents={str(child):str(n['id']) for n in nodes.values() for child in n.get('children',[])}
def owner(node):
 seen=set()
 while node not in seen:
  if node in frames:return frames[node]
  seen.add(node);node=parents.get(node)
  if node is None:return None
 return None
edges=defaultdict(set);incoming=defaultdict(set);invalid=[];count=0;clickable=set()
def actions(items):
 for action in items:
  yield action
  for block in action.get('blocks',[]):yield from actions(block.get('actions',[]))
for key,n in nodes.items():
 for interaction in n.get('interactions',[]):
  count+=1;source=owner(key)
  if source:clickable.add(source)
  for action in actions(interaction.get('actions',[])):
   if action.get('type') not in {'navigate','openOverlay','swapOverlay'}:continue
   target=str(action.get('dest'));target_screen=owner(target)
   if target not in nodes:invalid.append({'node':n['id'],'source':source,'dest':action.get('dest')})
   elif source and target_screen:edges[source].add(target_screen);incoming[target_screen].add(source)
roots=['A00'];seen=set(roots);q=deque(roots)
while q:
 for target in edges[q.popleft()]:
  if target not in seen:seen.add(target);q.append(target)
product=[s for s in screens if s['surface'] in {'user','rider','pos','pay','pay-desktop'}]
report={'masterSha256':hashlib.sha256(master.read_bytes()).hexdigest(),'boards':len(screens),'interactionCount':count,'invalidDestinations':invalid,
 'screenEdgeCount':sum(len(v) for v in edges.values()),'reachableFromCover':len(seen&ids),
 'productBoards':len(product),'productWithoutInteractions':[s['id'] for s in product if s['id'] not in clickable],
 'productWithoutOutgoingScreenLink':[s['id'] for s in product if not edges[s['id']]],
 'productNotReachableFromCover':[s['id'] for s in product if s['id'] not in seen],
 'adjacency':{key:sorted(value) for key,value in sorted(edges.items())},
 'limits':['Static native graph audit only; does not click presenter controls.','Unreachable boards may be intentional states/later flows and require semantic review.','Does not prove text fit, overlap, responsive layout or runtime API behavior.']}
path=ROOT/'design/figcraft/reports/current-navigation-audit.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k not in {'adjacency','limits'}},ensure_ascii=False,indent=2))
