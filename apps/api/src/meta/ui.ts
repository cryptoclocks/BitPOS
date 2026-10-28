// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// UI kit for meta-pay and meta-pos, following design/figcraft-meta (Meta-blue theme of our own, no Meta logos).
// Server-rendered HTML with inline CSS only (the pages' CSP allows inline styles and no scripts unless nonced).
// Every page built here ends with at least one way onward, so no page is a dead end (design link audit rule).

export const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

const CSS=`:root{--p:#0866FF;--pd:#0450C8;--ink:#1C2B33;--mu:#65676B;--bg:#F0F2F5;--ln:#DADDE1;--ti:#E7F0FF;--gr:#1E8E3E;--grb:#E6F4EA;--rd:#D3203A;--rdb:#FDECEF;--am:#8A5A00;--amb:#FFF4D6;--vi:#7A3FF2;--vib:#F1EAFF}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Noto Sans Thai",system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--p);text-decoration:none}a:hover{text-decoration:underline}small,.mu{color:var(--mu)}h1{font-size:24px;line-height:1.25;margin:0 0 6px}h2{font-size:18px;margin:0 0 10px}p{margin:6px 0}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;background:#fff;border-bottom:1px solid var(--ln);padding:12px 16px}
.brand{font-weight:800;font-size:17px;color:var(--ink);letter-spacing:-.2px}.brand b{color:var(--p)}.top .sp{flex:1}.back{display:inline-flex;width:38px;height:38px;border-radius:19px;background:var(--bg);align-items:center;justify-content:center;font-size:20px;color:var(--ink)}
.m{max-width:460px;margin:0 auto;padding:16px 16px 28px}.card{background:#fff;border:1px solid var(--ln);border-radius:16px;padding:16px;margin:12px 0}.hero{border-radius:20px;width:100%;height:210px;object-fit:cover;display:block}
.center{text-align:center}.big{font-size:44px;font-weight:800;color:var(--p);letter-spacing:1px}.icon{width:96px;height:96px;border-radius:48px;margin:18px auto 10px;display:flex;align-items:center;justify-content:center;font-size:44px}
.btn,button{display:block;width:100%;border:0;border-radius:12px;padding:14px 16px;margin:10px 0 0;font:600 16px/1.2 inherit;font-family:inherit;text-align:center;cursor:pointer;background:var(--p);color:#fff}
.btn:hover,button:hover{text-decoration:none;filter:brightness(.96)}.btn.s,button.s{background:var(--ti);color:var(--p)}.btn.g,button.g{background:#fff;color:var(--p);border:1px solid var(--ln)}.btn.d,button.d{background:var(--rdb);color:var(--rd)}
.inline{display:inline-block;width:auto;padding:10px 14px;margin:4px 6px 0 0;font-size:14px}form{margin:0}
.pill{display:inline-block;border-radius:999px;padding:3px 11px;font-size:12px;font-weight:600;background:var(--ti);color:var(--p);margin:2px 4px 2px 0;white-space:nowrap}
.pill.gr{background:var(--grb);color:var(--gr)}.pill.rd{background:var(--rdb);color:var(--rd)}.pill.am{background:var(--amb);color:var(--am)}.pill.vi{background:var(--vib);color:var(--vi)}.pill.mu{background:var(--bg);color:var(--mu)}.pill.dk{background:var(--ink);color:#fff}
.muse{display:inline-block;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;color:#fff;background:linear-gradient(90deg,#0866FF,#7A3FF2)}
.row{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid var(--ln);border-radius:16px;padding:12px;margin:10px 0;color:var(--ink)}a.row:hover{text-decoration:none;border-color:var(--p)}
.row img{width:56px;height:56px;border-radius:12px;object-fit:cover;flex:none}.row .t{flex:1;min-width:0}.row .t b{display:block;font-size:15px}.row .t small{display:block}.row .r{font-weight:700;white-space:nowrap}
.ic{width:44px;height:44px;border-radius:12px;background:var(--ti);display:flex;align-items:center;justify-content:center;font-size:20px;flex:none}
.tot{display:flex;justify-content:space-between;margin:6px 0}.tot.b{font-size:19px;font-weight:800}.note{background:var(--amb);color:var(--am);border-radius:12px;padding:10px 12px;font-size:13px;margin:10px 0}
.chips{display:flex;gap:8px;overflow:auto;padding:4px 0}.chips a{white-space:nowrap}.qty{display:flex;align-items:center;gap:10px}.qty button{width:44px;height:44px;padding:0;margin:0;border-radius:22px;background:#fff;border:1px solid var(--ln);color:var(--p);font-size:22px;font-weight:700}
input,select,textarea{width:100%;font:inherit;padding:12px 14px;border:1px solid var(--ln);border-radius:12px;background:#fff;margin:6px 0}label{font-size:13px;color:var(--mu)}
.bar{position:sticky;bottom:12px;display:flex;justify-content:space-between;align-items:center;background:var(--p);color:#fff;border-radius:16px;padding:16px 18px;font-weight:700;margin-top:16px}.bar:hover{text-decoration:none}
.foot{margin-top:24px;text-align:center;font-size:12px;color:var(--mu)}
.desk{display:grid;grid-template-columns:248px 1fr;min-height:100vh}.side{background:#fff;border-right:1px solid var(--ln);padding:20px 14px;position:sticky;top:0;height:100vh;overflow:auto}
.side a{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;color:var(--ink);margin:2px 0}.side a.on{background:var(--ti);color:var(--p);font-weight:600}.side a:hover{text-decoration:none;background:var(--bg)}
.side .who{border-top:1px solid var(--ln);margin-top:14px;padding-top:12px;font-size:13px}.main{padding:0 0 40px}.hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fff;border-bottom:1px solid var(--ln);padding:14px 28px}
.pg{padding:20px 28px;max-width:1180px}.pgt{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:6px}.pgt .sp{flex:1}.pgt .btn{width:auto;margin:0}
.grid{display:grid;gap:14px}.g2{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.met{background:#fff;border:1px solid var(--ln);border-radius:16px;padding:16px}.met b{display:block;font-size:28px;margin:4px 0}.met.p b{color:var(--p)}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--ln);border-radius:14px;overflow:hidden}th{background:#F5F8FF;color:var(--mu);font-size:12px;text-align:left;padding:12px 14px}td{border-top:1px solid var(--ln);padding:12px 14px;vertical-align:middle}
tr.click:hover td{background:#F8FAFF}.tile{background:#fff;border:1px solid var(--ln);border-radius:16px;overflow:hidden;color:var(--ink);display:block}.tile img{width:100%;height:120px;object-fit:cover;display:block}.tile div{padding:10px 12px}
.barh{height:20px;border-radius:10px;background:var(--bg);overflow:hidden}.barh i{display:block;height:100%;border-radius:10px;background:var(--p)}.qrbox{background:#fff;border:1px solid var(--ln);border-radius:16px;padding:16px;text-align:center}.qrbox svg{width:100%;max-width:320px;height:auto}
@media (max-width:860px){.desk{grid-template-columns:1fr}.side{position:static;height:auto;display:flex;flex-wrap:wrap;gap:4px;padding:10px}.side a{padding:8px 10px;font-size:13px}.side .who,.side .brandbox{display:none}.g3,.g4{grid-template-columns:repeat(2,minmax(0,1fr))}.pg,.hd{padding-left:16px;padding-right:16px}}`;

export interface PageOpts {title:string;back?:string|null;nav?:[string,string][];refresh?:number;nonce?:string;script?:string;csp?:string;
 /** false when the page already has its own primary action: then every nav button is secondary. */
 navPrimary?:boolean}
const head=(o:PageOpts)=>`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${o.refresh?`<meta http-equiv="refresh" content="${o.refresh}">`:''}<title>${esc(o.title)} · BitPOS × Muse</title><style>${CSS}</style></head>`;

/** Customer page (meta-pay, mobile first). `nav` are the onward buttons; a page always gets at least "back to the shop". */
export function customerHtml(o:PageOpts,body:string):string{
 const nav=(o.nav&&o.nav.length?o.nav:[['หน้าร้าน / Shop','/']] as [string,string][]);
 const buttons=nav.map(([label,href],i)=>`<a class="btn${i===0&&o.navPrimary!==false?'':' g'}" href="${esc(href)}">${esc(label)}</a>`).join('');
 return `${head(o)}<body><header class="top">${o.back?`<a class="back" href="${esc(o.back)}" aria-label="กลับ">‹</a>`:''}<span class="brand">BitPOS <b>× Muse</b></span><span class="sp"></span><small>Stripe sandbox</small></header>
<main class="m">${body}${buttons}<p class="foot">Muse Café · ร้านเดโมของงาน Meta · ราคาและการจ่ายจากเซิร์ฟเวอร์ · ไม่มีเงินจริง ไม่มีคริปโต</p></main>${o.script&&o.nonce?`<script nonce="${o.nonce}">${o.script}</script>`:''}</body></html>`;
}

export const STAFF_NAV:[string,string,string][]=[['📊','ภาพรวม','/meta/staff/overview'],['🛒','ขายหน้าร้าน','/meta/staff/counter'],['🧾','ออเดอร์','/meta/staff'],['☕','คิวครัว','/meta/staff/kitchen'],
 ['🗓️','การจองโต๊ะ','/meta/staff/bookings'],['📦','เมนูและสต็อก','/meta/staff/menu'],['✨','โปรโมชัน','/meta/staff/offers'],['👥','ลูกค้า','/meta/staff/customers'],
 ['🤖','Muse Connector','/meta/staff/connector'],['🔎','หลักฐาน AI','/meta/staff/ledger'],['📈','รายงาน','/meta/staff/reports'],['⚙️','ตั้งค่า','/meta/staff/settings']];
const ROLE_TH:Record<string,string>={owner:'เจ้าของร้าน',manager:'ผู้จัดการ',staff:'พนักงาน'};

/** Staff page (meta-pos): sidebar on desktop, wrapping top menu on phones. */
export function staffHtml(o:PageOpts&{active:string;role:string;shop:string;sub?:string;actions?:string},body:string):string{
 const side=STAFF_NAV.map(([ic,label,href])=>`<a href="${href}"${o.active===href?' class="on"':''}><span>${ic}</span>${esc(label)}</a>`).join('');
 return `${head(o)}<body><div class="desk"><nav class="side"><div class="brandbox" style="padding:6px 12px 16px"><span class="brand">BitPOS <b>× Muse</b></span></div>${side}
<div class="who"><b>${esc(ROLE_TH[o.role]??o.role)}</b><br><small>${esc(o.shop)}</small><form method="post" action="/meta/staff/logout"><button class="g inline">ออกจากระบบ</button></form></div></nav>
<div class="main"><div class="hd"><b>${esc(o.shop)}</b><span class="pill am">Stripe sandbox</span><span class="pill vi">Muse Spark</span></div>
<div class="pg"><div class="pgt"><div><h1>${esc(o.title)}</h1>${o.sub?`<small>${esc(o.sub)}</small>`:''}</div><span class="sp"></span>${o.actions??''}</div>${body}</div></div></div>${o.script&&o.nonce?`<script nonce="${o.nonce}">${o.script}</script>`:''}</body></html>`;
}

export const pill=(t:string,tone='')=>`<span class="pill ${tone}">${esc(t)}</span>`;
export const row=(o:{href?:string;img?:string|null;icon?:string;title:string;sub?:string;right?:string})=>{
 const inner=`${o.img?`<img src="${esc(o.img)}" alt="">`:o.icon?`<span class="ic">${o.icon}</span>`:''}<span class="t"><b>${esc(o.title)}</b>${o.sub?`<small>${o.sub}</small>`:''}</span>${o.right?`<span class="r">${o.right}</span>`:o.href?'<span class="mu">›</span>':''}`;
 return o.href?`<a class="row" href="${esc(o.href)}">${inner}</a>`:`<div class="row">${inner}</div>`;
};
export const status=(icon:string,tone:'gr'|'rd'|'am'|'ti'|'vi',title:string,lines:string[])=>`<div class="center"><div class="icon" style="background:var(--${tone==='ti'?'ti':tone+'b'})">${icon}</div><h1>${esc(title)}</h1>${lines.map(l=>`<p class="mu">${l}</p>`).join('')}</div>`;
/** Absolute path of a menu photo served by the /meta container. */
export const photo=(imageUrl:string|null|undefined)=>imageUrl?.startsWith('/images/')?`/meta${imageUrl}`:imageUrl?.startsWith('https://')?imageUrl:null;
export const CHANNEL:Record<string,[string,string]>={tap:['แตะ NFC',''],chat:['แชท Messenger','vi'],agent:['AI agent (MCP)','dk'],mcp:['AI agent (MCP)','dk'],table:['สั่งที่โต๊ะ','gr'],counter:['หน้าร้าน','mu'],web:['เว็บ','mu']};
