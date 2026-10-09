#!/usr/bin/env python3
"""Prepare only approved public BitPOS media; never format a card or write firmware."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[2]
GIFS = {
    'coffee-128.gif': (85290, '618b8395ec723563136c721044fc87ac80622a4825873842fb1366cbfcd3336e'),
    'sparkles-128.gif': (22300, '2d7fe7cd99d9985340500ff1ab9398ac8a5ec24f610d1aad688f8e00c38979e9'),
    'party-popper-128.gif': (36413, '7003b93a6379b9be0a945c3e8f2235f459b5b8a13ff6a7465c03bddcd4f55e34'),
    'confetti-128.gif': (38606, '724dd842e824ba5a43fdc3497cf7a77640447be141d307d09a9b2afae499b4d6'),
}
WAV = ('payment-success-device.wav', 20524, 'aa78633e92f389a5edc9216aa5068c0493ef1b17a661ebfcf81f0364e82af402')

def approved_bytes(directory, name, size, digest):
    source = directory / name
    if source.is_symlink() or not source.resolve().is_relative_to(directory.resolve()):
        raise ValueError('Asset source must stay inside its approved public directory')
    if source.stat().st_size != size or size > 131072:
        raise ValueError('Approved asset size mismatch')
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Approved asset checksum mismatch')
    return data

def ensure_owned_directory(root):
    target = root
    for part in ('bitpos', 'motion', 'v1'):
        target = target / part
        if target.is_symlink():
            raise ValueError('Refusing a symlink in the owned media root')
        target.mkdir(exist_ok=True)
    return target

def atomic_public_write(target, data):
    if target.is_symlink():
        raise ValueError('Refusing a symlink at an approved asset destination')
    if target.exists() and target.read_bytes() == data:
        return
    fd, temporary = tempfile.mkstemp(prefix='.bitpos-media-', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sd-root', type=Path, help='Explicit mounted SD root under /Volumes; only bitpos/motion/v1 is written')
    args = parser.parse_args()
    source_dir = ROOT / 'motion-lab/assets/gif'
    metadata = json.loads((source_dir / 'manifest.json').read_text())
    by_name = {row['path']: row for row in metadata}
    # Authenticate every input before any destination mutation. Headers alone are not decode proof.
    files = [(name, approved_bytes(source_dir, name, size, digest)) for name, (size, digest) in GIFS.items()]
    files.append((WAV[0], approved_bytes(ROOT / 'asset-pack/audio', *WAV)))
    manifest = {'schemaVersion': 1, 'root': 'bitpos/motion/v1', 'gifDecoderConfig': 'LV_GIF_CACHE_DECODE_DATA=1',
                'evidenceBoundary': 'Allowlisted preparation only; host decoder proof is motion-lab/assets/gif/DECODER-CHECK.md; actual SD/widget/audio verification is separate',
                'gifs': [by_name[name] for name in GIFS],
                'audio': {'path': WAV[0], 'bytes': WAV[1], 'sha256': WAV[2], 'origin': 'Original BitPOS synthesized cue; asset-pack/audio/README.md'}}
    if args.sd_root:
        root = args.sd_root.resolve(strict=True)
        if not root.is_relative_to(Path('/Volumes')) or not os.path.ismount(root):
            raise ValueError('Explicit SD root must be an actual mount under /Volumes, not the system disk')
    else:
        root = ROOT / 'local/motion-media'
        if root.is_symlink():
            raise ValueError('Refusing a symlink at the local preparation root')
        root.mkdir(parents=True, exist_ok=True)
    target = ensure_owned_directory(root)
    for name, data in files:
        atomic_public_write(target / name, data)
    atomic_public_write(target / 'manifest.json', (json.dumps(manifest, indent=2) + '\n').encode())
    print(json.dumps({'prepared': len(files), 'public_asset_bytes': sum(len(data) for _, data in files),
                      'only_128px_gifs': True, 'sd_written': bool(args.sd_root), 'destination': str(target.relative_to(root)),
                      'physical_media_ready': False}))

if __name__ == '__main__':
    main()
