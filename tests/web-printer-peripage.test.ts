import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import zlib from 'node:zlib';
import {PERIPAGE_A9SMAX,adler32,buildImageJob,buildPrintPackets,chunk,contentDots,deflateWindow1k,packRaster,wireDensity} from '../apps/web/src/lib/printer/peripage';

// The reference job is the one the owner confirmed on the physical PeriPage_A9sMAX_BLE (firmware V1.17_HD) on 2026-11-04:
// 1200x360, header 1f00 0096 0168 00000556, compressed with a 1 KiB window and the zlib header removed.
const confirmed=new Uint8Array(readFileSync(new URL('./fixtures/printer/a9smax-confirmed-image-job.bin',import.meta.url)));
const decode=(job:Uint8Array)=>{
 const dv=new DataView(job.buffer,job.byteOffset,job.byteLength),rowBytes=dv.getUint16(2),height=dv.getUint16(4),len=dv.getUint32(6),payload=job.subarray(10);
 assert.equal(job[0],0x1f);assert.equal(job[1],0x00);assert.equal(payload.length,len);
 const raw=zlib.inflateRawSync(payload.subarray(0,payload.length-4),{windowBits:10});
 assert.equal(dv.getUint32(10+len-4),adler32(new Uint8Array(raw)),'Adler-32 trailer');
 return {rowBytes,height,raw:new Uint8Array(raw)};
};

test('the confirmed hardware job decodes with a 1 KiB window and its Adler-32 matches',()=>{
 const d=decode(confirmed);assert.equal(d.rowBytes,150);assert.equal(d.height,360);assert.equal(d.raw.length,150*360);
 assert.equal(Buffer.from(confirmed.subarray(0,10)).toString('hex'),'1f000096016800000556');
});
test('re-encoding the confirmed raster gives a valid job with the same framing and the identical raster',()=>{
 const base=decode(confirmed),mine=buildImageJob(base.raw,1200,360),d=decode(mine);
 assert.deepEqual(Array.from(mine.subarray(0,6)),[0x1f,0,0,0x96,0x01,0x68]);
 assert.deepEqual(d.raw,base.raw);
 assert.ok(mine.length<base.raw.length/10,'strongly compressed ('+mine.length+' bytes)');
});
test('deflate keeps every back-reference inside a 1024-byte window for hard inputs',()=>{
 const rnd=new Uint8Array(150*400);let x=12345;for(let i=0;i<rnd.length;i++){x=(x*1103515245+12345)&0x7fffffff;rnd[i]=(x>>16)&0xff;}
 const mixed=new Uint8Array(150*400);for(let i=0;i<mixed.length;i++)mixed[i]=(i%150<30)?(i*7)&0xff:(i%3?0:0xff);
 for(const raw of [rnd,mixed,new Uint8Array(150*400),new Uint8Array(150*7).fill(0xff),Uint8Array.of(1)]){
  const out=deflateWindow1k(raw);assert.deepEqual(new Uint8Array(zlib.inflateRawSync(out,{windowBits:10})),raw);
 }
});
test('wire density follows the model profile: UI 0/1/2 is sent as 0/2/4',()=>{
 assert.deepEqual([0,1,2].map(d=>wireDensity(d as 0|1|2)),[0,2,4]);
 const p=buildPrintPackets(confirmed,2);
 assert.deepEqual(Array.from(p[0]!),[0x10,0xff,0xfe,0x01]);assert.deepEqual(Array.from(p[1]!),[0x10,0xff,0xfd,0x00]);assert.deepEqual(Array.from(p[2]!),[0x10,0xff,0x10,0x00,0x04]);
 assert.deepEqual(Array.from(buildPrintPackets(confirmed,0)[2]!),[0x10,0xff,0x10,0x00,0x00]);
 assert.deepEqual(Array.from(buildPrintPackets(confirmed,1)[2]!),[0x10,0xff,0x10,0x00,0x02]);
});
test('packets: 100-byte writes, nothing larger than the observed 133-byte limit, and they reassemble to the job',()=>{
 const p=buildPrintPackets(confirmed,2);assert.ok(p.every(x=>x.length<=PERIPAGE_A9SMAX.chunkBytes));
 const joined=Buffer.concat(p.slice(3).map(x=>Buffer.from(x)));assert.deepEqual(new Uint8Array(joined),confirmed);
 assert.equal(chunk(new Uint8Array(250)).length,3);
});
test('packRaster: black is 1, MSB first, threshold on the average over white; transparent is white',()=>{
 const w=8,h=1,px=new Uint8ClampedArray(w*4);const set=(i:number,r:number,g:number,b:number,a=255)=>{px.set([r,g,b,a],i*4);};
 set(0,0,0,0);set(1,255,255,255);set(2,128,128,128);set(3,129,129,129);set(4,0,0,0,0);set(5,255,0,0);set(6,0,0,0,255);set(7,255,255,255);
 assert.equal(packRaster(px,w,h)[0],0b10100110);
 assert.throws(()=>packRaster(new Uint8ClampedArray(7*4),7,1),/RASTER_SIZE_INVALID/);
});
test('buildImageJob refuses widths and lengths the tested profile does not cover',()=>{
 assert.throws(()=>buildImageJob(new Uint8Array(100*10),800,10),/ROW_WIDTH_UNSUPPORTED/);
 assert.throws(()=>buildImageJob(new Uint8Array(150*(PERIPAGE_A9SMAX.maxRows+1)),1200,PERIPAGE_A9SMAX.maxRows+1),/RECEIPT_TOO_LONG/);
 assert.throws(()=>buildImageJob(new Uint8Array(10),1200,1),/RASTER_SIZE_INVALID/);
 const ok=buildImageJob(new Uint8Array(150*PERIPAGE_A9SMAX.maxRows),1200,PERIPAGE_A9SMAX.maxRows);assert.ok(ok.length>10);
});
test('content width in dots: whole bytes, at most the 1200-dot row',()=>{
 assert.equal(contentDots(107),1200);assert.ok(contentDots(80)%8===0&&contentDots(80)<1200&&contentDots(80)>=900);assert.ok(contentDots(58)%8===0&&contentDots(58)>=640);assert.equal(contentDots(500),1200);
});
