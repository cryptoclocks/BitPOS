#!/usr/bin/env python3
# NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
"""Quick self-check: render chosen screens straight from SVG to build/_checks/<frame>.png.
Usage: python3 -I source/render_check.py NM-01 NC-02 ...   (no args = all)"""
import importlib, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
CLI = os.path.expanduser('~/.local/bin/figcraft-cli')
OUT = os.path.join(os.path.dirname(HERE), 'build', '_checks')
os.makedirs(OUT, exist_ok=True)
want = set(sys.argv[1:])
for mod in ('screens_flow', 'screens_merchant', 'screens_customer', 'screens_staff', 'screens_device'):
    try:
        m = importlib.import_module(mod)
    except ModuleNotFoundError:
        continue
    for fn in m.ALL:
        try:
            docs = fn()
        except Exception as e:
            print('ERROR', fn.__name__, e)
            continue
        for d in (docs if isinstance(docs, (list, tuple)) else [docs]):
            if want and d.name not in want:
                continue
            p = d.save(OUT)
            r = subprocess.run([CLI, 'export', p, '-o', os.path.join(OUT, d.name + '.png')], capture_output=True, text=True)
            print(d.name, 'ok' if r.returncode == 0 else r.stderr[-300:])
