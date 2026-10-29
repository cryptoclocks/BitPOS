// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editImage,parseSam,samCount} from '../apps/api/src/meta/vision';

const cfg={baseUrl:'https://api.meta.example/v1',apiKey:'k',model:'x'};
const jpg='data:image/jpeg;base64,/9j/AAAA';

test('SAM output: boxes of the first frame, sizes, confidences; empty output is zero',()=>{
 const t='<0f>0<|box;x1=10;y1=20;x2=110;y2=90;w=800;h=533|><|mask;x=0;y=0;data=46,101,~abc|>,2<|box;x1=200;y1=20;x2=300;y2=90;w=800;h=533;c=0.9|><|mask;x=0;y=0;data=1,1,~a|>';
 const p=parseSam(t);assert.equal(p.boxes.length,2);assert.deepEqual([p.w,p.h],[800,533]);assert.equal(p.boxes[1].c,0.9);
 assert.equal(parseSam('').boxes.length,0);
});

test('SAM count: streamed deltas are joined; low-confidence boxes dropped; bad input never sent',async()=>{
 let sent:any=null;
 const f=async(_u:string,i:RequestInit)=>{sent=JSON.parse(String(i.body));const ev=(d:string)=>`event: x\ndata: ${JSON.stringify({type:'response.output_text.delta',delta:d})}\n\n`;
  return new Response(ev('<0f>0<|box;x1=1;y1=1;x2=5;y2=5;w=10;h=10|><|mask;x=0;y=0;data=1,1,~a|>')+ev(',1<|box;x1=6;y1=6;x2=9;y2=9;w=10;h=10;c=0.1|><|mask;x=0;y=0;data=1,1,~a|>'),{status:200});};
 const r=await samCount(cfg,jpg,'Croissant',f);assert.equal(r.count,1);assert.equal(sent.model,'sam-3.1');assert.equal(sent.input[0].content[0].text,'croissant');
 await assert.rejects(samCount(cfg,'https://evil.example/a.jpg','croissant',f));await assert.rejects(samCount(cfg,jpg,'<script>',f));
});

test('Muse Image edit: b64 or data URL results, type sniffed; empty or odd results refused',async()=>{
 const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47]),Buffer.alloc(200)]);
 const ok=await editImage(cfg,jpg,'badge',async()=>new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}),{status:200}));assert.equal(ok.mime,'image/png');
 const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),Buffer.alloc(200)]);
 assert.equal((await editImage(cfg,jpg,'badge',async()=>new Response(JSON.stringify({data:[{url:'data:image/webp;base64,'+webp.toString('base64')}]}),{status:200}))).mime,'image/webp');
 await assert.rejects(editImage(cfg,jpg,'badge',async()=>new Response(JSON.stringify({data:[]}),{status:200})));
 await assert.rejects(editImage(cfg,jpg,'badge',async()=>new Response('{}',{status:500})));
});
