#!/usr/bin/env python3
"""Coordinator-only private backup of the existing single BitPOS database schema."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
SSH = ['ssh', '-i', '/Users/cryptoclock/Desktop/OCI/bitterm2.key', 'ubuntu@138.2.83.177']


def remote(command, data=None):
    result = subprocess.run(SSH + [command], input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=180)
    if result.returncode:
        raise RuntimeError('Own-stack backup command failed; private diagnostics withheld')
    return result.stdout


def main():
    os.umask(0o077)
    container = remote("docker ps --filter label=com.docker.compose.project=bitpos-staging --filter label=com.docker.compose.service=db --format '{{.ID}}'").decode().strip()
    if not container or any(character not in '0123456789abcdef' for character in container):
        raise RuntimeError('Exactly one running own-stack database is required')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    directory = ROOT / 'local/private/db-backups'
    if directory.is_symlink():
        raise RuntimeError('Private backup directory cannot be a symlink')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    archive = remote(f'docker exec {container} pg_dump -U postgres --schema=bitpos --format=custom postgres')
    if not archive.startswith(b'PGDMP'):
        raise RuntimeError('Backup archive format mismatch')
    listing = remote(f'docker exec -i {container} pg_restore --list', archive)
    if b'TABLE bitpos orders ' not in listing or b'TABLE bitpos merchants ' not in listing:
        raise RuntimeError('Own schema backup is incomplete')
    destination = directory / ('bitpos-' + stamp + '.dump')
    with destination.open('xb') as handle:
        handle.write(archive)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(destination, 0o600)
    proof = {'origin': 'single_existing_OCI_BitPOS_schema_pg_dump', 'at': stamp,
             'privatePath': str(destination.relative_to(ROOT)), 'bytes': len(archive),
             'sha256': hashlib.sha256(archive).hexdigest(), 'archiveListVerified': True,
             'permissions': '600', 'schemaOnlyScope': 'bitpos',
             'restoreExecuted': False, 'secretsOrRowsPrinted': False}
    evidence = ROOT / ('.omp/work/evidence/db-backup-' + stamp + '.json')
    evidence.write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Private own-stack backup failed; no archive contents or credentials disclosed', file=sys.stderr)
        sys.exit(1)
