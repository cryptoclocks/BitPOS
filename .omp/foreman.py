#!/usr/bin/env python3
"""BitPOS readiness and independent review gates. Never reads private credentials."""
import argparse, hashlib, json, subprocess, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / '.omp/work'
REQUIRED = ('build', 'tenant_roles', 'wallet_challenge', 'customer_guest_avatar',
            'payment_rejections', 'sponsored_devnet', 'settlement_restart',
            'device_reconnect_dedup', 'wallet_browser_contract', 'demo_10_rounds', 'physical_ack_30')

def load(path):
    return json.loads(path.read_text())

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)

def fingerprint():
    names = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
    digest = hashlib.sha256()
    for name in sorted(set(names)):
        if not name or not (name.startswith(('apps/', 'packages/', 'device/firmware/', 'supabase/', 'infra/', 'tools/runtime/', '.omp/loop/')) or name in ('package.json', 'pnpm-lock.yaml', 'tsconfig.json', '.omp/foreman.py', '.omp/config.yml')):
            continue
        path = ROOT / name
        if not path.is_file():
            digest.update((name + ':missing').encode())
            continue
        digest.update(name.encode() + b'\0' + path.read_bytes())
    return digest.hexdigest()

def evidence_path(name):
    path = (ROOT / name).resolve()
    if not path.is_relative_to((WORK / 'evidence').resolve()) or not path.is_file() or path.stat().st_size == 0:
        raise ValueError('Missing or invalid non-secret evidence: ' + name)
    return path

def readiness():
    acceptance = load(WORK / 'acceptance.json')
    if acceptance.get('source_fingerprint') != fingerprint():
        raise ValueError('Acceptance belongs to different source')
    checks = acceptance.get('checks', {})
    digest = hashlib.sha256(json.dumps(acceptance, sort_keys=True).encode())
    for name in REQUIRED:
        check = checks.get(name, {})
        if check.get('status') != 'pass' or not check.get('evidence'):
            raise ValueError('Required verification has not passed: ' + name)
        for item in check['evidence']:
            path = evidence_path(item)
            digest.update(item.encode() + b'\0' + path.read_bytes())
    deferred = acceptance.get('deferred', {})
    if deferred.get('android_phantom') != 'User deferred physical phone scanning/payment on 2026-10-08':
        raise ValueError('Record the explicit physical phone deferral; do not claim it passed')
    if checks['demo_10_rounds'].get('successful_rounds', 0) < 10:
        raise ValueError('Ten successful demo rounds required')
    ack = checks['physical_ack_30']
    if ack.get('origin') != 'physical_esp32' or ack.get('samples', 0) < 30 or not 0 <= ack.get('p95_ms', 1000) < 1000:
        raise ValueError('Physical render ACK latency evidence is incomplete')
    return digest.hexdigest()

def gate():
    evidence = readiness()
    request = load(WORK / 'loop/review-request.json')
    report = load(ROOT / request['report_path'])
    provenance = load(WORK / 'loop/review-provenance.json')
    for key, expected in (('review_id', request['review_id']), ('source_fingerprint', fingerprint()),
                          ('evidence_fingerprint', evidence), ('model', 'openai-codex/gpt-6.1-sol'), ('thinking', 'high')):
        if report.get(key) != expected or provenance.get(key) != expected:
            raise ValueError('Wrong or stale review/provenance: ' + key)
    if not provenance.get('session_id') or provenance.get('reviewer_finished') is not True:
        raise ValueError('Independent native reviewer has not finished')
    if report.get('verdict') != 'pass' or report.get('findings') != [] or not report.get('verification'):
        raise ValueError('Independent review has not passed')
    return {'status': 'complete', 'source_fingerprint': fingerprint(), 'review_id': request['review_id']}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('fingerprint', 'ready', 'prepare-review', 'gate', 'status'))
    args = parser.parse_args()
    try:
        if args.command == 'fingerprint':
            result = {'source_fingerprint': fingerprint()}
        elif args.command == 'ready':
            result = {'status': 'ready', 'evidence_fingerprint': readiness()}
        elif args.command == 'prepare-review':
            evidence = readiness()
            identity = uuid.uuid4().hex
            result = {'review_id': identity, 'source_fingerprint': fingerprint(), 'evidence_fingerprint': evidence,
                      'model': 'openai-codex/gpt-6.1-sol', 'thinking': 'high', 'report_path': '.omp/work/reviews/' + identity + '.json'}
            save(WORK / 'loop/review-request.json', result)
        elif args.command == 'gate':
            result = gate()
        else:
            result = load(WORK / 'checkpoint.json')
        print(json.dumps(result))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'status': 'not_ready', 'reason': str(error)}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
