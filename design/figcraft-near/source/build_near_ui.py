#!/usr/bin/env python3
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
# Adapted from the PayPal edition builder (paypal-hackathon/design/pp-edition/build/build_pp_edition.py):
# same SVG import -> hotspot wiring -> checks -> deterministic ZIP -> previews pipeline, but the document is
# built from scratch (no master file, no inherited frames, no embedded bitmaps).
"""Build design/figcraft-near/BitPOS-NEAR-UI.figcraft.

    python3 -I design/figcraft-near/source/build_near_ui.py              # build + checks + previews + reports
    python3 -I design/figcraft-near/source/build_near_ui.py --no-export  # skip PNG previews and contact sheets

Stdlib only. FigCraft is driven headlessly through ~/.local/bin/figcraft-cli (file.new / file.import / export /
render); the app is never opened. The build fails (exit 1, nothing overwritten) if any route or layout check fails.
"""
import hashlib
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
CLI = os.path.expanduser('~/.local/bin/figcraft-cli')
OUT = os.path.join(ROOT, 'BitPOS-NEAR-UI.figcraft')
SCREENS = os.path.join(HERE, 'screens')
PREVIEWS = os.path.join(ROOT, 'previews')
REPORTS = os.path.join(ROOT, 'reports')
HANDOFF = os.path.join(ROOT, 'handoff')
FONT = 'Noto Sans Thai'
ARGS = set(sys.argv[1:])
MODULES = ['screens_flow', 'screens_merchant', 'screens_customer', 'screens_staff', 'screens_device']


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def rgba(h, a=1.0):
    h = h.lstrip('#')
    return {'r': int(h[0:2], 16) / 255.0, 'g': int(h[2:4], 16) / 255.0, 'b': int(h[4:6], 16) / 255.0, 'a': a}


def click(dest):
    return {'trigger': {'type': 'onClick'}, 'actions': [{'type': 'navigate', 'dest': dest}],
            'transition': {'type': 'instant'}, 'duration_ms': 300, 'easing': 'easeOut'}


# ----------------------------------------------------------------------------- 1. SVG sources
def generate_svgs():
    if not os.path.exists(os.path.join(HERE, 'widths.json')):
        r = run([sys.executable, '-I', os.path.join(HERE, 'measure.py')])
        if r.returncode != 0:
            raise SystemExit('text measurement failed: ' + r.stderr[-800:])
    import routes
    os.makedirs(SCREENS, exist_ok=True)
    for fn in os.listdir(SCREENS):
        if fn.endswith('.svg'):
            os.remove(os.path.join(SCREENS, fn))
    paths = {}
    for mod in MODULES:
        m = importlib.import_module(mod)
        for fn in m.ALL:
            docs = fn()
            for d in (docs if isinstance(docs, (list, tuple)) else [docs]):
                paths[d.name] = d.save(SCREENS)
    missing = [k for k in routes.ORDER if k not in paths]
    extra = [k for k in paths if k not in routes.ROUTES]
    if missing or extra:
        raise SystemExit('screen generators and route table disagree: missing %s extra %s' % (missing, extra))
    return paths


# ----------------------------------------------------------------------------- 2. import into FigCraft
def import_all(paths, tmp):
    import routes
    script = os.path.join(tmp, 'import.jsonl')
    out = os.path.join(tmp, 'import.figcraft')
    with open(script, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps({'command': 'file.new', 'params': {'name': 'BitPOS NEAR UI'}}) + '\n')
        for k in routes.ORDER:
            fh.write(json.dumps({'command': 'file.import', 'params': {'path': paths[k], 'x': 0, 'y': 0}}) + '\n')
    r = run([CLI, 'run', script, '--out', out])
    if r.returncode != 0:
        raise SystemExit('figcraft-cli import failed: ' + (r.stderr or r.stdout)[-2000:])
    warnings, steps = [], []
    for line in r.stdout.splitlines():
        if not line.startswith('{'):
            continue
        s = json.loads(line)
        steps.append({'step': s.get('step'), 'command': s.get('command'), 'ok': s.get('ok', True)})
        if not s.get('ok', True):
            raise SystemExit('import step failed: ' + line[:500])
        for w in (s.get('result') or {}).get('warnings', []) or []:
            warnings.append(str(w))
    with zipfile.ZipFile(out) as z:
        d = json.loads(z.read('document.json'))
    return d, warnings, steps


# ----------------------------------------------------------------------------- 3. pages, links, flows
def assemble(d):
    import routes
    n = d['nodes']
    first = n[str(d['pages'][0])]
    tops = [n[str(c)] for c in first['children']]
    by_name = {}
    for f, want in zip(tops, routes.ORDER):
        if f['name'] != want:
            raise SystemExit('import order mismatch: got "%s", expected "%s"' % (f['name'], want))
        by_name[want] = f
    proto = first.get('prototype') or {'device': 'None', 'background': rgba('#1E1E1E'), 'rotation': 'portrait'}
    next_id = d['next_id']
    pages = {}
    page_ids = []
    for i, pname in enumerate(routes.PAGES):
        if i == 0:
            pg = first
            pg['name'] = pname
        else:
            pg = {'id': next_id, 'name': pname, 'type': 'page', 'background': rgba('#E9ECE4'), 'flows': [],
                  'prototype': json.loads(json.dumps(proto)), 'guides': [], 'children': [], 'width': 0.0, 'height': 0.0}
            n[str(next_id)] = pg
            next_id += 1
        pg['background'] = rgba('#E9ECE4')
        pg['children'] = []
        pg['flows'] = []
        pages[pname] = pg
        page_ids.append(pg['id'])
    d['pages'] = page_ids
    d['current_page'] = page_ids[0]
    d['next_id'] = next_id
    d['name'] = 'BitPOS NEAR UI · Living Bill'
    # place frames: rows per page, 80 px gap, new row when the frame size changes or the row gets wide
    cursor = {p: [0.0, 0.0, 0.0, None, 0] for p in routes.PAGES}
    for name in routes.ORDER:
        f = by_name[name]
        page = routes.ROUTES[name][0]
        pg = pages[page]
        x, y, rowh, last, count = cursor[page]
        size = (f['width'], f['height'])
        per_row = 6 if f['width'] <= 480 else 4
        if last is not None and (size != last or count >= per_row):
            x = 0.0
            y += rowh + 160.0
            rowh = 0.0
            count = 0
        f['transform'] = [1.0, 0.0, 0.0, 1.0, x, y]
        f['parent'] = pg['id']
        pg['children'].append(f['id'])
        cursor[page] = [x + f['width'] + 80.0, y, max(rowh, f['height']), size, count + 1]
    # hotspots -> prototype links
    wired, unresolved = 0, []
    for name in routes.ORDER:
        f = by_name[name]
        stack = [f]
        while stack:
            x = stack.pop()
            stack.extend(n[str(c)] for c in x.get('children', []))
            nm = x.get('name', '')
            if not nm.startswith('hotspot__'):
                continue
            target = nm.split('__')[1]
            dest = by_name.get(target)
            if dest is None:
                unresolved.append('%s: %s' % (name, nm))
                continue
            x['interactions'] = [click(dest['id'])]
            x['name'] = 'Hotspot / %s to %s' % (name, target)
            wired += 1
    if unresolved:
        raise SystemExit('hotspots without a target frame: %s' % unresolved)
    for page, fname, start, desc in routes.FLOWS:
        pages[page]['flows'].append({'name': fname, 'start': by_name[start]['id'], 'description': desc})
    return by_name, wired


# ----------------------------------------------------------------------------- 4. output
def write_out(d, thumb):
    blobs = {'document.json': json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode('utf-8')}
    if thumb:
        blobs['thumbnail.png'] = thumb
    tmp = OUT + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        for nm in sorted(blobs):
            zi = zipfile.ZipInfo(nm, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, blobs[nm])
    os.replace(tmp, OUT)
    with open(OUT, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def export_previews(d, warn):
    os.makedirs(PREVIEWS, exist_ok=True)
    for fn in os.listdir(PREVIEWS):
        if fn.endswith('.png'):
            os.remove(os.path.join(PREVIEWS, fn))
    for pid in d['pages']:
        pg = d['nodes'][str(pid)]
        r = run([CLI, 'export', OUT, '-o', PREVIEWS, '--page', pg['name']])
        if r.returncode != 0:
            warn.append('export failed for page %s: %s' % (pg['name'], (r.stderr or r.stdout)[-300:]))
    return sorted(f for f in os.listdir(PREVIEWS) if f.endswith('.png'))


def contact_sheets(d, warn):
    os.makedirs(REPORTS, exist_ok=True)
    for fn in os.listdir(REPORTS):
        if fn.startswith('contact-') and fn.endswith('.png'):
            os.remove(os.path.join(REPORTS, fn))
    made = []
    n = d['nodes']
    for pid in d['pages']:
        pg = n[str(pid)]
        frames = [n[str(c)] for c in pg['children']]
        pngs = [(f, os.path.join(PREVIEWS, f['name'] + '.png')) for f in frames]
        pngs = [(f, p) for f, p in pngs if os.path.exists(p)]
        if not pngs:
            continue
        cols = 4 if frames[0]['width'] > 480 else 6
        cell_w, label_h, gap = 480.0, 34.0, 32.0
        cells = []
        for f, path in pngs:
            sc = cell_w / max(f['width'], f['height'] * 0.75)
            cells.append((f['name'], path, f['width'] * sc, f['height'] * sc))
        rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
        W = cols * (cell_w + gap) + gap
        H = 90 + sum(max(c[3] for c in r) + label_h + gap for r in rows) + gap
        slug = re.sub(r'[^A-Za-z0-9]+', '-', pg['name']).strip('-')
        tmpd = tempfile.mkdtemp(prefix='near-sheet-')
        lines = [{'command': 'file.new', 'params': {'name': slug}},
                 {'command': 'node.create', 'params': {'type': 'frame', 'x': 0, 'y': 0, 'width': W, 'height': H, 'name': slug,
                                                       'props': {'fill': '#E9ECE4'}, 'select': False}},
                 {'command': 'node.create', 'params': {'type': 'text', 'x': gap, 'y': 24,
                                                       'text': pg['name'] + '  ·  BitPOS NEAR edition',
                                                       'props': {'fontFamily': FONT, 'fontStyle': 'Semi Bold', 'fontSize': 32,
                                                                 'fill': '#0B1020'}, 'select': False}}]
        y = 90.0
        nid = 4
        for r in rows:
            x = gap
            rh = max(c[3] for c in r)
            for nm, path, w, h in r:
                lines.append({'command': 'file.import', 'params': {'path': path, 'x': x, 'y': y}})
                lines.append({'command': 'node.set', 'params': {'id': nid, 'width': w, 'height': h}})
                nid += 1
                lines.append({'command': 'node.create', 'params': {'type': 'text', 'x': x, 'y': y + h + 6, 'text': nm,
                                                                   'props': {'fontFamily': FONT, 'fontStyle': 'Regular',
                                                                             'fontSize': 16, 'fill': '#0B1020'}, 'select': False}})
                nid += 1
                x += cell_w + gap
            y += rh + label_h + gap
        script = os.path.join(tmpd, 's.jsonl')
        with open(script, 'w', encoding='utf-8') as fh:
            for l in lines:
                fh.write(json.dumps(l, ensure_ascii=False) + '\n')
        sheet = os.path.join(tmpd, 's.figcraft')
        out_png = os.path.join(REPORTS, 'contact-%s.png' % slug)
        r = run([CLI, 'run', script, '--out', sheet])
        if r.returncode == 0:
            r = run([CLI, 'render', sheet, '-o', out_png, '--scale', '0.5'])
        if r.returncode != 0 or not os.path.exists(out_png):
            warn.append('contact sheet failed for %s: %s' % (pg['name'], (r.stderr or r.stdout)[-300:]))
        else:
            made.append(os.path.relpath(out_png, ROOT))
        shutil.rmtree(tmpd, ignore_errors=True)
    return made


def handoff(d, by_name, edges):
    import routes
    import lib
    os.makedirs(HANDOFF, exist_ok=True)
    screens = []
    for name in routes.ORDER:
        page, title, size, entries, dests, rt = routes.ROUTES[name]
        screens.append({'id': name, 'node': by_name[name]['id'], 'page': page, 'title': title,
                        'size': '%dx%d' % size, 'language': 'th' if name.endswith('-th') else 'en',
                        'entry': entries, 'destinations': dests, 'all_links': sorted(edges.get(name, ())),
                        'runtime_route': rt, 'preview': 'previews/%s.png' % name})
    with open(os.path.join(HANDOFF, 'screen-map.json'), 'w', encoding='utf-8') as fh:
        json.dump({'document': 'BitPOS-NEAR-UI.figcraft', 'start': routes.START, 'pages': routes.PAGES, 'screens': screens},
                  fh, ensure_ascii=False, indent=1)
    with open(os.path.join(HANDOFF, 'interaction-map.json'), 'w', encoding='utf-8') as fh:
        json.dump({'edges': [{'from': a, 'to': b} for a in routes.ORDER for b in sorted(edges.get(a, ()))],
                   'flows': [{'page': p, 'name': nm, 'start': st, 'description': ds} for p, nm, st, ds in routes.FLOWS]},
                  fh, ensure_ascii=False, indent=1)
    with open(os.path.join(HANDOFF, 'tokens.json'), 'w', encoding='utf-8') as fh:
        json.dump({'note': 'BitPOS\'s own palette for the NEAR edition. Not NEAR\'s brand. No third-party logos.',
                   'font': FONT, 'colors': lib.C,
                   'split_colors_light': lib.SPLIT_COLOR, 'split_colors_dark': lib.SPLIT_COLOR_DARK,
                   'sizes': {'merchant': '1440x1000', 'phone': '390x844', 'mini': '480x320', 'flow': '1600x1000'},
                   'radii': {'card_mobile': 16, 'card_desktop': 12, 'button': 'pill'},
                   'button_heights': {'mobile': 52, 'desktop': 44}, 'grid': 8,
                   'sample_bill': {'total_minor': lib.BILL_TOTAL, 'split_minor': dict(lib.SPLIT),
                                   'sum_ok': sum(v for _, v in lib.SPLIT) == lib.BILL_TOTAL}},
                  fh, ensure_ascii=False, indent=1)


# ----------------------------------------------------------------------------- main
def main():
    import check_routes
    import routes
    report = {'document': 'BitPOS-NEAR-UI.figcraft', 'figcraft_cli': run([CLI, '--version']).stdout.strip(), 'warnings': []}
    paths = generate_svgs()
    tmp = tempfile.mkdtemp(prefix='near-build-')
    try:
        d, warnings, steps = import_all(paths, tmp)
        report['warnings'] += ['SVG import: ' + w for w in warnings]
        by_name, wired = assemble(d)
        res = check_routes.run_checks(d)
        view = check_routes.View(d)
        edges = view.edges()
        report.update({
            'frames': len(routes.ORDER), 'pages': len(d['pages']), 'nodes': len(d['nodes']),
            'frames_per_page': {d['nodes'][str(p)]['name']: len(d['nodes'][str(p)]['children']) for p in d['pages']},
            'hotspots_wired': wired, 'links': sum(len(v) for v in edges.values()),
            'flows': sum(len(d['nodes'][str(p)]['flows']) for p in d['pages']),
            'import_steps': len(steps),
            'checks': {k: {'pass': r['pass'], 'rule': r['rule'], 'failures': r['failures']} for k, r in res.items()},
            'checks_summary': check_routes.summarize(res),
            'all_checks_pass': all(r['pass'] for r in res.values()),
        })
        os.makedirs(REPORTS, exist_ok=True)
        if not report['all_checks_pass']:
            with open(os.path.join(REPORTS, 'build-report.failed.json'), 'w', encoding='utf-8') as fh:
                json.dump(report, fh, ensure_ascii=False, indent=1)
            for k, s in report['checks_summary'].items():
                print('%-26s %s' % (k, s))
            bad = {k: r['failures'][:8] for k, r in res.items() if not r['pass']}
            print(json.dumps(bad, ensure_ascii=False, indent=1))
            raise SystemExit('checks failed; %s not written (see reports/build-report.failed.json)' % os.path.basename(OUT))
        failed = os.path.join(REPORTS, 'build-report.failed.json')
        if os.path.exists(failed):
            os.remove(failed)
        thumb = None
        tpng = os.path.join(tmp, 'thumb.png')
        r = run([CLI, 'export', paths[routes.START], '-o', tpng, '--scale', '0.25'])
        if r.returncode == 0 and os.path.exists(tpng):
            with open(tpng, 'rb') as fh:
                thumb = fh.read()
        report['sha256'] = write_out(d, thumb)
        info = run([CLI, 'info', OUT, '--json'])
        report['cli_can_open_output'] = info.returncode == 0
        if info.returncode != 0:
            raise SystemExit('figcraft-cli cannot open the written file: ' + (info.stderr or info.stdout)[-500:])
        # re-run the checks on the file as written (what a reviewer would open)
        res2 = check_routes.run_checks(check_routes.load(OUT))
        report['checks_on_written_file_pass'] = all(r['pass'] for r in res2.values())
        handoff(d, by_name, edges)
        if '--no-export' not in ARGS:
            pngs = export_previews(d, report['warnings'])
            report['previews'] = len(pngs)
            missing = [k for k in routes.ORDER if k + '.png' not in pngs]
            report['previews_missing'] = missing
            report['contact_sheets'] = contact_sheets(d, report['warnings'])
        with open(os.path.join(REPORTS, 'build-report.json'), 'w', encoding='utf-8') as fh:
            json.dump(report, fh, ensure_ascii=False, indent=1)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('built %s  sha256 %s' % (os.path.relpath(OUT, ROOT), report['sha256'][:16]))
    print('frames %d · pages %d · nodes %d · links %d · hotspots %d' % (
        report['frames'], report['pages'], report['nodes'], report['links'], report['hotspots_wired']))
    for k, s in report['checks_summary'].items():
        print('  %-26s %s' % (k, s))
    if report['warnings']:
        print('warnings:', len(report['warnings']))
        for w in report['warnings'][:10]:
            print('  -', w)


if __name__ == '__main__':
    main()
