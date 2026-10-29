// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// UI kit for meta-pay and meta-pos, following design/figcraft-meta (Meta-blue theme of our own, no Meta logos).
// Server-rendered HTML with inline CSS only (the pages' CSP allows inline styles and no scripts unless nonced).
// Every page built here ends with at least one way onward, so no page is a dead end (design link audit rule).

import {localizeStaff,staffLang} from './staff-i18n';
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
.vo{margin:18px 0 8px}.micb{width:128px;height:128px;border-radius:64px;margin:6px auto 12px;padding:0;font-size:52px;line-height:128px;background:linear-gradient(135deg,#0866FF,#7A3FF2);box-shadow:0 10px 30px rgba(8,102,255,.35);transition:transform .15s}
.micb:active{transform:scale(.96)}.micb.on{animation:pulse 1.2s ease-in-out infinite;background:linear-gradient(135deg,#D3203A,#7A3FF2)}.micb.off{background:var(--ln);box-shadow:none;cursor:not-allowed}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(211,32,58,.45)}70%{box-shadow:0 0 0 22px rgba(211,32,58,0)}100%{box-shadow:0 0 0 0 rgba(211,32,58,0)}}
.live{min-height:24px;font-size:18px;font-weight:600;color:var(--ink);margin:8px 0}.bub{background:#fff;border:1px solid var(--ln);border-radius:18px 18px 18px 4px;padding:10px 14px;margin:10px 40px 10px 0;max-width:max-content}
.bub.me{background:var(--p);color:#fff;border:0;border-radius:18px 18px 4px 18px;margin:10px 0 10px auto}.bub .muse{margin-top:6px}
.say{display:flex;gap:8px;align-items:center;margin:14px 0 8px}.say input{margin:0;border-radius:24px}.say button{width:auto;margin:0;border-radius:24px;padding:12px 18px}
.floorwrap{margin:6px 0 10px}.flegend{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:0 0 10px;font-size:13px}.flegend .sp{flex:1}.lg{display:inline-flex;gap:6px;align-items:center;font-weight:600}.lg i{width:12px;height:12px;border-radius:4px;display:inline-block}
.lg.free i{background:#fff;border:2px solid #1E8E3E}.lg.up i{background:var(--vi)}.lg.ci i{background:var(--rd)}.lg.seat i{background:var(--p)}
.room{position:relative;background:repeating-linear-gradient(90deg,#F7F8FA 0 38px,#F2F4F7 38px 76px);border:1px solid var(--ln);border-radius:24px;padding:64px 26px 56px 150px;min-height:420px;overflow:hidden}
.fwin{position:absolute;left:150px;right:26px;top:14px;height:26px;border-radius:13px;background:linear-gradient(90deg,#DCEBFF,#EEF5FF);color:#7FA6DA;font-size:11px;letter-spacing:4px;display:flex;align-items:center;justify-content:center}
.fbar{position:absolute;left:18px;top:64px;bottom:56px;width:104px;border-radius:18px;background:#1C2B33;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-size:11px;font-weight:700;letter-spacing:1px;text-align:center}
.fbar i{width:30px;height:30px;border-radius:15px;background:#33444d;display:block}.fplant{position:absolute;font-size:26px}.fplant.a{right:18px;bottom:12px}.fplant.b{left:130px;top:10px}
.fdoor{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:#fff;border:1px dashed var(--ln);border-radius:10px;padding:4px 18px;font-size:11px;letter-spacing:3px;color:var(--mu)}
.fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:22px}
.ftab{position:relative;display:flex;flex-direction:column;gap:6px;background:#fff;border:2px solid #CDEBD6;border-radius:22px;padding:22px 16px 14px;color:var(--ink);box-shadow:0 6px 16px rgba(28,43,51,.06);transition:transform .12s,box-shadow .12s}
.ftab:hover{text-decoration:none;transform:translateY(-2px);box-shadow:0 10px 24px rgba(28,43,51,.12)}
.ftab .seats{position:absolute;top:-9px;left:16px;right:16px;display:flex;justify-content:space-around}.ftab .seats i{width:22px;height:12px;border-radius:6px;background:#CDEBD6;display:block}
.ftab .ftop{display:flex;justify-content:space-between;align-items:center;gap:8px}.ftab .ftop b{font-size:18px}.fst{border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;background:var(--grb);color:var(--gr)}
.fl{font-size:14px}.fmeta{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--mu)}.fo{color:var(--am);font-weight:600}
.ftab.up{border-color:#D9C8FA;background:#FBF8FF}.ftab.up .seats i{background:#D9C8FA}.ftab.up .fst{background:var(--vib);color:var(--vi)}
.ftab.ci{border-color:#F6B9C2;background:#FFF7F8;animation:ci 1.6s ease-in-out infinite}.ftab.ci .seats i{background:#F6B9C2}.ftab.ci .fst{background:var(--rdb);color:var(--rd)}
.ftab.seat{border-color:#A9C8FF;background:#F4F8FF}.ftab.seat .seats i{background:var(--p)}.ftab.seat .fst{background:var(--p);color:#fff}
@keyframes ci{0%,100%{box-shadow:0 0 0 0 rgba(211,32,58,.25)}50%{box-shadow:0 0 0 8px rgba(211,32,58,0)}}
tr:target{background:var(--ti)}
@media (max-width:700px){.fgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 10px}.ftab{padding:18px 10px 10px;border-radius:18px}.ftab .ftop{flex-direction:column;align-items:flex-start;gap:4px}.ftab .ftop b{font-size:16px}.fl{font-size:12px}.room{padding:56px 14px 52px}.fbar{position:static;width:auto;flex-direction:row;height:44px;margin:0 0 16px}.fbar i{width:20px;height:20px}.fwin{left:14px;right:14px}.fplant.b{display:none}}
@media (min-width:1000px){.m{max-width:1000px;padding:24px 28px 40px}.lst{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}.cols{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:24px;align-items:start}.cols>div:last-child{position:sticky;top:76px}.hero{height:340px}}
/* meta-pos on phones and tablets: the sidebar becomes a top bar with a menu; wide tables scroll inside their card. */
.mtop{display:none}.lang a{font-size:12px;font-weight:600;padding:4px 9px;border-radius:9px;color:var(--mu);border:1px solid var(--ln)}.lang a.on{background:var(--p);border-color:var(--p);color:#fff}.lang{display:inline-flex;gap:4px}
.side .lang{margin:12px 12px 0}.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:14px}.tw table{min-width:560px}
@media (max-width:1100px){.g4{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:860px){.desk{display:block}.side,.hd{display:none}
 .mtop{display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid var(--ln);padding:10px 14px}.mtop .sp{flex:1}.mtop .shop{font-size:13px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34vw}
 .mnav{cursor:pointer;width:40px;height:40px;border-radius:12px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:20px;user-select:none}
 .mnck:checked+.mnav{background:var(--ti);color:var(--p)}.mgrid{display:none}.mnck:checked~.mgrid{display:grid}.mgrid{position:fixed;left:0;right:0;top:61px;bottom:0;background:rgba(240,242,245,.98);padding:14px;overflow:auto;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-content:start}
 .mgrid a{display:flex;flex-direction:column;align-items:center;gap:6px;background:#fff;border:1px solid var(--ln);border-radius:16px;padding:14px 6px;color:var(--ink);font-size:13px;text-align:center}.mgrid a span{font-size:22px}.mgrid a.on{border-color:var(--p);color:var(--p);font-weight:600}
 .mgrid .who{grid-column:1/-1;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--ln);border-radius:16px;padding:12px}.mgrid .who form{margin-left:auto}
 .pg{padding:14px 14px 32px}.pgt h1{font-size:22px}.pgt .btn{width:100%}.g2,.g3{grid-template-columns:1fr}.met b{font-size:22px}table{font-size:14px}th,td{padding:10px}
 .card{padding:14px}.chips{flex-wrap:nowrap}}
@media (max-width:480px){.g4{grid-template-columns:repeat(2,minmax(0,1fr))}.mgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;

export interface PageOpts {title:string;back?:string|null;nav?:[string,string][];refresh?:number;nonce?:string;script?:string;csp?:string;
 /** false when the page already has its own primary action: then every nav button is secondary. */
 navPrimary?:boolean}
const head=(o:PageOpts)=>`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${o.refresh?`<meta http-equiv="refresh" content="${o.refresh}">`:''}<title>${esc(o.title)} · BitPOS × Muse</title><style>${CSS}</style></head>`;

/** Customer page (meta-pay, mobile first). `nav` are the onward buttons; a page always gets at least "back to the shop". */
const AI_CSS=`body.ai{background:#070B18;color:#EEF2FF;min-height:100vh;background-image:radial-gradient(60% 40% at 15% 0%,rgba(8,102,255,.35),transparent 70%),radial-gradient(50% 40% at 100% 20%,rgba(122,63,242,.35),transparent 70%),radial-gradient(60% 50% at 50% 110%,rgba(0,200,255,.18),transparent 70%);background-attachment:fixed}
.ai a{color:#9CC2FF}.ai .mu,.ai small{color:#9AA4BF}.aitop{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:14px 18px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);background:rgba(7,11,24,.55);border-bottom:1px solid rgba(255,255,255,.06)}
.aitop .back{width:38px;height:38px;border-radius:19px;background:rgba(255,255,255,.08);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:22px}.aitop .sp{flex:1}
.spark{display:inline-flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.2px}.spark i{width:22px;height:22px;border-radius:11px;background:conic-gradient(from 0deg,#0866FF,#7A3FF2,#00C2FF,#0866FF);display:inline-block;box-shadow:0 0 14px rgba(122,63,242,.8)}
.aim{max-width:720px;margin:0 auto;padding:18px 18px 380px}.hello{margin:8vh 0 18px;text-align:center}.hello h1{font-size:34px;line-height:1.2;margin:0 0 10px;background:linear-gradient(90deg,#FFFFFF,#B9C9FF 40%,#C9A8FF);-webkit-background-clip:text;background-clip:text;color:transparent}
.msg{display:flex;gap:10px;margin:14px 0;animation:rise .35s ease-out both}.msg.me{justify-content:flex-end}.msg .av{flex:none;width:30px;height:30px;border-radius:15px;background:conic-gradient(from 0deg,#0866FF,#7A3FF2,#00C2FF,#0866FF);box-shadow:0 0 16px rgba(8,102,255,.6)}
.msg .tx{max-width:82%;padding:12px 16px;border-radius:20px;line-height:1.5;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}.msg.me .tx{background:linear-gradient(135deg,#0866FF,#5B4BF5);border:0;color:#fff;border-bottom-right-radius:6px}.msg:not(.me) .tx{border-top-left-radius:6px}
.glass{background:rgba(255,255,255,.96);color:#1C2B33;border-radius:22px;padding:14px;margin:10px 0 10px 40px;box-shadow:0 20px 50px rgba(0,0,0,.35);animation:rise .4s ease-out both}.glass small,.glass .mu{color:#65676B}
.ai .row{background:transparent}.ai .glass .row{border-color:#ECEEF2}.ai .lst .row{background:rgba(255,255,255,.96)!important;color:#1C2B33}
.dock{position:fixed;left:0;right:0;bottom:0;z-index:6;padding:12px 16px calc(16px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(7,11,24,0),rgba(7,11,24,.94) 46px)}
.dock .in{max-width:720px;margin:0 auto}.orbw{display:flex;flex-direction:column;align-items:center;gap:6px;margin-bottom:10px}
.orb{--lvl:0;position:relative;width:76px;height:76px;border-radius:38px;border:0;padding:0;margin:0;cursor:pointer;background:radial-gradient(circle at 35% 30%,#fff 0,#BFD6FF 12%,#0866FF 45%,#7A3FF2 75%,#2A0E6B 100%);box-shadow:0 0 calc(30px + var(--lvl)*60px) rgba(98,120,255,.75),inset 0 -8px 20px rgba(0,0,0,.35);transform:scale(calc(1 + var(--lvl)*.35));transition:transform .08s linear,box-shadow .08s linear;animation:breathe 3.2s ease-in-out infinite}
.orb::before,.orb::after{content:'';position:absolute;inset:-10px;border-radius:50%;border:1px solid rgba(160,180,255,.35);animation:ring 2.8s ease-out infinite;pointer-events:none}.orb::after{animation-delay:1.4s}
.orb.on{animation:spin 6s linear infinite;background:conic-gradient(from 0deg,#00C2FF,#0866FF,#7A3FF2,#FF4FD8,#00C2FF)}.orb.on::before,.orb.on::after{border-color:rgba(255,120,220,.5);animation-duration:1.2s}
.orb.off{filter:grayscale(1) brightness(.6);cursor:not-allowed;animation:none}.orb span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:30px}
.ai .st{font-size:13px;color:#AEB8D6;text-align:center;min-height:18px}.ai .live{font-size:20px;font-weight:600;text-align:center;min-height:28px;color:#fff;margin:2px 0 6px}
.aibar{display:flex;gap:8px;align-items:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:28px;padding:6px 6px 6px 16px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.aibar input{flex:1;border:0;background:transparent;color:#fff;font:inherit;padding:10px 0;margin:0;outline:none}.aibar input::placeholder{color:#8F9AB8}.aibar button{width:44px;height:44px;border-radius:22px;padding:0;margin:0;font-size:18px;background:linear-gradient(135deg,#0866FF,#7A3FF2)}
.sugg{display:flex;gap:8px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}.sugg form{flex:none}.sugg button{width:auto;margin:0;padding:8px 14px;border-radius:18px;font-size:13px;font-weight:500;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:#E3E9FF}
.lang{display:flex;gap:6px;justify-content:center}.lang a{font-size:12px;padding:3px 10px;border-radius:12px;color:#9AA4BF;border:1px solid rgba(255,255,255,.12)}.lang a.on{color:#fff;background:rgba(255,255,255,.14)}
.cam{flex:none;width:40px!important;height:40px!important;background:rgba(255,255,255,.1)!important;font-size:18px!important}.shot{max-width:200px;max-height:200px;border-radius:18px;border:2px solid rgba(255,255,255,.2);object-fit:cover}
.ai .note{background:rgba(255,190,70,.12);color:#FFD58A;border:1px solid rgba(255,190,70,.25);margin-left:40px}
@keyframes breathe{0%,100%{filter:saturate(1)}50%{filter:saturate(1.4) brightness(1.08)}}@keyframes ring{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.6);opacity:0}}@keyframes spin{to{filter:hue-rotate(360deg)}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.orb,.orb::before,.orb::after,.msg,.glass{animation:none}}`;
/** Full-screen AI assistant shell (voice ordering, design C11): dark, a chat thread and a bottom dock. */
export function aiHtml(o:PageOpts&{dock:string},body:string):string{
 return `${head(o)}<body class="ai"><style>${AI_CSS}</style><header class="aitop">${o.back?`<a class="back" href="${esc(o.back)}" aria-label="กลับ">‹</a>`:''}<span class="spark"><i></i>Muse Spark</span><span class="sp"></span><small>Muse Café · Stripe sandbox</small></header>
<main class="aim">${body}</main><div class="dock"><div class="in">${o.dock}</div></div>${o.script&&o.nonce?`<script nonce="${o.nonce}">${o.script}</script>`:''}</body></html>`;
}
export function customerHtml(o:PageOpts,body:string):string{
 const nav=(o.nav&&o.nav.length?o.nav:[['หน้าร้าน / Shop','/']] as [string,string][]);
 const buttons=nav.map(([label,href],i)=>`<a class="btn${i===0&&o.navPrimary!==false?'':' g'}" href="${esc(href)}">${esc(label)}</a>`).join('');
 return `${head(o)}<body><header class="top">${o.back?`<a class="back" href="${esc(o.back)}" aria-label="กลับ">‹</a>`:''}<span class="brand">BitPOS <b>× Muse</b></span><span class="sp"></span><small>Stripe sandbox</small></header>
<main class="m">${body}${buttons}<p class="foot">Muse Café · ร้านเดโมของงาน Meta · ราคาและการจ่ายจากเซิร์ฟเวอร์ · ไม่มีเงินจริง ไม่มีคริปโต</p></main>${o.script&&o.nonce?`<script nonce="${o.nonce}">${o.script}</script>`:''}</body></html>`;
}

export const STAFF_NAV:[string,string,string][]=[['📊','ภาพรวม','/meta/staff/overview'],['🛒','ขายหน้าร้าน','/meta/staff/counter'],['🧾','ออเดอร์','/meta/staff'],['☕','คิวครัว','/meta/staff/kitchen'],
 ['🗓️','การจองโต๊ะ','/meta/staff/bookings'],['📦','เมนูและสต็อก','/meta/staff/menu'],['✨','โปรโมชัน','/meta/staff/offers'],['👥','ลูกค้า','/meta/staff/customers'],
 ['🤖','Muse Connector','/meta/staff/connector'],['🔎','หลักฐาน AI|AI evidence','/meta/staff/ledger'],['📈','รายงาน','/meta/staff/reports'],['⚙️','ตั้งค่า','/meta/staff/settings']];
const ROLE_TH:Record<string,string>={owner:'เจ้าของร้าน',manager:'ผู้จัดการ',staff:'พนักงาน'};

/** Staff page (meta-pos): sidebar on desktop, wrapping top menu on phones. */
export function staffHtml(o:PageOpts&{active:string;role:string;shop:string;sub?:string;actions?:string},body:string):string{
 const nav=(cls:string)=>STAFF_NAV.map(([ic,label,href])=>{const [th,en]=label.split('|');return `<a href="${href}"${o.active===href?` class="on"`:''}><span>${ic}</span>${esc(en&&staffLang()==='en'?en:th)}</a>`;}).join('');
 const lang=`<span class="lang">${(['en','th'] as const).map(l=>`<a href="/meta/staff/lang?l=${l}&amp;b=${encodeURIComponent(o.active)}"${staffLang()===l?' class="on"':''}>${l==='en'?'EN':'ไทย'}</a>`).join('')}</span>`;
 const out=`<form method="post" action="/meta/staff/logout"><button class="g inline">ออกจากระบบ</button></form>`;
 // Wide tables scroll inside their own box instead of the page.
 const wrapped=body.replace(/<table>/g,'<div class="tw"><table>').replace(/<\/table>/g,'</table></div>');
 return localizeStaff(`${head(o)}<body><header class="mtop"><span class="brand">BitPOS <b>× Muse</b></span><span class="shop">${esc(o.shop)}</span><span class="sp"></span>${lang}
<input type="checkbox" id="mn" class="mnck" hidden><label for="mn" class="mnav" aria-label="เมนู">☰</label><nav class="mgrid">${nav('m')}<div class="who"><b>${esc(ROLE_TH[o.role]??o.role)}</b><small>${esc(o.shop)}</small>${out}</div></nav></header>
<div class="desk"><nav class="side"><div class="brandbox" style="padding:6px 12px 16px"><span class="brand">BitPOS <b>× Muse</b></span></div>${nav('s')}
<div class="who"><b>${esc(ROLE_TH[o.role]??o.role)}</b><br><small>${esc(o.shop)}</small>${out}</div>${lang}</nav>
<div class="main"><div class="hd"><b>${esc(o.shop)}</b><span class="pill am">Stripe sandbox</span><span class="pill vi">Muse Spark</span></div>
<div class="pg"><div class="pgt"><div><h1>${esc(o.title)}</h1>${o.sub?`<small>${esc(o.sub)}</small>`:''}</div><span class="sp"></span>${o.actions??''}</div>${wrapped}</div></div></div>${o.script&&o.nonce?`<script nonce="${o.nonce}">${o.script}</script>`:''}</body></html>`);
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
