#!/usr/bin/env python3
"""Actual photo startup loader with host filesystem/SHA and allocator adapters."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import os
ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'device/firmware/main/bitpos_media.c').read_text()
state = source[source.index('#define PHOTO_ROOT'):source.index('typedef struct {\n    const char *name;')]
loader = source[source.index('static bool preload_photos'):source.index('void bitpos_media_init')]
header = r'''
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <CommonCrypto/CommonDigest.h>
#include "bitpos_menu_assets.generated.h"
#define PSRAM_CAPS 1
#define LV_IMAGE_HEADER_MAGIC 0x19
#define LV_COLOR_FORMAT_RGB565 18
#define ESP_LOGI(...) ((void)0)
static const char *TAG="host-adapter";
typedef struct {struct {unsigned magic,cf,w,h,stride;} header;size_t data_size;const uint8_t *data;} lv_image_dsc_t;
static size_t available,largest,reserve_after;static unsigned allocations,yields,opens;static const char *root;
static bool esp_psram_is_initialized(void){return true;}
static bool esp_ptr_external_ram(void *p){return p!=NULL;}
static size_t heap_caps_get_free_size(int caps){(void)caps;return available;}
static size_t heap_caps_get_largest_free_block(int caps){(void)caps;return largest;}
static void *heap_caps_malloc(size_t size,int caps){(void)caps;void *p=malloc(size);if(p){++allocations;available=reserve_after;}return p;}
static void heap_caps_free(void *p){if(p){assert(allocations);--allocations;free(p);}}
static void vTaskDelay(unsigned ticks){assert(ticks==1);++yields;}
static const char *mapped(const char *path){static char buffer[1024];const char *prefix="/sdcard/bitpos/menu/v1/";size_t n=strlen(prefix);assert(!strncmp(path,prefix,n));assert(snprintf(buffer,sizeof(buffer),"%s/%s",root,path+n)<(int)sizeof(buffer));return buffer;}
static int mapped_stat(const char *p,struct stat *s){return stat(mapped(p),s);}
static FILE *mapped_fopen(const char *p,const char *mode){++opens;return fopen(mapped(p),mode);}
#define stat(p,s) mapped_stat(p,s)
#define fopen(p,m) mapped_fopen(p,m)
typedef CC_SHA256_CTX mbedtls_sha256_context;
static void mbedtls_sha256_init(mbedtls_sha256_context *c){memset(c,0,sizeof(*c));}
static void mbedtls_sha256_free(mbedtls_sha256_context *c){memset(c,0,sizeof(*c));}
static int mbedtls_sha256_starts(mbedtls_sha256_context *c,int x){(void)x;return CC_SHA256_Init(c)?0:-1;}
static int mbedtls_sha256_update(mbedtls_sha256_context *c,const uint8_t *d,size_t n){return CC_SHA256_Update(c,d,(CC_LONG)n)?0:-1;}
static int mbedtls_sha256_finish(mbedtls_sha256_context *c,uint8_t *d){return CC_SHA256_Final(d,c)?0:-1;}
'''
main = r'''
int main(int argc,char **argv){
 assert(argc==3);root=argv[1];available=PHOTO_SLAB_BYTES+PHOTO_RESERVE;largest=PHOTO_SLAB_BYTES;reserve_after=PHOTO_RESERVE;
 bool expected=!strcmp(argv[2],"valid");
 if(!strcmp(argv[2],"free_gate"))available--;
 if(!strcmp(argv[2],"largest_gate"))largest--;
 if(!strcmp(argv[2],"postalloc_reserve"))reserve_after--;
 assert(preload_photos()==expected);assert(bitpos_media_photos_available()==expected);
 if(expected){
  assert(allocations==1&&yields==12*47);unsigned before=opens;
  const lv_image_dsc_t *first=bitpos_media_photo(0);assert(first);
  for(unsigned i=0;i<12;i++){
   const lv_image_dsc_t *p=bitpos_media_photo(i);assert(p&&p->header.w==480&&p->header.h==200&&p->header.stride==960&&p->data_size==192000);
   assert(p->data==first->data+i*192000&&bitpos_media_photo(i)==p);
  }
  assert(!bitpos_media_photo(12)&&opens==before);heap_caps_free((void *)first->data);
 }else{assert(!allocations);for(unsigned i=0;i<12;i++)assert(!bitpos_media_photo(i));}
 puts(argv[2]);return 0;
}
'''
checks = []
manifest = json.loads((ROOT / 'data/menu-assets.json').read_text())
with tempfile.TemporaryDirectory(prefix='bitpos-photo-media-') as directory:
    temp = Path(directory); (temp / 'smoke.c').write_text(header + state + loader + main)
    subprocess.run(['cc', '-std=c11', '-fsanitize=address,undefined', '-Wno-deprecated-declarations',
                    '-I' + str(ROOT / 'device/firmware/main'), str(temp / 'smoke.c'), '-o', str(temp / 'smoke')],
                   check=True, capture_output=True)
    for case in ('valid', 'missing', 'truncated', 'trailing', 'corrupt', 'free_gate', 'largest_gate', 'postalloc_reserve'):
        assets = temp / case; assets.mkdir()
        for row in manifest['assets']:
            shutil.copyfile(ROOT / 'local/menu-assets/v1' / row['file'], assets / row['file'])
        last = assets / manifest['assets'][-1]['file']
        if case == 'missing': last.unlink()
        if case == 'truncated': last.write_bytes(last.read_bytes()[:-1])
        if case == 'trailing': last.write_bytes(last.read_bytes() + b'x')
        if case == 'corrupt':
            data = bytearray(last.read_bytes()); data[17] ^= 1; last.write_bytes(data)
        result = subprocess.run([str(temp / 'smoke'), str(assets), case], text=True, capture_output=True,
                                check=True, env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=0'})
        assert result.stdout.strip() == case; checks.append(case)
proof = {'origin': 'actual_photo_loader_host_fs_sha_allocator_adapters', 'checks': checks,
         'physical_sd_memory_or_render_claim': False}
(ROOT / '.omp/work/evidence/photo-media-smoke.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
