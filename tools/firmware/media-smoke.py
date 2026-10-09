#!/usr/bin/env python3
"""Exercise actual bounded firmware GIF scan/readonly callbacks; not decoder/hardware proof."""
import json
import subprocess
import tempfile
from pathlib import Path
source = Path('device/firmware/main/bitpos_media.c').read_text()
shape = source[source.index('typedef struct {\n    const char *name;'):source.index('static DSTATUS media_disk_status')]
scan = source[source.index('static uint16_t le16'):source.index('static bool digest_matches')]
readonly_write = source[source.index('static DRESULT media_disk_write'):source.index('static DRESULT media_disk_ioctl')]
header = '#include <stdbool.h>\n#include <stdint.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\ntypedef unsigned char BYTE;typedef unsigned DWORD;typedef unsigned UINT;typedef int DRESULT;\n#define RES_WRPRT 2\n'
main = r'''
int main(int argc,char **argv) {
    if(argc!=3)return 3;
    unsigned i=(unsigned)atoi(argv[1]);if(i>=4)return 3;
    FILE *f=fopen(argv[2],"rb");if(!f)return 3;
    if(fseek(f,0,SEEK_END))return 3;long size=ftell(f);rewind(f);
    if(size<0||size>131072)return 3;
    uint8_t *data=malloc((size_t)size);if(!data)return 3;
    if(fread(data,1,(size_t)size,f)!=(size_t)size)return 3;fclose(f);
    bool ok=gif_bounds(data,(size_t)size,&approved[i]);
    if(ok) {
        uint8_t rgb[3],canvas[12],original[12];
        if(!first_transparent_background(data,(size_t)size,rgb))return 4;
        for(unsigned p=0;p<3;p++){canvas[p*4]=rgb[2];canvas[p*4+1]=rgb[1];canvas[p*4+2]=rgb[0];canvas[p*4+3]=255;}
        canvas[4]^=1;canvas[11]=128;memcpy(original,canvas,sizeof(canvas));
        if(clear_initial_background(canvas,sizeof(canvas),rgb)!=1||canvas[3]!=0||
           memcmp(canvas+4,original+4,8))return 5;
        /* Ambiguous opaque palette entries must refuse the adapter rather than
         * erase art. This semantic fixture does not run the LZW decoder. */
        uint8_t fixture[]={ 'G','I','F','8','9','a',1,0,1,0,0x80,0,0,
                            1,2,3,4,5,6,0x21,0xf9,4,1,7,0,0,0,
                            0x2c,0,0,0,0,1,0,1,0,0 };
        if(!first_transparent_background(fixture,sizeof(fixture),rgb))return 6;
        memcpy(fixture+16,fixture+13,3);
        if(first_transparent_background(fixture,sizeof(fixture),rgb))return 7;
    }
    free(data);
    if(media_disk_write(0,NULL,0,0)!=RES_WRPRT)return 3;
    puts(ok?"accepted":"rejected");return 0;
}
'''
manifest = json.loads(Path('motion-lab/assets/gif/manifest.json').read_text())
by_name = {row['path']:row for row in manifest}
results=[]
with tempfile.TemporaryDirectory(prefix='bitpos-media-smoke-') as directory:
    path=Path(directory)
    (path/'smoke.c').write_text(header+shape+scan+readonly_write+main)
    subprocess.run(['cc','-std=c11','-fsanitize=address,undefined','-g',str(path/'smoke.c'),'-o',str(path/'smoke')],check=True,capture_output=True)
    for i,name in enumerate(['coffee-128.gif','sparkles-128.gif','party-popper-128.gif','confetti-128.gif']):
        data=Path('motion-lab/assets/gif',name).read_bytes()
        cases=[('approved',data,True),('truncated',data[:-1],False),('trailing_garbage',data+b'x',False)]
        altered=bytearray(data);altered[6:8]=(129).to_bytes(2,'little');cases.append(('oversize_canvas',bytes(altered),False))
        altered=bytearray(data);altered[:6]=b'GIF87a';cases.append(('wrong_header',bytes(altered),False))
        for case,value,expected in cases:
            target=path/'input.gif';target.write_bytes(value)
            actual=subprocess.run([str(path/'smoke'),str(i),str(target)],text=True,capture_output=True,check=True).stdout.strip()
            assert actual==('accepted' if expected else 'rejected'),(name,case,actual)
            results.append({'asset':name,'case':case,'result':actual})
proof={'origin':'compiled_actual_firmware_media_boundary_host_sanitizer','cases':results,'readonly_write_rejected':True,'transparent_background_assets_verified':4,'opaque_pixels_preserved':True,'ambiguous_palette_refused':True,'decoder_rerun':False,'physical_claim':False}
Path('.omp/work/evidence/firmware-media-smoke.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps({'cases':len(results),'passed':len(results),'transparent_background_assets_verified':4,'opaque_pixels_preserved':True,'ambiguous_palette_refused':True,'readonly_write_rejected':True,'physical_claim':False}))
subprocess.run(['python3', 'tools/firmware/photo-media-smoke.py'], check=True)
