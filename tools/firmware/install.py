#!/usr/bin/env python3
"""Coordinator-only partial installation. Preserve original bootloader/NVS/OTA/FAT."""
import argparse, hashlib, os, sys, tempfile
from pathlib import Path
from provision import BACKUP_HASH, OFFSET, SIZE, PORT, identity, partition_entries, run

EXPECTED = [('nvs',1,2,0x9000,0x5000),('otadata',1,0,0xe000,0x2000),('app0',0,16,0x10000,0x200000),('app1',0,17,0x210000,0x200000),('ffat',1,129,0x410000,0xbe0000)]

def resume_verified_app(tool):
    # Identity probes deliberately retain bootloader mode; successful app-only
    # updates (including no-write convergence) must return to the owned runtime.
    base=identity(tool)
    base[base.index('--after')+1]='hard_reset'
    run(base+['read_mac'])

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--esptool',type=Path,required=True)
    p.add_argument('--build',type=Path,default=Path('device/firmware/build'))
    p.add_argument('--buildtarget',choices=('bitpos_terminal.bin','bitpos_sd_maintenance.bin'),default='bitpos_terminal.bin',help='Explicit own runtime or temporary SD maintenance app; maintenance is app-only')
    p.add_argument('--write',action='store_true')
    p.add_argument('--update-app',action='store_true',help='Update only owned app0, preserving provisioned NVS/dedup')
    args=p.parse_args();os.umask(0o077)
    if args.buildtarget!='bitpos_terminal.bin' and not args.update_app:raise RuntimeError('Maintenance firmware is restricted to an app-only update')
    original=Path('local/private/device-original.bin').read_bytes()
    if len(original)!=16*1024*1024 or hashlib.sha256(original).hexdigest()!=BACKUP_HASH:raise RuntimeError('Original recoverable backup mismatch')
    entries=partition_entries(original[0x8000:0x9000])
    if entries!=EXPECTED+[('coredump',1,3,OFFSET,SIZE)] or original[OFFSET:]!=b'\xff'*SIZE:raise RuntimeError('Unexpected original layout or populated coredump')
    table=(args.build/'partition_table/partition-table.bin').read_bytes()
    if partition_entries(table)!=EXPECTED+[('bitpos_nvs',1,2,OFFSET,SIZE)]:raise RuntimeError('Built layout must preserve all original regions except erased coredump ownership')
    app=args.build/args.buildtarget;image=app.read_bytes()
    if image[0]!=0xe9 or len(image)>0x200000:raise RuntimeError('Application does not fit original app0 slot')
    if not args.write:
        print('Recoverable layout/application checks passed; no USB writes.');return
    base=identity(args.esptool)
    if args.update_app:
        recovery=Path('local/private/device-preinstall.bin')
        if not recovery.is_file() or recovery.stat().st_size!=len(original) or recovery.stat().st_mode&0o077:raise RuntimeError('Private preinstall recovery backup required')
        with tempfile.TemporaryDirectory(prefix='bitpos-app-update-') as directory:
            active=Path(directory)/'table.bin';run(base+['read_flash','0x8000','0x1000',str(active)])
            if partition_entries(active.read_bytes())!=partition_entries(table):raise RuntimeError('Active owned layout mismatch')
            previous=Path(directory)/'previous.bin';run(base+['read_flash','0x10000','0x200000',str(previous)])
            if previous.read_bytes()[:len(image)]==image:
                resume_verified_app(args.esptool)
                print('Owned app0 already matches build; runtime resumed, no flash write.');return
            saved=Path('local/private/device-pre-update-'+hashlib.sha256(previous.read_bytes()).hexdigest()[:16]+'.bin')
            saved.write_bytes(previous.read_bytes());saved.chmod(0o600)
            base=identity(args.esptool)
            run(base+['write_flash','0x10000',str(app)])
            verified=Path(directory)/'verify.bin';run(base+['read_flash','0x10000',hex(len(image)),str(verified)])
            if verified.read_bytes()!=image:raise RuntimeError('Owned app0 update readback mismatch')
            resume_verified_app(args.esptool)
        print('Owned app0 updated, byte-verified and runtime resumed; provisioning/dedup and all other partitions unchanged.');return
    # Preserve the current device state too: the original app may update private NVS after backup.
    current=Path('local/private/device-preinstall.bin')
    if current.exists():raise RuntimeError('Preinstall backup already exists; reconcile prior installation instead of repeating')
    print('Identity accepted; reading current full private preinstall backup before any flash write.',flush=True)
    run(base+['read_flash','0','0x1000000',str(current)])
    current.chmod(0o600);before=current.read_bytes()
    if len(before)!=len(original) or partition_entries(before[0x8000:0x9000])!=entries or before[OFFSET:]!=b'\xff'*SIZE:raise RuntimeError('Current layout/owned region changed; no writes performed')
    if before[0xe000:0xe004]!=b'\x01\x00\x00\x00':raise RuntimeError('Expected original OTA selection app0')
    # Recheck identity immediately before each separate USB write. Never erase whole flash.
    for offset,path in [(0x8000,args.build/'partition_table/partition-table.bin'),(0x10000,app)]:
        base=identity(args.esptool)
        run(base+['--after','no_reset','write_flash',hex(offset),str(path)])
        with tempfile.TemporaryDirectory(prefix='bitpos-install-') as directory:
            readback=Path(directory)/'verify.bin';run(base+['--after','no_reset','read_flash',hex(offset),hex(path.stat().st_size),str(readback)])
            if readback.read_bytes()!=path.read_bytes():raise RuntimeError('Partial installation readback mismatch')
    print('BitPOS table/app0 byte-verified. Original bootloader/NVS/OTA/app1/FAT preserved; private preinstall backup retained. Provision own NVS next.')

if __name__=='__main__':
    try:main()
    except Exception:
        print('Partial installation refused/failed; reconcile private preinstall backup and device state before retry. No secret tool output.',file=sys.stderr);sys.exit(1)
