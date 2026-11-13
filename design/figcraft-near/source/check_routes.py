#!/usr/bin/env python3
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Reachability / hotspot-conflict logic adapted from the PayPal edition builder (build_pp_edition.py run_checks).
"""Route and layout verification for BitPOS-NEAR-UI.figcraft.

Standalone:  python3 -I design/figcraft-near/source/check_routes.py [path/to/file.figcraft]
Exit code 0 only when every check passes. The builder runs the same checks before it writes the file.
"""
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import routes  # noqa: E402

THAI = re.compile('[฀-๿]')
TOL = 1.0


class View:
    """Read-only helpers over a FigCraft document.json."""

    def __init__(self, d):
        self.d = d
        self.n = d['nodes']
        self.frames = {}        # name -> frame node
        self.frame_page = {}    # frame id -> page name
        for pid in d['pages']:
            pg = self.n[str(pid)]
            for c in pg.get('children', []):
                f = self.n[str(c)]
                self.frames.setdefault(f['name'], []).append(f)
                self.frame_page[c] = pg['name']

    def node(self, i):
        return self.n[str(i)]

    def desc(self, i):
        x = self.node(i)
        yield x
        for c in x.get('children', []):
            yield from self.desc(c)

    def top_frame(self, x):
        while x.get('parent') is not None and self.node(x['parent'])['type'] != 'page':
            x = self.node(x['parent'])
        return x

    def pos(self, x):
        """position of x relative to its top-level frame (sum of translations of x and its ancestors below the frame)."""
        X = Y = 0.0
        while x.get('parent') is not None:
            p = self.node(x['parent'])
            if p['type'] == 'page':
                break
            t = x.get('transform') or [1, 0, 0, 1, 0, 0]
            X += t[4]
            Y += t[5]
            x = p
        return X, Y

    def bbox(self, x):
        X, Y = self.pos(x)
        return (X, Y, X + x.get('width', 0.0), Y + x.get('height', 0.0))

    def links(self, fid):
        """[(node, bbox, dest frame id)] for navigate actions under a frame."""
        out = []
        for y in self.desc(fid):
            for it in y.get('interactions') or []:
                for a in it.get('actions', []):
                    if a.get('type') == 'navigate':
                        out.append((y, self.bbox(y), a.get('dest')))
        return out

    def edges(self):
        e = {}
        for name, fl in self.frames.items():
            for f in fl:
                for _, _, dest in self.links(f['id']):
                    if dest is not None and str(dest) in self.n:
                        e.setdefault(f['name'], set()).add(self.top_frame(self.node(dest))['name'])
        return e


def run_checks(d):
    v = View(d)
    res = {}

    def put(key, fails, note):
        res[key] = {'pass': not fails, 'rule': note, 'failures': fails}

    # 1. every planned frame exists once, on the right page, at the right size
    fails = []
    for name, (page, _t, size, _e, _d, _r) in routes.ROUTES.items():
        fl = v.frames.get(name, [])
        if len(fl) != 1:
            fails.append({'frame': name, 'problem': 'found %d times' % len(fl)})
            continue
        f = fl[0]
        if v.frame_page[f['id']] != page:
            fails.append({'frame': name, 'problem': 'on page "%s", expected "%s"' % (v.frame_page[f['id']], page)})
        if (round(f['width']), round(f['height'])) != tuple(size):
            fails.append({'frame': name, 'problem': 'size %sx%s, expected %sx%s' % (f['width'], f['height'], size[0], size[1])})
    for name in v.frames:
        if name not in routes.ROUTES:
            fails.append({'frame': name, 'problem': 'not in the route table'})
    put('frames_match_plan', fails, 'Every frame of PLAN_TH §8 (plus the 6 Thai variants) exists once, on its page, at its size.')

    # 2. dangling destinations (links and flows)
    fails = []
    top_ids = set(v.frame_page)
    for x in v.n.values():
        for it in x.get('interactions') or []:
            for a in it.get('actions', []):
                dest = a.get('dest')
                if a.get('type') == 'navigate' and (dest is None or str(dest) not in v.n or dest not in top_ids):
                    fails.append({'frame': v.top_frame(x)['name'], 'node': x['id'], 'dest': dest})
    for pid in d['pages']:
        for fl in v.node(pid).get('flows') or []:
            if fl.get('start') not in top_ids:
                fails.append({'flow': fl.get('name'), 'start': fl.get('start')})
    put('no_dangling_links', fails, 'Every prototype link and every flow start points at an existing top-level frame.')

    # 3. hotspots that were never wired
    fails = [{'frame': v.top_frame(x)['name'], 'node': x['id'], 'name': x['name']} for x in v.n.values()
             if str(x.get('name', '')).startswith('hotspot__')]
    put('all_hotspots_wired', fails, 'No SVG hotspot layer is left without a destination.')

    # 4. reachability from N00 over prototype links only
    edges = v.edges()
    seen, todo = {routes.START}, [routes.START]
    while todo:
        cur = todo.pop()
        for t in sorted(edges.get(cur, ())):
            if t not in seen:
                seen.add(t)
                todo.append(t)
    fails = sorted(nm for nm in v.frames if nm not in seen)
    put('reachable_from_N00', fails, 'Every frame can be reached from N00-flow-map by clicking prototype links.')

    # 5. no dead ends
    fails = sorted(nm for nm in v.frames if not edges.get(nm))
    put('no_dead_ends', fails, 'Every frame has at least one outgoing link.')

    # 6. route table of PLAN_TH §8: entry -> frame and frame -> destination
    fails = []
    for name, (_p, _t, _s, entries, dests, _r) in routes.ROUTES.items():
        for e in entries:
            if name not in edges.get(e, ()):
                fails.append({'missing_edge': '%s -> %s' % (e, name), 'kind': 'entry'})
        for t in dests:
            if t not in edges.get(name, ()):
                fails.append({'missing_edge': '%s -> %s' % (name, t), 'kind': 'destination'})
    put('route_table_edges', fails, 'Each "entry → frame" and "frame → destination" pair of the route table exists as a link.')

    # 7. overlapping click targets that go to different frames
    fails = []
    for name, fl in v.frames.items():
        for f in fl:
            items = v.links(f['id'])
            for i in range(len(items)):
                for j in range(i + 1, len(items)):
                    (a, A, da), (b, B, db) = items[i], items[j]
                    if da == db:
                        continue
                    ix = min(A[2], B[2]) - max(A[0], B[0])
                    iy = min(A[3], B[3]) - max(A[1], B[1])
                    if ix > 0.5 and iy > 0.5:
                        fails.append({'frame': name, 'nodes': [a['id'], b['id']], 'overlap': [round(ix, 1), round(iy, 1)]})
    put('no_conflicting_hotspots', fails, 'No two click targets with different destinations overlap at all.')

    # 8. hotspots inside the frame
    fails = []
    for name, fl in v.frames.items():
        for f in fl:
            for y, B, _ in v.links(f['id']):
                if B[0] < -TOL or B[1] < -TOL or B[2] > f['width'] + TOL or B[3] > f['height'] + TOL:
                    fails.append({'frame': name, 'node': y['id'], 'bbox': [round(q, 1) for q in B]})
    put('hotspots_inside_frame', fails, 'Every click target lies inside its frame.')

    # 9. text inside its frame (text boxes measured by FigCraft's own text engine on import)
    fails = []
    for name, fl in v.frames.items():
        for f in fl:
            for y in v.desc(f['id']):
                if y['type'] != 'text':
                    continue
                B = v.bbox(y)
                if B[0] < -TOL or B[1] < -TOL or B[2] > f['width'] + TOL or B[3] > f['height'] + TOL:
                    fails.append({'frame': name, 'node': y['id'], 'text': y.get('characters', '')[:40],
                                  'bbox': [round(q, 1) for q in B]})
    put('text_inside_frame', fails, 'No text box crosses the edge of its frame.')

    # 10. every layer inside its frame, every child inside its group (group-relative position bug guard)
    fails = []
    for name, fl in v.frames.items():
        for f in fl:
            for y in v.desc(f['id']):
                if y['id'] == f['id']:
                    continue
                B = v.bbox(y)
                if B[0] < -TOL or B[1] < -TOL or B[2] > f['width'] + TOL or B[3] > f['height'] + TOL:
                    fails.append({'frame': name, 'node': y['id'], 'name': y.get('name'), 'problem': 'outside frame',
                                  'bbox': [round(q, 1) for q in B]})
                p = v.node(y['parent'])
                if p['type'] == 'group':
                    P = v.bbox(p)
                    if B[0] < P[0] - TOL or B[1] < P[1] - TOL or B[2] > P[2] + TOL or B[3] > P[3] + TOL:
                        fails.append({'frame': name, 'node': y['id'], 'name': y.get('name'), 'problem': 'outside its group',
                                      'bbox': [round(q, 1) for q in B], 'group': [round(q, 1) for q in P]})
    put('children_inside_parent', fails, 'Every layer lies inside its frame and inside the group that holds it.')

    # 11. markers
    fails = []
    for name, fl in v.frames.items():
        for f in fl:
            texts = [y.get('characters', '') for y in v.desc(f['id']) if y['type'] == 'text']
            if not any(t.strip() == 'NEAR testnet' for t in texts):
                fails.append({'frame': name, 'missing': 'NEAR testnet'})
            if name == 'NC-04' and not any('concept' in t.lower() for t in texts):
                fails.append({'frame': name, 'missing': 'concept'})
            if name in ('NC-08', 'NS-02') and not any('Mainnet preview · not executed' in t for t in texts):
                fails.append({'frame': name, 'missing': 'Mainnet preview · not executed'})
    put('markers_present', fails, 'Every frame carries the "NEAR testnet" marker chip; NC-04 says "concept"; cross-chain previews say "Mainnet preview · not executed".')

    # 12. language: English frames carry no Thai except the language switch; Thai variants carry Thai
    fails = []
    for name, fl in v.frames.items():
        for f in fl:
            thai = [y for y in v.desc(f['id']) if y['type'] == 'text' and THAI.search(y.get('characters', ''))]
            if name.endswith('-th'):
                if len(thai) < 3:
                    fails.append({'frame': name, 'problem': 'Thai variant has almost no Thai text'})
            else:
                bad = [y.get('characters', '')[:30] for y in thai if y.get('characters', '').strip() != 'ไทย']
                if bad:
                    fails.append({'frame': name, 'problem': 'Thai text on an English frame', 'texts': bad[:5]})
    put('language_separation', fails, 'English frames contain no Thai except the "ไทย" switch; -th frames are in Thai.')

    # 13. no embedded images (so no third-party logos or screenshots can be inside)
    fails = []
    if d.get('imageIndex'):
        fails.append({'imageIndex': len(d['imageIndex'])})
    for x in v.n.values():
        for p in (x.get('fills') or []) + (x.get('strokes') or []):
            if p.get('type') == 'image':
                fails.append({'frame': v.top_frame(x)['name'], 'node': x['id']})
    put('no_embedded_images', fails, 'The document embeds no bitmap: every mark is our own vector or text.')

    return res


def summarize(res):
    return {k: ('pass' if r['pass'] else 'FAIL (%d)' % len(r['failures'])) for k, r in res.items()}


def load(path):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read('document.json'))


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), 'BitPOS-NEAR-UI.figcraft')
    res = run_checks(load(path))
    for k, s in summarize(res).items():
        print('%-26s %s' % (k, s))
    bad = {k: r['failures'][:10] for k, r in res.items() if not r['pass']}
    if bad:
        print(json.dumps(bad, ensure_ascii=False, indent=1))
        sys.exit(1)
