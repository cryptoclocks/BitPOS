#!/usr/bin/env python3
"""Actual SD publication/receive functions plus host framing; no hardware claims."""
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/firmware'))
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
capture=load('capture_frame','tools/firmware/capture-frame.py')
sd=load('motion_sd','tools/firmware/provision-motion-sd.py')
assets=sd.sources()
checks=[]
# Verify the real host receiver rejects malformed identity/length/attribution,
# not a source-text assertion or a simulated physical render.
pixels=bytes(capture.MAX_BYTES)
header=bytearray(128);header[:16]=capture.MAGIC
struct.pack_into('<HHHHIIQ',header,16,128,480,320,1,len(pixels),1,1000000)
header[40:46]=bytes.fromhex('14c19f4e6248');header[56:61]=b'0.2.1'
header[88:120]=capture.hashlib.sha256(pixels).digest()
class Stream:
    def __init__(self,data):self.data=bytearray(data)
    def read(self,count):
        data=bytes(self.data[:count]);del self.data[:count]
        if not data:raise capture.CaptureError('fixture_truncated')
        return data
valid=bytes(header)+pixels+capture.TRAILER
actual,metadata=capture.receive(Stream(valid),'0.2.1')
assert actual==pixels and metadata['origin']=='physical_esp32_lvgl_framebuffer'
checks.append('host_valid_protocol_fixture_not_physical')
for name,offset,value in [('wrong_mac',40,0),('wrong_version',56,ord('9')),('zero_flush',28,0),('bad_size',24,header[24]^1),('bad_sha',88,header[88]^1),('reserved_metadata',120,1)]:
    bad=bytearray(valid);bad[offset]=value
    try:capture.receive(Stream(bad),'0.2.1')
    except capture.CaptureError:checks.append(name)
    else:raise AssertionError(name+' accepted')
for name,data in [('truncated_payload',valid[:200]),('bad_trailer',valid[:-1]+b'!')]:
    try:capture.receive(Stream(data),'0.2.1')
    except capture.CaptureError:checks.append(name)
    else:raise AssertionError(name+' accepted')

nonce=bytes([1])*16
report=bytes.fromhex('14c19f4e6248')+bytes([1,len(sd.ASSETS)])+bytes(len(sd.ASSETS))
assert len(sd.Session().report(report)['files'])==17
checks.append('protocol2_seventeen_asset_report')
for name,kwargs in [
    ('maintenance_old_protocol',{'version':1}),
    ('maintenance_wrong_nonce',{'nonce':bytes([2])*16}),
    ('maintenance_wrong_request',{'request':2}),
    ('maintenance_wrong_asset',{'asset':0}),
    ('maintenance_oversized_response',{'length':26}),
    ('maintenance_response_digest',{'digest':bytes([1])*32}),
    ('maintenance_wrong_mac',{'payload':bytes(6)+report[6:]}),
]:
    fields={'version':sd.PROTOCOL,'nonce':nonce,'request':1,'asset':255,'length':25,'digest':bytes(32),'payload':report};fields.update(kwargs)
    session=sd.Session();session.nonce=nonce
    session.buffer.extend(sd.HEADER.pack(b'BPSD',fields['version'],0x81,sd.OK,fields['asset'],fields['request'],fields['nonce'],fields['length'],fields['digest'])+fields['payload'])
    try:session.response(sd.STATUS,255,1,sd.time.monotonic()+1)
    except sd.Refused:checks.append(name)
    else:raise AssertionError(name+' accepted')
with tempfile.TemporaryDirectory(prefix='bitpos-sd-receipt-') as directory:
    original_receipt=sd.RECEIPT;sd.RECEIPT=Path(directory)/'identity.json'
    receipt={'schema':1,'purpose':'bitpos-motion-sd','mac':sd.MAC,'port':sd.PORT,'flash_bytes':16777216,'psram_bytes':8388608,'issued_at':int(sd.time.time())}
    for name,alteration in [('stale_identity_receipt',{'issued_at':int(sd.time.time())-1801}),('wrong_identity_receipt',{'mac':'00:00:00:00:00:00'})]:
        sd.RECEIPT.write_text(json.dumps({**receipt,**alteration}));sd.RECEIPT.chmod(0o600)
        try:sd.receipt_value()
        except sd.Refused:checks.append(name)
        else:raise AssertionError(name+' accepted')
    sd.RECEIPT=original_receipt
with tempfile.TemporaryDirectory(prefix='bitpos-public-source-') as directory:
    original_root=sd.ROOT;sd.ROOT=Path(directory)
    for (name,_,_,base),data in zip(sd.ASSETS,assets):
        folder=sd.ROOT/base;folder.mkdir(parents=True,exist_ok=True);(folder/name).write_bytes(data)
    target=sd.ROOT/sd.ASSETS[0][3]/sd.ASSETS[0][0]
    corrupt=bytearray(assets[0]);corrupt[0]^=1;target.write_bytes(corrupt)
    try:sd.sources()
    except sd.Refused:checks.append('public_source_hash_mismatch_refused')
    else:raise AssertionError('corrupt approved source accepted')
    sd.ROOT=original_root

# Compile unchanged actual functions. SDK dependencies are deterministic host
# adapters; filesystem and SHA256 are real, with a temporary /sdcard sandbox.
source=(ROOT/'tools/firmware/sd-maintenance/main/sd_maintenance.c').read_text()
shape=source[source.index('typedef struct { const char *name;'):source.index('static bool send_bytes')]
publication=source[source.index('static bool directories'):source.index('void app_main')]
header_c=r'''
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <CommonCrypto/CommonDigest.h>
#include "bitpos_menu_assets.generated.h"
#define MOTION_ROOT "/sdcard/bitpos/motion/v1"
#define MENU_ROOT "/sdcard/bitpos/menu/v1"
#define COUNT (5+BITPOS_MENU_ASSET_COUNT)
#define HEADER 64
#define MAX_FILE BITPOS_MENU_PHOTO_BYTES
#define RECEIVE_US 30000000LL
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
enum { SD_OK=0,READY=1,NOOP=2,CONFLICT=3,IO_ERROR=4,INVALID=5,TIMED_OUT=6,NO_MEMORY=7 };
enum { MISSING=0,MATCH=1,UNKNOWN=2,UNREADABLE=3,WRITE=2 };
typedef CC_SHA256_CTX mbedtls_sha256_context;
static void mbedtls_sha256_init(mbedtls_sha256_context *c){memset(c,0,sizeof(*c));}
static void mbedtls_sha256_free(mbedtls_sha256_context *c){memset(c,0,sizeof(*c));}
static int mbedtls_sha256_starts(mbedtls_sha256_context *c,int x){(void)x;return CC_SHA256_Init(c)?0:-1;}
static int mbedtls_sha256_update(mbedtls_sha256_context *c,const uint8_t *d,size_t n){return CC_SHA256_Update(c,d,(CC_LONG)n)?0:-1;}
static int mbedtls_sha256_finish(mbedtls_sha256_context *c,uint8_t *d){return CC_SHA256_Final(d,c)?0:-1;}
static int mbedtls_sha256(const uint8_t *d,size_t n,uint8_t *h,int x){(void)x;return CC_SHA256(d,(CC_LONG)n,h)?0:-1;}
static int64_t esp_timer_get_time(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (int64_t)t.tv_sec*1000000+t.tv_nsec/1000;}
static const char *sandbox;
static const char *mapped(const char *path){static char slots[2][1024];static unsigned index;if(strncmp(path,"/sdcard",7))return path;char *slot=slots[index++%2];assert(snprintf(slot,1024,"%s%s",sandbox,path+7)<1024);return slot;}
static int mapped_stat(const char *p,struct stat *s){return stat(mapped(p),s);}
static int mapped_open(const char *p,int flags,...){int mode=0;if(flags&O_CREAT){va_list args;va_start(args,flags);mode=va_arg(args,int);va_end(args);}return open(mapped(p),flags,mode);}
static int mapped_mkdir(const char *p,mode_t mode){return mkdir(mapped(p),mode);}
static int mapped_unlink(const char *p){return unlink(mapped(p));}
static int mapped_rename(const char *a,const char *b){struct stat s;if(stat(mapped(b),&s)==0){errno=EEXIST;return -1;}return rename(mapped(a),mapped(b));}
static bool fail_write;
static ssize_t mapped_write(int fd,const void *p,size_t n){if(fail_write){fail_write=false;errno=EIO;return -1;}return write(fd,p,n);}
#define stat(a,b) mapped_stat(a,b)
#define open(...) mapped_open(__VA_ARGS__)
#define mkdir(a,b) mapped_mkdir(a,b)
#define unlink(a) mapped_unlink(a)
#define rename(a,b) mapped_rename(a,b)
#define write(a,b,c) mapped_write(a,b,c)
static uint8_t last_result;
static unsigned allocations;
static bool no_memory,receive_timeout;
static const uint8_t *receive_data;
static void *heap_caps_malloc(size_t n,int caps){(void)caps;if(no_memory)return NULL;void *p=malloc(n);if(p)++allocations;return p;}
static void heap_caps_free(void *p){if(p){assert(allocations>0);--allocations;free(p);}}
static bool reply(uint8_t op,uint8_t result,uint8_t id,uint32_t request,bool report){(void)op;(void)id;(void)request;(void)report;last_result=result;return true;}
static bool receive(void *p,uint32_t n,int64_t until){(void)until;if(receive_timeout)return false;memcpy(p,receive_data,n);return true;}
static void abandon_session(void){}
'''
main_c=r'''
static void put_file(const char *path,const uint8_t *data,size_t n){int fd=open(path,O_CREAT|O_TRUNC|O_WRONLY,0600);assert(fd>=0);assert(write(fd,data,n)==(ssize_t)n);assert(close(fd)==0);}
int main(int argc,char **argv){
 assert(argc==4);sandbox=argv[1];mounted=true;init_assets();unsigned id=(unsigned)atoi(argv[3]);assert(id<COUNT);
 FILE *input=fopen(argv[2],"rb");assert(input);uint8_t *data=malloc(assets[id].size);assert(data);assert(fread(data,1,assets[id].size,input)==assets[id].size);assert(fgetc(input)==EOF&&fclose(input)==0);
 char dest[96],temp[96];asset_path(id,dest);snprintf(temp,sizeof(temp),"%s/.bitpos-sd-v2-%u.tmp",asset_root(id),id);
 assert(publish(id,data)==SD_OK&&file_state(id,dest)==MATCH);
 refresh_report();assert(report[7]==17&&report[8+id]==MATCH);
 struct stat before,after;assert(stat(dest,&before)==0);assert(publish(id,data)==NOOP);assert(stat(dest,&after)==0);assert(before.st_mtimespec.tv_sec==after.st_mtimespec.tv_sec&&before.st_mtimespec.tv_nsec==after.st_mtimespec.tv_nsec);puts("matching_noop_preserves_file");
 assert(unlink(dest)==0);put_file(dest,(const uint8_t *)"unknown",7);assert(publish(id,data)==CONFLICT);assert(stat(dest,&after)==0&&after.st_size==7);puts("unknown_destination_preserved");assert(unlink(dest)==0);
 put_file(temp,(const uint8_t *)"unknown",7);assert(publish(id,data)==CONFLICT);assert(stat(temp,&after)==0&&after.st_size==7);puts("unknown_staging_preserved");assert(unlink(temp)==0);
 put_file(temp,data,64);assert(publish(id,data)==SD_OK&&file_state(id,dest)==MATCH);assert(stat(temp,&after)<0&&errno==ENOENT);puts("authenticated_partial_staging_converges");assert(unlink(dest)==0);
 uint8_t *wrong=malloc(assets[id].size+1);assert(wrong);memcpy(wrong,data,assets[id].size);wrong[0]^=1;put_file(temp,wrong,assets[id].size);assert(publish(id,data)==CONFLICT);assert(stat(temp,&after)==0&&after.st_size==assets[id].size);assert(unlink(temp)==0);puts("corrupt_full_staging_preserved");
 put_file(temp,wrong,assets[id].size+1);assert(publish(id,data)==CONFLICT);assert(stat(temp,&after)==0&&after.st_size==assets[id].size+1);assert(unlink(temp)==0);puts("oversized_staging_preserved");
 fail_write=true;assert(publish(id,data)==IO_ERROR);assert(file_state(id,dest)==MISSING);assert(publish(id,data)==SD_OK&&file_state(id,dest)==MATCH);assert(unlink(dest)==0);puts("write_failure_then_convergence");
 uint8_t h[HEADER]={0};h[7]=id;put32(h+8,1);put32(h+28,assets[id].size);expected_hash(id,h+32);receive_data=data;
 h[7]=COUNT;handle_write(h);assert(last_result==INVALID&&!allocations&&file_state(id,dest)==MISSING);h[7]=id;puts("invalid_asset_no_mutation");
 h[32]^=1;handle_write(h);assert(last_result==INVALID&&!allocations&&file_state(id,dest)==MISSING);h[32]^=1;puts("wrong_expected_hash_no_mutation");
 put32(h+28,assets[id].size-1);handle_write(h);assert(last_result==INVALID&&!allocations&&file_state(id,dest)==MISSING);put32(h+28,assets[id].size);puts("wrong_size_no_mutation");
 no_memory=true;handle_write(h);assert(last_result==NO_MEMORY&&!allocations&&file_state(id,dest)==MISSING);no_memory=false;puts("no_psram_no_mutation");
 receive_timeout=true;handle_write(h);assert(last_result==TIMED_OUT&&!allocations&&file_state(id,dest)==MISSING);receive_timeout=false;puts("receive_timeout_no_mutation");
 receive_data=wrong;handle_write(h);assert(last_result==INVALID&&!allocations&&file_state(id,dest)==MISSING);receive_data=data;puts("unauthenticated_payload_no_mutation");
 handle_write(h);assert(last_result==SD_OK&&!allocations&&file_state(id,dest)==MATCH);handle_write(h);assert(last_result==NOOP&&!allocations&&file_state(id,dest)==MATCH);puts("authenticated_publish_and_retry");
 free(wrong);free(data);return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='bitpos-helper-smoke-') as directory:
    temp=Path(directory);sandbox=temp/'sd';sandbox.mkdir()
    (temp/'smoke.c').write_text(header_c+shape+publication+main_c)
    compile_result=subprocess.run(['cc','-std=c11','-fsanitize=address,undefined','-g','-Wno-deprecated-declarations','-I'+str(ROOT/'device/firmware/main'),str(temp/'smoke.c'),'-o',str(temp/'smoke')],text=True,capture_output=True)
    if compile_result.returncode:raise RuntimeError(compile_result.stderr)
    for asset,(name,_,_,base) in enumerate(sd.ASSETS):
        result=subprocess.run([str(temp/'smoke'),str(sandbox),str(ROOT/base/name),str(asset)],text=True,capture_output=True,env={**os.environ,'ASAN_OPTIONS':'detect_leaks=0'})
        if result.returncode:raise RuntimeError(result.stdout+result.stderr)
        checks.extend(name+':'+check for check in result.stdout.strip().splitlines())
proof={'origin':'actual_product_functions_host_sandbox','checks':checks,'passed':len(checks),'sanitizers':['ASan','UBSan'],'leak_sanitizer':'Unsupported on this macOS; disabled. Packet allocation balance is asserted explicitly.','physical_usb_sd_gif_or_touch_claim':False}
(ROOT/'.omp/work/evidence/helper-safety-smoke.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof))
