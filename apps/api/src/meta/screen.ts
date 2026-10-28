// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Table screen: a tablet or phone at a booked table shows the booking countdown, next to the BitPOS device
// (the device firmware is not changed for this). The URL is /meta/screen/<tagId>?k=<key>; the key is derived
// from the tap master key, so only staff who were given the link can open a table's screen.
// The page shows no personal data: the table, the party size and the times. It counts down in the browser
// from the server's clock and reloads every 30 seconds to pick up check-ins and lapses.
import {createHmac,timingSafeEqual} from 'node:crypto';
import type {TableScreen} from './reservations';

export function screenKey(masterKey:Buffer,tagId:string):string{
 return createHmac('sha256',masterKey).update(`bitpos-meta-screen:${tagId}`).digest('base64url').slice(0,22);
}
export function screenKeyValid(masterKey:Buffer,tagId:string,key:string|null):boolean{
 if(!key||!/^[A-Za-z0-9_-]{22}$/.test(key))return false;
 return timingSafeEqual(Buffer.from(key),Buffer.from(screenKey(masterKey,tagId)));
}

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const hhmm=(iso:string)=>new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'});

/** The full page. `nonce` lets the one inline countdown script run under the page's CSP. */
export function screenHtml(s:TableScreen,nonce:string):string{
 // Labels are shop-written ("Table 1", "A2", "โต๊ะริมหน้าต่าง"); add the word only when the label lacks it.
 const table=/^(table|โต๊ะ)/i.test(s.tableLabel.trim())?esc(s.tableLabel):`โต๊ะ ${esc(s.tableLabel)} · Table ${esc(s.tableLabel)}`;
 let tone='#2e7d32',big='ว่าง',small='Free — tap the device to order',target:string|null=null,label='';
 if(s.state==='upcoming'){tone='#6a1b9a';big=`จองไว้ ${hhmm(s.startsAt!)}`;small=`Reserved for ${s.partySize} at ${hhmm(s.startsAt!)} · เช็กอินได้ตั้งแต่ ${hhmm(s.checkInFrom!)}`;target=s.checkInFrom;label='เปิดเช็กอินใน / Check-in opens in';}
 if(s.state==='check_in'){tone='#c62828';big='รอผู้จองเช็กอิน';small=`Waiting for the booking (${s.partySize}) — tap to check in · ถ้าไม่มาภายใน ${hhmm(s.checkInUntil!)} โต๊ะจะว่าง`;target=s.checkInUntil;label='โต๊ะจะว่างใน / Released in';}
 if(s.state==='seated'){tone='#1565c0';big='เช็กอินแล้ว ✓';small=`Seated (${s.partySize}) · จองถึง ${hhmm(s.seatedUntil!)}`;}
 const clock=target?`<p style="margin:8px 0 0;font-size:15px;opacity:.85">${label}</p><p id="cd" data-target="${esc(target)}" data-now="${esc(s.now)}" style="margin:0;font:700 72px/1.1 ui-monospace,monospace">--:--</p>`:'';
 return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${table}</title>
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;font:18px/1.4 system-ui,sans-serif;background:${tone};color:#fff;padding:24px;box-sizing:border-box}h1{margin:0 0 8px;font-size:22px;font-weight:600;opacity:.9}.big{font-size:44px;font-weight:700;margin:8px 0}.small{max-width:36em;opacity:.9}footer{position:fixed;bottom:12px;font-size:12px;opacity:.7}</style></head>
<body><h1>${table}</h1><div class="big">${esc(big)}</div><div class="small">${esc(small)}</div>${clock}<footer>BitPOS × Muse · table screen</footer>
<script nonce="${nonce}">(()=>{const e=document.getElementById('cd');if(e){const skew=Date.parse(e.dataset.now)-Date.now(),t=Date.parse(e.dataset.target);
const tick=()=>{const s=Math.max(0,Math.round((t-(Date.now()+skew))/1000));e.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');if(s===0)setTimeout(()=>location.reload(),3000);};tick();setInterval(tick,1000);}
setTimeout(()=>location.reload(),30000);})();</script></body></html>`;
}
