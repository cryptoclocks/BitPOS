#!/usr/bin/env python3
"""Local durable omp/Codex mailbox. No inference, scheduler calls or process control."""
import argparse,fcntl,hashlib,json,os,re
from datetime import datetime,timezone
from pathlib import Path
APP=Path(__file__).resolve().parent.parent
ROOT=APP/'.omp/work/codex-bridge'
KINDS=('blocked','needs_operator','needs_codex','review_ready','review_result','complete','handoff')
def atomic(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');os.chmod(tmp,0o600);os.replace(tmp,path)
def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='op',required=True)
    pub=sub.add_parser('publish');pub.add_argument('--kind',choices=KINDS,required=True);pub.add_argument('--message',required=True);pub.add_argument('--evidence',action='append',default=[])
    sub.add_parser('pending');ack=sub.add_parser('ack');ack.add_argument('id')
    args=p.parse_args();ROOT.mkdir(parents=True,exist_ok=True)
    with (ROOT/'.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if args.op=='publish':
            if not args.message.strip() or len(args.message)>3000:raise ValueError('Message must be 1-3000 characters')
            if re.search(r'(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|(?:access_token|refresh_token|client_secret|password|api_key)\s*[=:]\s*[^\s]+)',args.message,re.I):raise ValueError('Do not publish credentials')
            if len(args.evidence)>8:raise ValueError('At most eight evidence paths')
            paths=[]
            for item in args.evidence:
                f=(APP/item).resolve()
                if not f.is_relative_to(APP) or not f.is_file() or any(t in f.name.lower() for t in ('.env','secrets','credential','keystore','private','token')):raise ValueError('Evidence must be a non-secret file in mobile checkout')
                paths.append(str(f.relative_to(APP)))
            payload={'kind':args.kind,'message':args.message.strip(),'evidence':paths}
            identity=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            target=ROOT/'outbox'/(identity+'.json')
            if not target.exists():atomic(target,dict(payload,id=identity,created_at=datetime.now(timezone.utc).isoformat(),source='omp_untrusted_message'))
            print(json.dumps({'id':identity,'queued':True}));return
        if args.op=='ack':
            if not re.fullmatch('[a-f0-9]{64}',args.id) or not (ROOT/'outbox'/(args.id+'.json')).is_file():raise ValueError('Unknown event')
            atomic(ROOT/'ack'/(args.id+'.json'),{'id':args.id,'handled_at':datetime.now(timezone.utc).isoformat()});print('{"acknowledged":true}');return
        entries=[]
        for f in sorted((ROOT/'outbox').glob('*.json')):
            if (ROOT/'ack'/f.name).exists():continue
            if f.stat().st_size>16000:continue
            try:v=json.loads(f.read_text())
            except (OSError,ValueError):continue
            if v.get('id')!=f.stem or v.get('kind') not in KINDS:continue
            entries.append(v)
        print(json.dumps({'pending':entries[:20],'total':len(entries)},ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except ValueError as error:raise SystemExit(str(error))
