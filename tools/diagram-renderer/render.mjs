import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {render} from 'pele';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'docs/diagrams/bitpos-20261024');
const specs=[
 ['01-system','ภาพรวมระบบ','ส่วนประกอบตามโค้ด ไม่ใช่การรับรองว่าทุก integration พร้อมใช้งาน'],
 ['02-food-order','ขั้นตอนสั่งอาหาร','เส้นทางที่ระบบต้องรองรับ; หลักฐานแต่ละส่วนไม่แทนการผ่านทั้ง flow'],
 ['03-payment-recovery','ยืนยันเงินและกู้คืน','server เป็นผู้ยืนยันเงิน; unknown outcome ต้อง reconcile คำขอเดิม'],
 ['04-ui-development','การแบ่งงานพัฒนา UI','Customer / Rider / POS ทำขนาน; ทรัพยากรที่ใช้ร่วมกันจัดคิว']
];
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const hash=b=>createHash('sha256').update(b).digest('hex');
const theme='--pele-bg:#ffffff;--pele-fg:#29183f;--pele-muted:#665b76;--pele-line:#8263ad;--pele-surface:#f3edf9;--pele-surface-alt:#fff4e8;--pele-border:#cbbadd;--pele-accent:#7145d6;--pele-font:Arial,sans-serif;--pele-radius:12px';
await mkdir(out,{recursive:true});
const manifest={renderer:'pele',version:JSON.parse(await readFile(new URL('./node_modules/pele/package.json',import.meta.url),'utf8')).version,generatedAt:new Date().toISOString(),purpose:'Source-oriented explanatory diagrams, not runtime or end-to-end acceptance',diagrams:[],references:{}};
const sections=[];
for (const [id,title,note] of specs){
 const source=await readFile(join(out,id+'.mmd'),'utf8');
 const result=render(source,{idPrefix:id+'-',fontFamily:'Arial',fontSize:15,padding:28,links:false,images:false});
 if(!result.svg.startsWith('<svg')||!Number.isFinite(result.width)||!Number.isFinite(result.height)||result.width<=0||result.height<=0)throw Error('Invalid render: '+id);
 // Keep Pele's own internal --_* aliases; duplicate style attributes drop them in HTML.
 const svg=result.svg.replace('<svg ',`<svg role="img" aria-label="${escape(title)}" `).replace('style="',`style="${theme};`);
 await writeFile(join(out,id+'.svg'),svg+'\n');
 manifest.diagrams.push({id,type:result.type,width:result.width,height:result.height,sourceSha256:hash(source),svgSha256:hash(svg+'\n')});
 sections.push(`<section class="pane" id="${id}" ${sections.length?'hidden':''} aria-label="${escape(title)}"><div class="caption"><div><h2>${escape(title)}</h2><p>${escape(note)}</p></div><a href="${id}.svg">เปิด SVG ↗</a></div><div class="viewport" tabindex="0" aria-label="เลื่อนดูแผนภาพ ${escape(title)}">${svg}</div><details><summary>Mermaid source</summary><pre>${escape(source)}</pre></details></section>`);
}
const refs=['docs/CHECKPOINT.md','apps/api/src/index.ts','apps/api/src/orders.ts','apps/api/src/fulfillment.ts','apps/api/src/mobile-food.ts','apps/worker/src/index.ts','apps/worker/src/food-dispatch.ts','apps/mobile-customer/lib/food_page.dart','apps/mobile-driver/lib/food_work_page.dart','apps/web/src/components/IncomingOrders.tsx','apps/web/src/components/Payment.tsx'];
for(const p of refs)manifest.references[p]=hash(await readFile(join(root,p)));
await copyFile(new URL('./node_modules/pele/LICENSE',import.meta.url),join(out,'pele-LICENSE.txt'));
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const html=`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>BitPOS · System diagrams</title><style>
*{box-sizing:border-box}body{margin:0;background:#f8f5fc;color:#29183f;font:16px/1.6 system-ui,sans-serif}header,main{max-width:1440px;margin:auto;padding:28px 32px}header{padding-bottom:12px}h1{font-size:32px;margin:0}header p{color:#665b76;margin:8px 0}.eyebrow{color:#7145d6;font-weight:700;font-size:13px;letter-spacing:.08em}.status{display:inline-block;background:#fff2dd;color:#754300;border:1px solid #e7cc94;border-radius:8px;padding:8px 12px;font-size:14px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0 12px}button,a{font:inherit}button{border:1px solid #d7c9e8;border-radius:10px;padding:10px 16px;min-height:44px;background:white;color:#503569;cursor:pointer}button[aria-pressed=true]{background:#64188a;color:white;border-color:#64188a}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #ff8500;outline-offset:3px}.tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px}.tools span{color:#665b76;font-size:14px}.pane{background:white;border:1px solid #e5dced;border-radius:20px;overflow:hidden;box-shadow:0 6px 24px #29183f06}.pane[hidden]{display:none}.caption{padding:20px 24px;display:flex;justify-content:space-between;align-items:start;gap:16px;border-bottom:1px solid #eee7f5}.caption h2{font-size:22px;margin:0}.caption p{margin:4px 0 0;color:#665b76;font-size:14px}a{color:#64188a;text-underline-offset:4px;white-space:nowrap}.viewport{overflow:auto;padding:20px;max-height:76vh;min-height:340px;overscroll-behavior:contain}.viewport svg{display:block;max-width:none;height:auto;margin:0 auto}details{border-top:1px solid #eee7f5;padding:14px 24px}summary{cursor:pointer;color:#64188a}pre{white-space:pre;overflow:auto;padding:16px;background:#f8f5fc;border-radius:10px;font:13px/1.6 ui-monospace,monospace}footer{color:#665b76;font-size:13px;margin-top:16px}footer a{white-space:normal}@media(max-width:600px){header,main{padding:20px 16px}header{padding-bottom:0}h1{font-size:26px}.caption{padding:16px;display:block}.caption a{display:inline-block;margin-top:10px}.viewport{padding:8px}.tools button{padding:8px 12px}}
</style><header><div class="eyebrow">BITPOS / ENGINEERING MAP</div><h1>แผนภาพการทำงานของ BitPOS</h1><p>จากแอพลูกค้าและไรเดอร์ สู่หน้าร้านและข้อมูลฝั่ง server</p><div class="status">เอกสารอธิบายโครงสร้าง · ไม่ใช่หลักฐานว่าทุกฟีเจอร์เสร็จแล้ว · 24 ต.ค. 2026</div></header><main><nav aria-label="เลือกแผนภาพ">${specs.map(([id,title],i)=>`<button type="button" data-target="${id}" aria-controls="${id}" aria-pressed="${i===0}">${escape(title)}</button>`).join('')}</nav><div class="tools"><button id="fit" type="button">พอดีหน้าจอ</button><button id="minus" type="button" aria-label="ซูมออก">−</button><button id="plus" type="button" aria-label="ซูมเข้า">+</button><span id="zoom" aria-live="polite"></span></div>${sections.join('')}<footer>สร้างด้วย Pele ${manifest.version} · เปิด offline ได้ ไม่มี CDN หรือ analytics · <a href="README.md">ขอบเขตและ source references</a> · <a href="manifest.json">Build manifest</a></footer></main><script>
let factor=1;function active(){return document.querySelector('.pane:not([hidden])')}function size(){const box=active().querySelector('.viewport'),svg=box.querySelector('svg');const natural=svg.viewBox.baseVal.width;const base=Math.min(natural,Math.max(240,box.clientWidth-40));svg.style.width=(base*factor)+'px';document.getElementById('zoom').textContent=Math.round(factor*100)+'%';}document.querySelectorAll('[data-target]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.pane').forEach(p=>p.hidden=p.id!==b.dataset.target);document.querySelectorAll('[data-target]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));factor=1;size()}));document.getElementById('plus').onclick=()=>{factor=Math.min(4,factor+.25);size()};document.getElementById('minus').onclick=()=>{factor=Math.max(.5,factor-.25);size()};document.getElementById('fit').onclick=()=>{factor=1;size()};addEventListener('resize',size);size();</script></html>`;
await writeFile(join(out,'index.html'),html);
console.log(JSON.stringify({renderer:manifest.renderer,version:manifest.version,diagrams:manifest.diagrams.map(({id,type,width,height})=>({id,type,width,height})),output:resolve(out)},null,2));
