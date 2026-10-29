import {test} from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';import {createHash} from 'node:crypto';
import {normalizeChatImage,CHAT_IMAGE_LIMITS,ChatImageError} from '../apps/api/src/chat-image-normalizer';
const image=()=>sharp({create:{width:24,height:16,channels:3,background:'#654288'}}).jpeg().toBuffer();
const code=(expected:string)=>(error:unknown)=>error instanceof ChatImageError&&error.code===expected;
test('JPEG orientation is applied, metadata stripped and stored digest matches exact raster bytes',async()=>{
 const source=await sharp({create:{width:24,height:16,channels:3,background:'#654288'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 const before=await sharp(source).metadata();assert.ok(before.exif);assert.equal(before.orientation,6);
 const output=await normalizeChatImage(source,'image/jpeg'),meta=await sharp(output.bytes).metadata();
 assert.equal(output.width,16);assert.equal(output.height,24);assert.equal(output.mime,'image/jpeg');assert.equal(meta.format,'jpeg');
 assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);assert.equal(meta.orientation,undefined);
 assert.equal(output.sha256,createHash('sha256').update(output.bytes).digest('hex'));assert.equal(output.sourceSha256,createHash('sha256').update(source).digest('hex'));assert.equal(output.byteLength,output.bytes.length);
 assert.deepEqual((await normalizeChatImage(source,'image/jpeg')).bytes,output.bytes);
});
test('PNG is decoded and re-encoded into a bounded JPEG without source trailing bytes',async()=>{
 const png=await sharp({create:{width:2560,height:1280,channels:4,background:{r:120,g:40,b:200,alpha:0.3}}}).png().toBuffer();
 const marker=Buffer.from('SYNTHETIC_PRIVATE_TRAILING_MARKER'),source=Buffer.concat([png,marker]);
 const output=await normalizeChatImage(source,'image/png');assert.equal(output.width,1280);assert.equal(output.height,640);assert.ok(output.byteLength<=CHAT_IMAGE_LIMITS.storedBytes);assert.equal(output.bytes.includes(marker),false);assert.equal((await sharp(output.bytes).metadata()).format,'jpeg');
});
test('declared MIME mismatch, vectors, empty and truncated files are refused',async()=>{
 const jpeg=await image();await assert.rejects(normalizeChatImage(jpeg,'image/png'),code('CHAT_IMAGE_INVALID'));
 await assert.rejects(normalizeChatImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>fixture</script></svg>'),'image/svg+xml'),code('CHAT_IMAGE_INVALID'));
 await assert.rejects(normalizeChatImage(Buffer.alloc(0),'image/jpeg'),code('CHAT_IMAGE_INVALID'));
 await assert.rejects(normalizeChatImage(jpeg.subarray(0,jpeg.length-40),'image/jpeg'),code('CHAT_IMAGE_INVALID'));
});
test('byte and pixel budgets reject oversized sources before output',async()=>{
 await assert.rejects(normalizeChatImage(Buffer.alloc(CHAT_IMAGE_LIMITS.sourceBytes+1),'image/jpeg'),code('CHAT_IMAGE_TOO_LARGE'));
 const bomb=await sharp({create:{width:5000,height:4000,channels:3,background:'#ffffff'}}).png().toBuffer();assert.ok(bomb.length<CHAT_IMAGE_LIMITS.sourceBytes);
 await assert.rejects(normalizeChatImage(bomb,'image/png'),code('CHAT_IMAGE_TOO_LARGE'));
});
test('only two decodes are admitted concurrently and failures release admission',async()=>{
 const source=await image();const results=await Promise.allSettled([normalizeChatImage(source,'image/jpeg'),normalizeChatImage(source,'image/jpeg'),normalizeChatImage(source,'image/jpeg')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected?.status==='rejected'&&code('CHAT_IMAGE_BUSY')(rejected.reason));
 assert.equal((await normalizeChatImage(source,'image/jpeg')).mime,'image/jpeg');
});
