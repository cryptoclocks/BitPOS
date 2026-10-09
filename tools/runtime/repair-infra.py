#!/usr/bin/env python3
"""Repair only the existing BitPOS stack; never emit secret SQL or Docker logs."""
import json, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SSH = ['ssh', '-i', '/Users/cryptoclock/Desktop/OCI/bitterm2.key', 'ubuntu@138.2.83.177']
PROJECT = '/home/ubuntu/bitpos-staging'
def remote(command, data=None):
    result = subprocess.run(SSH + [command], input=data, capture_output=True)
    if result.returncode:
        raise RuntimeError('Own-stack operation failed; private diagnostic suppressed')
    return result.stdout

def main():
    config = json.loads((ROOT / 'local/private/infra.json').read_text())
    # A pre-repair logical backup remains on OCI, private and outside served paths.
    remote('umask 077; mkdir -p /home/ubuntu/bitpos-private; test -s /home/ubuntu/bitpos-private/pre-auth-repair.sql || docker exec bitpos-staging-db-1 pg_dumpall -U postgres > /home/ubuntu/bitpos-private/pre-auth-repair.sql')
    password = config['dbPassword'].replace("'", "''")
    sql = (ROOT / 'infra/init.sql').read_text() + "\nALTER ROLE bitpos_app PASSWORD '" + password + "';\n"
    remote('docker exec -i bitpos-staging-db-1 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1', sql.encode())
    # Restart only consumers whose role credentials were repaired. Keep DB and volumes alive.
    remote('docker compose --project-directory ' + PROJECT + ' restart auth rest storage')
    print('BitPOS private backup preserved; database roles repaired; own auth/rest/storage restarted; DB/volumes unchanged')
if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(type(error).__name__ + ': private stack repair failed; no secret diagnostics emitted', file=sys.stderr)
        sys.exit(1)
