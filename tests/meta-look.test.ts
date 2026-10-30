// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Shop look (migration 327): colour contrast and image checks, saved per shop (RLS), and customer pages render the
// shop's colour, logo, name and cover. Needs META_TEST_DATABASE_URL (migrations 001–327).
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import type {MetaDb} from '../apps/api/src/meta/identity';
import {LOOK,LookError,PRESETS,lookImage,saveLook,shopLook,sniffImage,whiteContrast,withLook} from '../apps/api/src/meta/look';
import {customerHtml} from '../apps/api/src/meta/ui';

const url=process.env.META_TEST_DATABASE_URL;
const skip=!url&&'META_TEST_DATABASE_URL not set';
const M=randomUUID(),OTHER='00000000-0000-4000-8000-000000000002',OWNER=randomUUID();
let admin:pg.Pool,app:pg.Pool,db:MetaDb;
// A real 1×1 PNG, padded past the 100-byte minimum with a text chunk.
const PNG=Buffer.concat([Buffer.from('89504E470D0A1A0A0000000D4948445200000001000000010806000000','hex'),Buffer.alloc(120,0x20)]);
const JPEG=Buffer.concat([Buffer.from([0xFF,0xD8,0xFF,0xE0]),Buffer.alloc(200,1)]);

before(async()=>{
 if(skip)return;
 admin=new pg.Pool({connectionString:url,max:2,options:'-c search_path=bitpos,public'});
 app=new pg.Pool({connectionString:url,max:4,options:'-c search_path=bitpos,public'});
 db={query:(sql,params)=>app.query(sql,params as any[]),tenant:async(merchant,fn)=>{const c=await app.connect();try{await c.query('SET ROLE bitpos_app');await c.query('BEGIN');await c.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 await admin.query("INSERT INTO merchants(id,name,treasury) SELECT $1,'Look Test Café',treasury FROM merchants WHERE id=$2",[M,OTHER]);
});
after(async()=>{if(!skip){await admin.end();await app.end();}});

test('colour and image checks: presets keep white text readable; pale colours and fake images are refused',()=>{
 for(const [c] of PRESETS)assert.ok(whiteContrast(c)>=4.5,c);
 assert.ok(whiteContrast('#FFE600')<4.5);
 assert.equal(sniffImage(PNG),'image/png');assert.equal(sniffImage(JPEG),'image/jpeg');
 assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),null,'SVG (scriptable) is not an accepted image');
});

test('save and show: defaults, then colour, tagline, cover and logo; other shops unaffected; customer page uses them',{skip},async()=>{
 let v=await shopLook(db,M);
 assert.deepEqual([v.name,v.accent,v.coverUrl,v.logoUrl],['Look Test Café','#0866FF',null,null]);
 await assert.rejects(saveLook(db,M,OWNER,{tagline:'',accent:'#FFE600'}),(e:unknown)=>e instanceof LookError&&e.code==='LOW_CONTRAST');
 await assert.rejects(saveLook(db,M,OWNER,{tagline:'',accent:'#6D28D9',cover:Buffer.from('<svg>'.padEnd(200,' '))}),(e:unknown)=>e instanceof LookError&&e.code==='BAD_IMAGE');
 await saveLook(db,M,OWNER,{tagline:'Slow coffee by the river',accent:'#6d28d9',cover:JPEG,logo:PNG});
 v=await shopLook(db,M);
 assert.equal(v.accent,'#6D28D9');assert.equal(v.tagline,'Slow coffee by the river');
 assert.match(v.coverUrl!,new RegExp(`^/meta/look/${M}/cover-\\d+\\.jpg$`));assert.match(v.logoUrl!,/logo-\d+\.png$/);
 assert.deepEqual((await lookImage(db,M,'cover'))?.mime,'image/jpeg');
 // Removing the logo keeps the cover.
 await saveLook(db,M,OWNER,{tagline:'Slow coffee by the river',accent:'#6D28D9',logo:null});
 v=await shopLook(db,M);assert.equal(v.logoUrl,null);assert.ok(v.coverUrl);
 assert.equal((await shopLook(db,OTHER)).tagline,'','another shop keeps its own look (RLS)');
 const html=await withLook(db,M,async()=>customerHtml({title:'x'},'<p>body</p>'));
 assert.match(html,/--p:#6D28D9/);assert.match(html,/<meta name="theme-color" content="#6D28D9">/);assert.match(html,/Look Test Café · ร้านเดโม/);
 assert.doesNotMatch(LOOK.run(null,()=>customerHtml({title:'x'},'')),/--p:#6D28D9/,'without a shop the BitPOS theme stays');
});
