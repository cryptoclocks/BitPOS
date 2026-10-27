#!/usr/bin/env python3
"""Coordinator-only deployment of the existing OCI BitPOS stack (stdlib only).

Default: report prerequisites locally; no SSH, build, DB or provider operation.
Explicit --prepare snapshots exact running images/config/source outside the repo
and uploads only the Docker source closure. --deploy builds that closure and
recreates api/web/worker/customer/merchant only. --rollback never restores a DB.
All command output is captured privately or discarded; exceptions never print
command arguments, environment, HTTP bodies, DB rows or credential material.

Examples (coordinator ONLY; these commands are not proof of execution):
  python3 tools/runtime/coffee-copilot-deploy.py
  python3 tools/runtime/coffee-copilot-deploy.py --prepare --release coffee-20261012 \
    --backup-receipt <fresh-receipt.json> --catalog-entry-file <private-entry.txt>
  python3 tools/runtime/coffee-copilot-deploy.py --deploy --release coffee-20261012 \
    --backup-receipt <fresh-receipt.json> --catalog-entry-file <private-entry.txt>
  python3 tools/runtime/coffee-copilot-deploy.py --rollback --release coffee-20261012 \
    --backup-receipt <fresh-receipt.json>
  python3 tools/runtime/coffee-copilot-deploy.py --private-provider-env

Rollback blocks even EXPIRED/PAUSED grants until real owner revoke + lifecycle
and spend reconciliation; old images cannot manage their remaining allowance.
A failed deployment retains target source/services when rollback is unsafe.
No migrations, funding, transactions, provider generations, SSH key upload,
whole-repository upload, DB restore/reset/drop or stack creation is implemented.
"""
import argparse
import base64
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = Path('/home/ubuntu/bitpos-runtime')
PRIVATE = Path('/home/ubuntu/bitpos-private')
COMPOSE_DIR = RUNTIME / 'infra/oci'
SERVICES = ('api', 'web', 'worker', 'customer', 'merchant')
import os as _os
SSH = ('ssh', '-o', 'BatchMode=yes', '-i',
       _os.environ.get('BITPOS_OCI_SSH_KEY', ''), _os.environ.get('BITPOS_OCI_SSH_TARGET', ''))
if not SSH[3] or not SSH[4]:
    # Prerequisite report mode never uses SSH; any SSH operation refuses without both variables.
    SSH = ('false',)
TREES = ('apps/api/src', 'apps/worker/src', 'apps/web/src',
         'apps/web/public', 'packages/contracts/src', 'packages/domain/src')
EXACT = ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
         'apps/web/astro.config.mjs', 'data/cafe-catalog.json', 'data/menu-assets.json',
         'device/firmware/fonts/Sarabun-Regular.ttf', 'device/firmware/fonts/OFL.txt',
         'infra/oci/Dockerfile', 'infra/oci/compose.yaml',
         'infra/oci/customer-proxy.py', 'infra/oci/merchant-proxy.py')
CODE_SUFFIXES = {'.ts', '.tsx', '.css', '.astro', '.js', '.mjs', '.py', '.svg'}
PUBLIC_FILES = {
    'images/customer-checkout-origin.json', 'images/bitpos-logo.png',
    'images/phantom-logo-purple.png',
    *('images/menu/' + name + '.jpg' for name in (
        'sandwich', 'cheesecake', 'chocolate-brownie', 'blueberry-muffin',
        'croissant', 'hot-chocolate', 'matcha', 'cappuccino', 'iced-latte',
        'americano', 'latte', 'espresso')),
}
FORBIDDEN = {'.env', '.omp', '.git', 'node_modules', 'private', 'backups',
             'backup', '__pycache__', 'dist', '.astro', 'CryptoClock'}
MIGRATIONS = ('029_coffee_copilot.sql', '030_x402_exact.sql',
              '031_delegated_payments.sql', '032_coffee_order_constraints.sql',
              '033_delegated_revoke_generations.sql', '034_x402_terminal_reconciliation.sql',
              '035_table_occupancies.sql', '036_daily_campaigns.sql',
              '037_customer_auth_consent.sql', '038_promotion_playlists.sql',
              '039_personal_recipients.sql', '040_personal_published_daily_floor.sql',
              '041_personal_current_daily_floor.sql', '042_promotion_derivations.sql')
NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'


class Refusal(Exception):
    """Only constant, sanitized diagnostics belong in this exception."""


def require(ok, reason):
    if not ok:
        raise Refusal(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1048576), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def stamp():
    return datetime.now(timezone.utc).isoformat()


def allowed(name):
    p = Path(name)
    if p.is_absolute() or '..' in p.parts or any(x in FORBIDDEN for x in p.parts):
        return False
    if any(x.startswith('.') for x in p.parts):
        return False
    if name in EXACT:
        return True
    if not any(name.startswith(t + '/') for t in TREES):
        return False
    if name.startswith('apps/web/public/'):
        return name.removeprefix('apps/web/public/') in PUBLIC_FILES
    return p.suffix in CODE_SUFFIXES and not re.search(r'\.(test|spec)\.', p.name)


def closure(root):
    files = {}
    for name in EXACT:
        p = root / name
        require(p.is_file() and not p.is_symlink(), 'Required source closure file missing or symlinked')
        files[name] = p.read_bytes()
    for tree in TREES:
        directory = root / tree
        require(directory.is_dir() and not directory.is_symlink(), 'Required source directory missing or symlinked')
        for p in directory.rglob('*'):
            require(not p.is_symlink(), 'Source closure contains a symlink')
            if p.is_file() and allowed(p.relative_to(root).as_posix()):
                files[p.relative_to(root).as_posix()] = p.read_bytes()
    for name in files:
        require(allowed(name), 'Source is outside narrow upload allowlist')
    return files


def manifest(files):
    return {name: digest(data) for name, data in sorted(files.items())}


def private_file(path, root=None):
    p = Path(path)
    require(p.is_absolute() and p.is_file() and not p.is_symlink(), 'Private file must be a regular absolute path')
    require(stat.S_IMODE(p.stat().st_mode) == 0o600, 'Private file requires mode 600')
    resolved = p.resolve()
    if root is not None:
        require(resolved.is_relative_to(root.resolve()), 'Private file is outside permitted private directory')
    return p


def outside_repo(path):
    p = Path(path)
    require(not p.resolve().is_relative_to(ROOT.resolve()), 'This private file must be outside the repository')
    return private_file(p)


def backup_proof(receipt_path):
    receipt = json.loads(Path(receipt_path).read_bytes())
    require(receipt.get('origin') == 'single_existing_OCI_BitPOS_schema_pg_dump'
            and receipt.get('schemaOnlyScope') == 'bitpos'
            and receipt.get('archiveListVerified') is True
            and receipt.get('permissions') == '600', 'Verified own-schema backup receipt required')
    at = datetime.strptime(receipt['at'], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    require(0 <= (datetime.now(timezone.utc) - at).total_seconds() <= 3600,
            'Database backup receipt is stale; create a fresh verified backup')
    archive = Path(receipt['privatePath'])
    if not archive.is_absolute():
        archive = ROOT / archive
    archive = private_file(archive)
    data = archive.read_bytes()
    require(data.startswith(b'PGDMP') and len(data) == receipt['bytes']
            and digest(data) == receipt['sha256'], 'Database backup receipt digest mismatch')
    return {'at': at.isoformat(), 'sha256': receipt['sha256'],
            'bytes': len(data), 'archiveListVerified': True}


def run(args, data=None, timeout=300, output=None):
    # NEVER inherit stdout/stderr, even for docker build/config/inspect or SSH.
    result = subprocess.run(args, input=data, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    require(result.returncode == 0, 'Command failed; sensitive diagnostics withheld')
    return result.stdout if output is None else b''


def json_run(args):
    return json.loads(run(args))


def compose(config, *args):
    return run(['docker', 'compose', '--project-name', 'bitpos-runtime',
                '--project-directory', str(COMPOSE_DIR), '-f', str(config), *args], timeout=900)


def containers():
    result = {}
    for service in SERVICES:
        ids = run(['docker', 'ps', '-aq' if service == 'worker' else '-q',
                   '--filter', 'label=com.docker.compose.project=bitpos-runtime',
                   '--filter', 'label=com.docker.compose.service=' + service]).decode().split()
        require(len(ids) == 1, 'Exactly one existing affected service is required; only worker may be paused')
        result[service] = json_run(['docker', 'inspect', ids[0]])[0]
        require(result[service]['State']['Running'] or service == 'worker',
                'Only the deliberately quiesced worker may be stopped before cutover')
        labels = result[service]['Config']['Labels']
        require(labels.get('com.docker.compose.project.working_dir') == str(COMPOSE_DIR),
                'Existing compose identity/workdir differs; no new stack permitted')
    return result


def db_query(sql):
    ids = run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=bitpos-staging',
               '--filter', 'label=com.docker.compose.service=db']).decode().split()
    require(len(ids) == 1, 'Exactly one existing BitPOS database is required')
    return run(['docker', 'exec', '-i', ids[0], 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                '-U', 'postgres', '-d', 'postgres'], sql.encode()).decode().strip()


def migration_gate():
    names = ','.join("'" + n + "'" for n in MIGRATIONS)
    n = db_query('BEGIN READ ONLY; SELECT count(*) FROM public.bitpos_migrations WHERE name IN (' + names + '); COMMIT;')
    require(n == str(len(MIGRATIONS)), 'Apply all required BitPOS029–040 migrations using the backup-gated coordinator runner first')


def rollback_barrier():
    # Missing tables/columns also refuse rollback. No SQL mutation, no chain/RPC.
    # Treat every unresolved issued x402 binding as unsafe, even before signature.
    migration_gate()
    sql = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'x402_attempts',(SELECT count(*) FROM bitpos.x402_attempt_bindings b
   JOIN bitpos.payment_attempts a ON a.merchant_id=b.merchant_id AND a.id=b.attempt_id
   WHERE NOT (a.status='FINALIZED' OR
     (a.status IN ('FAILED','EXPIRED','REJECTED') AND a.failure_reconciled_at IS NOT NULL))),
 'sdk_pending',(SELECT count(*) FROM bitpos.x402_pending_settlements),
 'grant_lifecycle',(SELECT count(*) FROM bitpos.delegated_lifecycle
   WHERE state IN ('PREPARED','SIGNED')),
 'holds',(SELECT count(*) FROM bitpos.delegated_holds WHERE state='HELD'),
 'live_grants',(SELECT count(*) FROM bitpos.delegated_grants
   WHERE status IN ('PREPARED','ACTIVE','PAUSED','REVOKING','EXPIRED')),
 'delegate_authorizations',(SELECT count(*) FROM bitpos.delegated_authorizations d
   JOIN bitpos.payment_attempts a ON a.merchant_id=d.merchant_id AND a.id=d.attempt_id
   WHERE NOT (a.status='FINALIZED' OR
     (a.status IN ('FAILED','EXPIRED','REJECTED') AND a.failure_reconciled_at IS NOT NULL))),
 'table_visits',(SELECT count(*) FROM bitpos.table_occupancies WHERE closed_at IS NULL),
 'scoped_promotion_jobs',(SELECT count(*) FROM bitpos.ai_generation_jobs j
   JOIN bitpos.promotion_job_contexts s ON s.merchant_id=j.merchant_id AND s.job_id=j.id
   WHERE j.state IN ('QUEUED','RUNNING')),
 'published_scoped_campaigns',(SELECT count(*) FROM bitpos.promotion_campaigns c
   JOIN bitpos.promotion_scopes s ON s.merchant_id=c.merchant_id AND s.campaign_id=c.id
   WHERE c.state='APPROVED' AND c.expires_at>clock_timestamp()
     AND EXISTS(SELECT 1 FROM bitpos.promotion_playlist_targets t
       WHERE t.merchant_id=c.merchant_id AND t.campaign_id=c.id)),
 'customer_auth_sessions',(SELECT count(*) FROM bitpos.customer_auth_sessions
   WHERE revoked_at IS NULL AND expires_at>clock_timestamp())
); COMMIT;"""
    try:
        counts = json.loads(db_query(sql))
    except Exception:
        raise Refusal('Rollback refused: read-only financial barrier query unavailable; '
                      'keep target source/reconciliation; safety not established') from None
    require(all(type(n) is int and n >= 0 for n in counts.values()),
            'Rollback refused: financial barrier result invalid')
    blocking = {key: count for key, count in counts.items() if count}
    require(not blocking,
            'Rollback refused: unresolved financial barriers ' + json.dumps(blocking, sort_keys=True) +
            '; keep target source/reconciliation; owner revoke and reconcile before old-image cutover')
    return counts


def mkdir_private(path):
    require(not path.is_symlink() and path.resolve() == path and path.is_relative_to(PRIVATE),
            'Unsafe private directory identity or symlink')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path, 0o700)


def save(path, data):
    require(not path.is_symlink(), 'Private output cannot be symlinked')
    temp = path.with_name(path.name + '.new')
    with temp.open('xb') as f:
        os.chmod(temp, 0o600)
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)


def save_json(path, value):
    save(path, (json.dumps(value, indent=2) + '\n').encode())


def snapshot_sources(destination):
    # Backup source/code ONLY, plus exact infrastructure config separately.
    # No repository traversal, customer-data export or private-key copy.
    files = closure(RUNTIME)
    for name, data in files.items():
        p = destination / name
        p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        save(p, data)
    return manifest(files)


def rendered_config(source):
    return json.loads(compose(source, 'config', '--format', 'json'))


def check_mounts(config):
    for service in SERVICES:
        volumes = config['services'][service].get('volumes', [])
        delegation = [v for v in volumes if v.get('target') == '/run/bitpos/delegation']
        if service in ('api', 'worker'):
            require(len(delegation) == 1 and delegation[0]['source'] == str(PRIVATE / 'delegation')
                    and not delegation[0].get('read_only', False), 'API/worker require private delegation RW mount')
        else:
            require(not delegation, 'Only API/worker may mount delegation keys')
        require(not any(v.get('source') == str(PRIVATE) for v in volumes),
                'Whole private-directory mounts are forbidden')


def receipt_fresh(proof):
    at = datetime.fromisoformat(proof['at'])
    require(proof.get('archiveListVerified') is True and
            re.fullmatch(r'[a-f0-9]{64}', proof.get('sha256', '')) and
            0 <= (datetime.now(timezone.utc) - at).total_seconds() <= 3600,
            'Fresh digest-verified backup is required before mutation')


def inspect_evidence(expected):
    live = containers()
    evidence = {}
    for name, item in live.items():
        state = item['State']
        require(state['Running'] and not state.get('Restarting')
                and state.get('Health', {}).get('Status', 'healthy') == 'healthy',
                'Affected service is not running/healthy')
        require(item['Image'] == expected[name], 'Affected service image differs from pinned image')
        evidence[name] = {'imageId': item['Image'], 'running': True,
                          'dockerHealth': state.get('Health', {}).get('Status', 'not_defined'),
                          'restartCount': item['RestartCount']}
    return evidence


def get_body(path, port=3001):
    # Fixed loopback only; no redirect, provider or payment endpoints.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    require(port in (3001, 4321, 4323, 4324), 'Health GET port is outside existing services')
    url = 'http://127.0.0.1:' + str(port) + path
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=10) as response:
        require(response.status == 200, 'Read-only API health GET failed')
        raw = response.read(1048577)
        require(len(raw) <= 1048576, 'API health response exceeded bound')
        return raw


def get_json(path, port=3001):
    return json.loads(get_body(path, port))


def sdk_import_health():
    api = containers()['api']['Id']
    code = """import {createRequire} from 'node:module';
import fs from 'node:fs'; import path from 'node:path';
import {ExactSvmScheme} from '@x402/svm/exact/facilitator';
import {encodePaymentRequiredHeader,decodePaymentRequiredHeader} from '@x402/core/http';
const require=createRequire(import.meta.url);
for(const [name,entry] of [['@x402/core','@x402/core/http'],['@x402/svm','@x402/svm/exact/facilitator']]){
 let dir=path.dirname(require.resolve(entry)),found=false;
 while(dir!==path.dirname(dir)){const file=path.join(dir,'package.json');
  if(fs.existsSync(file)){const p=JSON.parse(fs.readFileSync(file,'utf8'));
   if(p.name===name){if(p.version!=='2.28.0')throw Error('SDK version mismatch');found=true;break;}}
  dir=path.dirname(dir);}
 if(!found)throw Error('SDK package identity unavailable');}
if(typeof ExactSvmScheme.prototype.verify!=='function'||typeof ExactSvmScheme.prototype.settle!=='function')throw Error('SDK facilitator exports missing');
const value={x402Version:2,resource:{url:'https://pay.cashlessthailand.com/health',description:'read-only codec check',mimeType:'application/json'},accepts:[]};
if(decodePaymentRequiredHeader(encodePaymentRequiredHeader(value)).x402Version!==2)throw Error('SDK HTTP codec failed');
console.log(JSON.stringify({version:'2.28.0',imports:true,httpCodec:true}));"""
    return json_run(['docker', 'exec', api, 'node', '--input-type=module', '-e', code])


def health(entry, images, target=True):
    deadline = time.monotonic() + 90
    while True:
        try:
            services = inspect_evidence(images)
            readiness = get_json('/api/demo-session')
            require(type(readiness.get('enabled')) is bool and isinstance(readiness.get('roles'), list),
                    'API application readiness shape invalid')
            catalog = get_json('/api/table/' + entry)
            menu = catalog['menu']
            require(isinstance(menu['products'], list) and len(menu['products']) > 0
                    and menu['priceVersion'] and menu['menuVersion'], 'Canonical public catalog is unavailable')
            require(all(p.get('unitPrice') and
                        re.fullmatch(r'[0-9]+', str(p['unitPrice']['amountMinor']))
                        for p in menu['products']), 'Canonical catalog price shape invalid')
            proof = {'services': services, 'apiReadinessGet': True, 'catalogGet': True,
                     'catalogProducts': len(menu['products']), 'catalogDigest': digest(json.dumps(menu, sort_keys=True).encode())}
            require(b'<html' in get_body('/', 4321).lower() and
                    b'<html' in get_body('/', 4324).lower(), 'Web/merchant HTML health unavailable')
            customer = get_json('/api/table/' + entry, 4323)
            require(customer.get('menu', {}).get('priceVersion') == menu['priceVersion'],
                    'Customer safe catalog proxy health failed')
            proof.update(webHtmlGet=True, merchantHtmlGet=True, customerCatalogGet=True)
            if target:
                occupancy = catalog.get('occupancy', {})
                require(type(occupancy.get('active')) is bool and
                        re.fullmatch(r'[1-9][0-9]*', str(occupancy.get('generation', ''))),
                        'Current public table occupancy generation unavailable')
                proof['tableOccupancyGet'] = True
            if target:
                sdk = get_json('/api/x402/supported')
                require(any(k.get('x402Version') == 2 and k.get('scheme') == 'exact'
                            and k.get('network') == NETWORK for k in sdk.get('kinds', [])),
                        'Real SDK supported endpoint missing exact devnet V2 capability')
                proof['sdkSupportedGet'] = True
                proof['sdkImportAndCodec'] = sdk_import_health()
                public_sdk = get_json('/api/x402/supported', 4323)
                require(public_sdk.get('kinds') == sdk.get('kinds'), 'Customer SDK discovery proxy differs')
            return proof
        except Exception:
            if time.monotonic() >= deadline:
                raise Refusal('Application/catalog/SDK health failed; response bodies withheld') from None
            time.sleep(3)


def install(files):
    # Affected services MUST be stopped first. Each file replacement is atomic;
    # the service cutover is not advertised as a multi-directory atomic rename.
    # Unrelated guide/tunnel/source files remain untouched, including obsolete
    # files not in the explicit closure: the target image never includes them.
    for name, data in files.items():
        require(allowed(name), 'Refusing source outside install allowlist')
        p = RUNTIME / name
        require(not p.is_symlink() and not any(x.is_symlink() for x in p.parents),
                'Runtime source path contains symlink')
        p.parent.mkdir(parents=True, exist_ok=True)
        save(p, data)


def read_sources(directory):
    m = json.loads((directory.parent / ('target-manifest.json' if directory.name == 'target-source' else 'old-manifest.json')).read_bytes())
    files = {name: (directory / name).read_bytes() for name in m}
    require(manifest(files) == m and all(allowed(name) for name in m), 'Private source snapshot digest mismatch')
    return files


def installed_hashes(files):
    actual = {name: file_digest(RUNTIME / name) for name in files}
    require(actual == manifest(files), 'Installed source hashes differ from staged source')
    return actual


@contextlib.contextmanager
def operation_lock():
    # Explicit rollback calls perform their read-only barrier BEFORE even this
    # lockfile mutation, then recheck after stopping new authorization producers.
    mkdir_private(PRIVATE / 'deployments')
    with (PRIVATE / 'deployments/operation.lock').open('a') as f:
        os.chmod(f.name, 0o600)
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refusal('Another coordinator deployment operation holds the lock') from None
        yield


def prepare(payload, directory):
    receipt_fresh(payload['backup'])
    require(not directory.exists(), 'Release already exists; choose new identity, never overwrite recovery state')
    live = containers()
    require((COMPOSE_DIR / 'compose.yaml').is_file(), 'Existing runtime compose missing')
    mkdir_private(directory)
    old = rendered_config(COMPOSE_DIR / 'compose.yaml')
    old_images = {name: item['Image'] for name, item in live.items()}
    image_archives = {}
    for name, item in live.items():
        old['services'][name]['image'] = item['Image']
        old['services'][name].pop('build', None)
        old['services'][name].pop('env_file', None)
        old['services'][name]['environment'] = dict(v.split('=', 1) for v in item['Config']['Env'])
        old['services'][name]['command'] = item['Config']['Cmd']
        if item['Config'].get('Entrypoint'):
            old['services'][name]['entrypoint'] = item['Config']['Entrypoint']
        old['services'][name]['volumes'] = [
            {'type': 'bind', 'source': mount['Source'], 'target': mount['Destination'],
             'read_only': not mount['RW']} if mount['Type'] == 'bind' else
            {'type': 'volume', 'source': mount['Name'], 'target': mount['Destination'],
             'read_only': not mount['RW']}
            for mount in item['Mounts']
        ]
    save_json(directory / 'old-container-config.json', live)
    save_json(directory / 'old-compose.json', old)
    source = directory / 'old-source'
    mkdir_private(source)
    save_json(directory / 'old-manifest.json', snapshot_sources(source))
    # Config backups include credentials, remain private and are never uploaded.
    runtime_env = private_file(PRIVATE / 'runtime.env', PRIVATE)
    save(directory / 'old-runtime.env', runtime_env.read_bytes())
    for image in sorted(set(old_images.values())):
        require(re.fullmatch(r'sha256:[a-f0-9]{64}', image), 'Running image has no immutable identity')
        archive = directory / ('image-' + image.split(':')[1] + '.tar')
        with archive.open('xb') as out:
            os.chmod(archive, 0o600)
            run(['docker', 'image', 'save', image], timeout=900, output=out)
            out.flush()
            os.fsync(out.fileno())
        image_archives[image] = file_digest(archive)
    files = {name: base64.b64decode(value, validate=True) for name, value in payload['files'].items()}
    require(manifest(files) == payload['manifest'] and all(allowed(n) for n in files), 'Upload manifest/allowlist mismatch')
    target = directory / 'target-source'
    mkdir_private(target)
    for name, data in files.items():
        p = target / name
        p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        save(p, data)
    save_json(directory / 'target-manifest.json', manifest(files))
    save(directory / 'catalog-entry.txt', payload['entry'].encode())
    state = {'phase': 'prepared', 'at': stamp(), 'oldImages': old_images,
             'imageArchives': image_archives, 'backup': payload['backup']}
    save_json(directory / 'state.json', state)
    return {'result': 'prepared', 'privateReleasePath': str(directory), 'sourceHashes': manifest(files),
            'oldImages': old_images, 'backupDigest': payload['backup']['sha256']}


def protected_services():
    result = {}
    for name, project in (('db', 'bitpos-staging'), ('guide', 'bitpos-runtime'), ('tunnel', 'bitpos-runtime')):
        ids = run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + project,
                   '--filter', 'label=com.docker.compose.service=' + name]).decode().split()
        require(len(ids) == 1, 'Existing protected service identity is unavailable')
        value = run(['docker', 'inspect', '--format',
                     '{{.Id}} {{.State.StartedAt}} {{.State.Running}}', ids[0]]).decode().strip()
        require(value.endswith(' true'), 'Protected service is not running')
        result[name] = value
    return result


def restore(directory, state):
    # MUST be first action: no source/config/image/service mutation before gate.
    rollback_barrier()
    protected = protected_services()
    target_config = directory / 'target-compose.json'
    active_config = target_config if target_config.exists() else directory / 'old-compose.json'
    compose(active_config, 'stop', *SERVICES)
    try:
        rollback_barrier()  # Fence requests that raced the first read-only gate.
    except Exception:
        compose(active_config, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', *SERVICES)
        raise Refusal('Rollback race barrier refused; target services retained for revoke/reconciliation') from None
    for image in sorted(set(state['oldImages'].values())):
        if subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode:
            archive = directory / ('image-' + image.split(':')[1] + '.tar')
            require(file_digest(archive) == state['imageArchives'][image], 'Rollback image archive digest mismatch')
            run(['docker', 'image', 'load', '-i', str(archive)], timeout=900)
    old_files = read_sources(directory / 'old-source')
    target_files = read_sources(directory / 'target-source')
    for name in target_files.keys() - old_files.keys():
        path = RUNTIME / name
        require(not path.is_symlink() and not any(p.is_symlink() for p in path.parents)
                and (not path.exists() or file_digest(path) == digest(target_files[name])),
                'Target-only source changed outside deployment; refuse deletion')
        if path.exists():
            path.unlink()  # Only files introduced by this explicit release.
    install(old_files)
    # Do not restore runtime.env over newer operator credentials. Exact previous
    # effective container environments live in private old-compose.json instead.
    compose(directory / 'old-compose.json', 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', *SERVICES)
    proof = health((directory / 'catalog-entry.txt').read_text(), state['oldImages'], target=False)
    require(protected_services() == protected, 'Protected service identity changed during rollback')
    state.update(phase='rolled_back', at=stamp())
    save_json(directory / 'state.json', state)
    return {'result': 'rolled_back', 'historyRetained': True, 'migrationsRetained': True,
            'health': proof, 'oldSourceHashes': installed_hashes(read_sources(directory / 'old-source'))}


def deploy(payload, directory):
    receipt_fresh(payload['backup'])
    migration_gate()
    state = json.loads((directory / 'state.json').read_bytes())
    require(state['phase'] == 'prepared', 'Release is not prepared; do not blindly resume interrupted mutation')
    files = read_sources(directory / 'target-source')
    protected = protected_services()
    installed_hashes(read_sources(directory / 'old-source'))
    live = containers()
    require({n: i['Image'] for n, i in live.items()} == state['oldImages'],
            'Running images changed after prepare; prepare a new release')
    target = directory / 'target-source'
    config = rendered_config(target / 'infra/oci/compose.yaml')
    # Preserve effective live credentials, devnet identity and private mounts;
    # the env_file may predate a live free-provider configuration.
    for name, item in live.items():
        service = config['services'][name]
        live_environment = dict(v.split('=', 1) for v in item['Config']['Env'])
        environment = {**live_environment, **service.get('environment', {})}
        for key in ('BITPOS_AI_PROVIDER_URL', 'BITPOS_AI_MODEL', 'BITPOS_AI_API_KEY', 'BITPOS_AI_FALLBACK_API_KEY', 'DEVNET_PRIVATE_DIR'):
            if key in live_environment:
                environment[key] = live_environment[key]
        # Explicit operator-supplied rotation, never inferred from repo files.
        if name in ('api', 'worker'):
            environment.update(payload.get('providerKeys', {}))
        service['environment'] = environment
        service.pop('env_file', None)
        volumes = service.setdefault('volumes', [])
        for mount in item['Mounts']:
            if mount['Type'] != 'bind' or not Path(mount['Source']).is_relative_to(PRIVATE):
                continue
            same = [v for v in volumes if v.get('target') == mount['Destination']]
            if same:
                require(same[0]['source'] == mount['Source'] and
                        bool(same[0].get('read_only', False)) == (not mount['RW']),
                        'Target compose changes an existing private mount identity')
            else:
                volumes.append({'type': 'bind', 'source': mount['Source'],
                                'target': mount['Destination'], 'read_only': not mount['RW']})
    check_mounts(config)
    mkdir_private(PRIVATE / 'delegation')
    tag = 'bitpos-runtime:coffee-' + directory.name
    run(['docker', 'build', '--tag', tag, '--file', str(target / 'infra/oci/Dockerfile'), str(target)], timeout=1800)
    image = json_run(['docker', 'image', 'inspect', tag])[0]['Id']
    images = {name: image if name in ('api', 'web', 'worker') else state['oldImages'][name] for name in SERVICES}
    for name in SERVICES:
        config['services'][name]['image'] = images[name]
        config['services'][name].pop('build', None)
    receipt_fresh(payload['backup'])
    target_config = directory / 'target-compose.json'
    save_json(target_config, config)
    state.update(phase='cutover_started', targetImages=images, backup=payload['backup'], at=stamp())
    save_json(directory / 'state.json', state)
    try:
        compose(target_config, 'stop', *SERVICES)
        install(files)
        compose(target_config, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', *SERVICES)
        hashes = installed_hashes(files)
        proof = health(payload['entry'], images)
        require(protected_services() == protected, 'Protected service identity changed during deployment')
        state.update(phase='deployed', at=stamp())
        save_json(directory / 'state.json', state)
        result = {'result': 'deployed', 'sourceHashes': hashes, 'images': images,
                  'backupDigest': payload['backup']['sha256'], 'health': proof,
                  'protectedServicesUnchanged': list(protected)}
        save_json(directory / 'evidence.json', result)
        return result
    except Exception:
        try:
            result = restore(directory, state)
            save_json(directory / 'failure.json', {'result': 'deploy_failed_safe_rollback', 'rollback': result})
            raise Refusal('Deployment failed; barrier-safe rollback completed') from None
        except Exception as error:
            if isinstance(error, Refusal) and str(error) == 'Deployment failed; barrier-safe rollback completed':
                raise
            blocker = str(error) if isinstance(error, Refusal) else 'Rollback command failed; sensitive diagnostics withheld'
            # Refuse old-image cutover. Converge to target source and target
            # services so the actual new worker can still reconcile journals.
            # Leave a running target worker alone on an unsafe barrier. Repair
            # target source/services only when cutover or rollback was partial.
            target_running = False
            try:
                installed_hashes(files)
                target_running = all(item['Image'] == images[name]
                                     for name, item in containers().items())
            except Exception:
                pass
            if not target_running:
                try:
                    compose(target_config, 'stop', *SERVICES)
                except Exception:
                    raise Refusal('Deployment/rollback service stop failed; keep private target snapshots; '
                                  'coordinator must restore target reconciliation safely') from None
                install(files)
            recovery_started = target_running
            if not target_running:
                try:
                    compose(target_config, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', *SERVICES)
                    recovery_started = True
                except Exception:
                    pass
            state.update(phase='target_retained_reconciliation_required', at=stamp())
            save_json(directory / 'state.json', state)
            save_json(directory / 'failure.json', {'result': state['phase'], 'blocker': blocker,
                      'targetSourceRetained': True, 'targetServicesStartCommandSucceeded': recovery_started})
            raise Refusal('Deployment failed; ' + blocker + '; target source retained; '
                          'inspect private failure receipt and reconcile before retry') from None


def provider_export():
    # Isolated opt-in; no env dump/logging/network/provider request.
    item = containers()['api']
    values = dict(v.split('=', 1) for v in item['Config']['Env'])
    keys = ('BITPOS_AI_PROVIDER_URL', 'BITPOS_AI_MODEL', 'BITPOS_AI_API_KEY')
    configured = all(values.get(k) for k in keys)
    if configured:
        mkdir_private(PRIVATE / 'proof')
        save_json(PRIVATE / 'proof/coffee-provider-env.json', {k: values[k] for k in (*keys, 'BITPOS_AI_FALLBACK_API_KEY') if values.get(k)})
    return {'configured': configured}


def remote_main(payload):
    os.umask(0o077)
    require(PRIVATE.is_dir() and PRIVATE.resolve() == PRIVATE and not PRIVATE.is_symlink(),
            'Existing outside-repository private root required')
    require(RUNTIME.is_dir() and RUNTIME.resolve() == RUNTIME, 'Existing runtime/source identity required')
    if payload['action'] == 'provider':
        return provider_export()
    release = payload['release']
    require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', release), 'Invalid release identity')
    directory = PRIVATE / 'deployments' / release
    receipt_fresh(payload['backup'])
    if payload['action'] == 'rollback':
        rollback_barrier()  # Before lockfile, evidence or ANY mutation.
    with operation_lock():
        if payload['action'] == 'prepare':
            return prepare(payload, directory)
        if payload['action'] == 'deploy':
            return deploy(payload, directory)
        require(payload['action'] == 'rollback', 'Unknown explicit operation')
        state = json.loads((directory / 'state.json').read_bytes())
        require(state['phase'] in ('deployed', 'cutover_started', 'target_retained_reconciliation_required'),
                'Release is not eligible for rollback')
        result = restore(directory, state)
        save_json(directory / 'rollback-evidence.json', result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    flags = parser.add_mutually_exclusive_group()
    flags.add_argument('--prepare', action='store_true')
    flags.add_argument('--deploy', action='store_true')
    flags.add_argument('--rollback', action='store_true')
    flags.add_argument('--private-provider-env', action='store_true')
    parser.add_argument('--release')
    parser.add_argument('--backup-receipt')
    parser.add_argument('--catalog-entry-file')
    parser.add_argument('--provider-keys-file', help='Explicit outside-repo mode600 JSON key rotation for deploy only')
    args = parser.parse_args()
    action = ('prepare' if args.prepare else 'deploy' if args.deploy else
              'rollback' if args.rollback else 'provider' if args.private_provider_env else None)
    if action is None:
        print(json.dumps({'result': 'prerequisites_only_no_operations',
            'required': ['coordinator explicit operation authorization', 'existing OCI runtime/private identity',
                         'fresh <=1h verified pg_dump receipt + matching local mode600 archive',
                         'private mode600 current table-entry token file outside repo',
                         '029–041 applied separately before deploy',
                         'existing affected services identified; worker may be deliberately paused; exact rollback image snapshots',
                         'rollback requires all grants owner-revoked and every pending journal/hold reconciled'],
            'runtime': str(COMPOSE_DIR), 'privateReleaseRoot': str(PRIVATE / 'deployments'),
            'delegationDirectory': str(PRIVATE / 'delegation'),
            'providerExportFile': str(PRIVATE / 'proof/coffee-provider-env.json'),
            'noExecutionEvidence': True}, indent=2))
        return
    payload = {'action': action}
    if args.provider_keys_file:
        require(action == 'deploy', 'Provider rotation is deploy-only')
        keys = json.loads(outside_repo(Path(args.provider_keys_file).absolute()).read_text())
        require(set(keys) == {'BITPOS_AI_API_KEY', 'BITPOS_AI_FALLBACK_API_KEY'} and
                all(isinstance(v, str) and re.fullmatch(r'AIza[0-9A-Za-z_-]{35}', v) for v in keys.values()) and
                len(set(keys.values())) == 2, 'Invalid explicit provider key rotation')
        payload['providerKeys'] = keys
    if action != 'provider':
        require(args.release and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', args.release), 'Explicit release identity required')
        payload['release'] = args.release
    if action in ('prepare', 'deploy', 'rollback'):
        require(args.backup_receipt, 'Fresh digest-verified database backup receipt required')
        payload['backup'] = backup_proof(args.backup_receipt)
    if action in ('prepare', 'deploy'):
        require(args.catalog_entry_file, 'Private catalog entry file required')
        entry = outside_repo(Path(args.catalog_entry_file).absolute()).read_text().strip()
        require(re.fullmatch(r'[A-Za-z0-9_-]{43}', entry), 'Current private table-entry token must be 43 characters')
        payload['entry'] = entry
    if action == 'prepare':
        files = closure(ROOT)
        payload.update(files={n: base64.b64encode(v).decode() for n, v in files.items()}, manifest=manifest(files))
    # Only this single tool's source and the validated source closure are sent.
    # No tar of the repository, .env, .omp, DB backups or key material.
    source = Path(__file__).read_text()
    program = source.rsplit("\nif __name__ == '__main__':", 1)[0]
    program += '\ntry:\n    print(json.dumps(remote_main(' + repr(payload) + ')))\n'
    program += "except Refusal as error:\n    print(json.dumps({'result':'refused','reason':str(error)}))\n    sys.exit(2)\n"
    program += "except Exception:\n    print(json.dumps({'result':'refused','reason':'Operation failed; sensitive diagnostics withheld; retain recovery files'}))\n    sys.exit(2)\n"
    # __file__ is absent for python stdin. Supply the observed canonical runtime
    # path solely to initialize ROOT; remote paths remain hardcoded above.
    program = "__file__='/home/ubuntu/bitpos-runtime/tools/runtime/coffee-copilot-deploy.py'\n" + program
    result = subprocess.run([*SSH, 'python3 -'], input=program.encode(), stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=3600)
    try:
        evidence = json.loads(result.stdout)
    except Exception:
        raise Refusal('SSH operation failed without a sanitized receipt; do not blindly retry cutover') from None
    print(json.dumps(evidence, indent=2))
    require(result.returncode == 0, 'Remote operation refused; see sanitized reason above')


if __name__ == '__main__':
    try:
        main()
    except Refusal as error:
        print(json.dumps({'result': 'refused', 'reason': str(error)}), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print(json.dumps({'result': 'refused', 'reason': 'Operation failed; sensitive diagnostics withheld'}), file=sys.stderr)
        sys.exit(2)
