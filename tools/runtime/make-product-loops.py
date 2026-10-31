#!/usr/bin/env python3
"""Build the menu loop videos (apps/web/public/videos/menu/<slug>.mp4) from licensed stock clips plus the menu photo.

Each loop is ~11 s, 720x720, no audio, no text: three slow-motion shots cut from the clip at different framings, then the
menu photo, joined by soft transitions; the last transition dissolves into a still of the first frame so the loop restarts
without a jump. Clip sources and licences: docs/CAFE_VIDEO_CREDITS.md. The clips themselves are NOT in the repository.

  python3 tools/runtime/make-product-loops.py <clips-dir> [slug ...]      # clips-dir holds <slug>.mp4
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/web/public/videos/menu'
PHOTOS = ROOT / 'apps/web/public/images/menu'
SIZE, FPS, SHOT, XF, SLOW = 720, 25, 3.4, 0.8, 1.25
# Per slug: (clip start fractions, zoom, pan from (x,y) to (x,y) as 0..1 of the free range) for three shots.
PLAN = {
    'espresso':          [(0.00, 1.10, (.5, .0), (.5, .35)), (0.30, 1.70, (.5, .15), (.5, .30)), (0.55, 1.35, (.5, .0), (.5, .2))],
    'americano':         [(0.00, 1.10, (.5, .5), (.5, .45)), (0.35, 1.60, (.45, .4), (.5, .35)), (0.60, 1.30, (.55, .6), (.5, .5))],
    'latte':             [(0.00, 1.00, (.5, .5), (.5, .5)),  (0.30, 1.50, (.4, .4), (.5, .5)),  (0.60, 1.25, (.6, .5), (.5, .5))],
    'iced-latte':        [(0.00, 1.10, (.5, .45), (.5, .5)), (0.30, 1.60, (.5, .35), (.5, .5)), (0.60, 1.30, (.5, .6), (.5, .45))],
    'cappuccino':        [(0.00, 1.10, (.4, .3), (.45, .3)), (0.30, 1.70, (.35, .25), (.4, .3)), (0.55, 1.35, (.4, .3), (.45, .35))],
    'matcha':            [(0.00, 1.10, (.5, .5), (.5, .5)),  (0.30, 1.60, (.5, .35), (.5, .5)), (0.60, 1.30, (.5, .65), (.5, .5))],
    'hot-chocolate':     [(0.00, 1.10, (.5, .6), (.5, .55)), (0.30, 1.70, (.5, .6), (.5, .65)), (0.60, 1.35, (.5, .7), (.5, .6))],
    'croissant':         [(0.00, 1.10, (.4, .5), (.5, .5)),  (0.40, 1.60, (.45, .5), (.55, .5)), (0.80, 1.30, (.5, .5), (.5, .5))],
    'blueberry-muffin':  [(0.00, 1.10, (.5, .5), (.5, .5)),  (0.30, 1.60, (.3, .6), (.5, .6)),  (0.60, 1.30, (.7, .4), (.5, .5))],
    'chocolate-brownie': [(0.00, 1.10, (.5, .5), (.5, .5)),  (0.25, 1.60, (.4, .5), (.5, .5)),  (0.50, 1.30, (.6, .5), (.5, .5))],
    'cheesecake':        [(0.00, 1.10, (.5, .5), (.5, .5)),  (0.30, 1.60, (.5, .4), (.5, .5)),  (0.60, 1.30, (.5, .6), (.5, .5))],
    'sandwich':          [(0.00, 1.10, (.5, .5), (.5, .5)),  (0.35, 1.60, (.4, .5), (.5, .5)),  (0.65, 1.30, (.6, .5), (.5, .5))],
}
TRANSITIONS = ['fade', 'smoothleft', 'dissolve', 'smoothup']


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', str(path)], capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    return data['streams'][0]['width'], data['streams'][0]['height'], float(data['format']['duration'])


def build(slug, clip):
    w, h, dur = probe(clip)
    need = SHOT / SLOW
    parts, labels = [], []
    for i, (frac, zoom, (fx, fy), (tx, ty)) in enumerate(PLAN[slug]):
        start = max(0.0, min(frac * dur, dur - need - 0.05))
        side = min(w, h) / zoom
        rx, ry = w - side, h - side
        x = f"{fx * rx:.1f}+({tx * rx - fx * rx:.1f})*t/{SHOT}"
        y = f"{fy * ry:.1f}+({ty * ry - fy * ry:.1f})*t/{SHOT}"
        parts.append(f"[0:v]trim=start={start:.3f}:duration={need:.3f},setpts=(PTS-STARTPTS)*{SLOW},fps={FPS},"
                     f"crop={side:.0f}:{side:.0f}:x='{x}':y='{y}',scale={SIZE}:{SIZE}:flags=lanczos,setsar=1,format=yuv420p[s{i}]")
        labels.append(f's{i}')
    # Menu photo as the fourth shot: slow push-in on the square-cropped photo.
    frames = int(SHOT * FPS)
    parts.append(f"[1:v]crop='min(iw,ih)':'min(iw,ih)',scale={SIZE * 2}:{SIZE * 2}:flags=lanczos,"
                 f"zoompan=z='1.18-0.16*on/{frames}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d={frames}:s={SIZE}x{SIZE}:fps={FPS},setsar=1,format=yuv420p[s3]")
    labels.append('s3')
    # A still of the first frame closes the loop: the last dissolve lands on exactly what the video starts with.
    parts.append(f"[s0]split[s0a][s0b]")
    labels[0] = 's0a'
    parts.append(f"[s0b]select='eq(n,0)',loop=loop=-1:size=1,trim=duration={XF + 0.1},setpts=PTS-STARTPTS,fps={FPS}[still]")
    labels.append('still')
    cur, length = labels[0], SHOT
    for k, nxt in enumerate(labels[1:]):
        last = nxt == 'still'
        d = XF if not last else XF
        offset = length - d
        kind = 'dissolve' if last else TRANSITIONS[k % len(TRANSITIONS)]
        parts.append(f"[{cur}][{nxt}]xfade=transition={kind}:duration={d}:offset={offset:.3f}[x{k}]")
        cur = f'x{k}'
        length = offset + (XF + 0.1 if last else SHOT)
    total = length - 0.1
    parts.append(f"[{cur}]trim=duration={total:.3f},eq=saturation=1.06:contrast=1.03,format=yuv420p[v]")
    out = OUT / f'{slug}.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(clip), '-i', str(PHOTOS / f'{slug}.jpg'), '-filter_complex', ';'.join(parts), '-map', '[v]',
                    '-c:v', 'libx264', '-profile:v', 'main', '-crf', '29', '-preset', 'slow', '-movflags', '+faststart', '-an', str(out)], check=True)
    print(slug, f'{total:.1f}s', f'{out.stat().st_size // 1024} KB')


if __name__ == '__main__':
    clips = Path(sys.argv[1])
    for slug in (sys.argv[2:] or PLAN):
        build(slug, clips / f'{slug}.mp4')
