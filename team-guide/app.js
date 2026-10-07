'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const moduleDetails = {
  merchant: ['MERCHANT SURFACE', 'POS Website', 'Astro / React / TypeScript', 'หน้าร้านจัดการสินค้า ตะกร้า เงินสด บิล stock รายงาน และ staff roles รวม UI เดิมครบ 25 หน้า เจ้าของร้านสร้าง campaign และดูผล ฝั่ง UI ไม่เป็นแหล่งราคาและไม่ยืนยัน payment เอง'],
  customer: ['CUSTOMER SURFACE', 'QR Ordering', 'Astro / React / wallet integration', 'ลูกค้าสแกนเพื่อเปิดเมนู เลือก order และชำระด้วยช่องทางที่รองรับ มี guest flow และ wallet binding ตาม policy ใช้ pricing/order API ชุดเดียวกับ POS และมีเว็บ fallback เมื่อ client ไม่แสดง Blink'],
  terminal: ['STORE DEVICE', 'BitPosClock', 'ESP-IDF / FreeRTOS / LVGL', 'Firmware อยู่ใน repo BitPOS แสดง order/QR/สถานะและเสียงหลัง verified event รองรับ ACK, dedup และ resync ไม่เป็น source of truth ของ payment หรือ reward browser terminal ใช้พัฒนาและจำลอง UI ก่อน hardware พร้อม'],
  ai: ['MERCHANT ASSISTANT', 'AI Campaign Tools', 'LLM provider / bounded query tools', 'อ่านเมนู ต้นทุน stock และ analytics ที่ร้านมีสิทธิ์ ร่าง structured campaign ให้ owner preview/publish กฎเรื่อง budget, margin และ eligibility ตรวจด้วย code AI ไม่ตรวจว่าจ่ายจริงและไม่ถือ unrestricted treasury keys'],
  api: ['CORE BACKEND', 'BitPOS API', 'Elysia / TypeScript / OCI', 'คำนวณราคาจริง สร้าง order/quote/payment attempt ตรวจ tenant/role และเชื่อม Actions กับ payment providers เมื่อผ่านการยืนยันแล้วเปลี่ยน payment/order/stock และบันทึก durable outbox ใน database transaction'],
  settlement: ['PAYMENT EVIDENCE', 'Solana + Stripe', 'USDG / Actions / verified webhooks', 'Solana เป็นหลักฐาน transaction และ ownership; Stripe เป็นหลักฐาน PromptPay/refund API/worker ต้องตรวจ successful settlement, recipient/mint/amount/order reference และ dedup client callback หรือการ sign อย่างเดียวไม่ทำให้ order เป็น paid'],
  database: ['BUSINESS DATA', 'Supabase', 'PostgreSQL / Auth / RLS / Storage', 'เก็บข้อมูลที่ POS ต้องใช้และข้อมูล private: เมนู stock order สมาชิก campaign payment index และ reward ledger แยก BitPOS data/Auth boundary ให้ชัด และใช้ transaction/constraints/RLS ตาม access path ที่ออกแบบ'],
  worker: ['RELIABLE ASYNC WORK', 'BitPOS Worker', 'TypeScript / DB outbox / reconciliation', 'ฟัง confirmation และตรวจ transaction ส่ง event ไป terminal แล้วแจก reward ตาม campaign snapshot งานต้องรอด restart, retry และ event ซ้ำ paid/reward/device delivery เป็นสถานะแยกกัน ไม่ใช้ network request ที่ล้มเหลวทำให้ลูกค้าจ่ายซ้ำ']
};

function selectModule(key) {
  const [label, title, tech, text] = moduleDetails[key];
  $$('.map-node').forEach(node => { node.classList.toggle('selected', node.dataset.node === key); node.setAttribute('aria-pressed', String(node.dataset.node === key)); });
  $('#map-detail').innerHTML = `<div><div class="mini-label">${label}</div><h3>${title}</h3><div class="map-tech">${tech}</div></div><p>${text}</p>`;
}
$$('.map-node').forEach(node => {
  node.addEventListener('click', () => selectModule(node.dataset.node));
  node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectModule(node.dataset.node); } });
});
selectModule('api');

$('#download-map').addEventListener('click', () => {
  const clone = $('#architecture-map').cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '1100'); clone.setAttribute('height', '650');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `.map-paths path{stroke:#988fa0;fill:none;stroke-width:1.6;marker-end:url(#arrow)}.map-paths .event-path{stroke:#591b97;stroke-width:2.2;stroke-dasharray:5 5}.map-labels text{font:12px sans-serif;fill:#8c7d9c}.map-labels .event-label{fill:#5b2e88}.map-node rect{fill:#efe9f5;stroke:#d4c9df;stroke-width:1.3}.map-node text{font:14px sans-serif;fill:#79668c}.map-node .map-heading{font-size:22px;fill:#3d2b50;font-weight:600}.map-node .map-kicker{font:10px monospace;fill:#9989aa}.map-node.selected rect{fill:#38234e;stroke:#38234e}.map-node.selected text{fill:#ccbbdc}.map-node.selected .map-heading{fill:#f7f8e9}`;
  clone.prepend(style);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], {type: 'image/svg+xml'}));
  const a = document.createElement('a'); a.href = url; a.download = 'BitPOS-architecture.svg'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
});

const groups = ['ภาพรวม', 'การขาย', 'คลังสินค้า', 'รายงาน', 'ข้อมูลหลัก', 'ระบบ'];
const features = [
  ['dashboard','แดชบอร์ด','ยอดขายและภาพรวมร้าน',0],['pos','ขายหน้าร้าน','ค้นหา ตะกร้า ส่วนลด เงินสด/เงินทอน',0],
  ['bills','บิลขาย','ดู พิมพ์ และ void ตามสิทธิ์',1],['shift','ปิดยอดประจำวัน','สรุปยอดและผู้ปิดรอบ',1],
  ['products','สินค้า','ราคา ต้นทุน รูป และ SKU',2],['stock','สต๊อกสินค้า','คงเหลือและการตั้ง stock policy',2],['receive','รับเข้าสต๊อก','เพิ่ม stock ตามสิทธิ์และเอกสาร',2],['rcvHistory','ประวัติรับเข้า','รายการรับและผู้จำหน่าย',2],['adjust','ปรับปรุงสต๊อก','เหตุผลและ manager authorization',2],['lowstock','สินค้าใกล้หมด','threshold สำหรับแต่ละสินค้า',2],['movement','ความเคลื่อนไหวสต๊อก','ประวัติ sale/receive/adjust/void',2],
  ['repDaily','รายงานประจำวัน','ยอดตามวันและ filters',3],['repSales','รายงานยอดขาย','บิล ลูกค้า หมวด และช่วงเวลา',3],['repReceive','รายงานยอดรับเข้า','รับ stock และ supplier filters',3],['repPeriod','สรุปย้อนหลัง','สรุปช่วงวันที่และ comparisons',3],['analytics','วิเคราะห์ยอดขาย','charts และแนวโน้ม',3],['top','สินค้าขายดี','อันดับสินค้าตามข้อมูลขาย',3],['exportC','ศูนย์ Export','CSV และ export history',3],
  ['suppliers','ผู้จำหน่าย','ข้อมูลผู้ส่งสินค้าและความสัมพันธ์',4],['customers','ลูกค้า','ข้อมูลลูกค้าในขอบเขตร้าน',4],['categories','หมวดหมู่สินค้า','จัดหมวดและ filters',4],
  ['users','ผู้ใช้ & สิทธิ์','owner / manager / staff',5],['activity','บันทึกกิจกรรม','audit ของการเปลี่ยนแปลง',5],['printer','ใบเสร็จ & เครื่องพิมพ์','receipt settings และ print behavior',5],['settings','ตั้งค่าระบบ','ข้อมูลร้าน stock และช่องทางจ่าย',5]
];
groups.forEach((group, i) => {
  const button = document.createElement('button'); button.className = 'filter-chip'; button.dataset.group = String(i); button.setAttribute('aria-pressed','false');
  button.innerHTML = `${group} <span>${features.filter(f => f[3] === i).length}</span>`;
  $('#pos-filters').append(button);
});
function renderFeatures(group = 'all') {
  const selected = features.filter(feature => group === 'all' || feature[3] === Number(group));
  $('#pos-grid').innerHTML = selected.map(([id, title, desc, index]) => `<article class="pos-feature"><span class="feature-group">${groups[index]}</span><h3>${title}</h3><p>${desc}</p><code>${id}</code></article>`).join('');
  $('#pos-count').textContent = `แสดง ${selected.length} จาก 25 หน้าจอ · ${group === 'all' ? 'ขอบเขตทั้งหมดของเฟส 1A' : groups[Number(group)]}`;
  $$('#pos-filters button').forEach(button => { const active = button.dataset.group === group; button.classList.toggle('active', active); button.setAttribute('aria-pressed',String(active)); });
}
$('#pos-filters').addEventListener('click', event => { const button = event.target.closest('button'); if (button) renderFeatures(button.dataset.group); });
renderFeatures();

const phases = [
  ['0','แยกโครงการและสำรวจ','เสร็จ: repo / plans / source audit / OCI read-only','สร้าง repo ของ cryptoclocks, feature matrix, dependency/source inventory, firmware scope และ capacity audit','ต้นทางไม่ถูก reset, ไม่มี secrets/production data ปน, บันทึกสิ่งที่ตรวจแล้วกับสิ่งที่ยังไม่ยืนยัน'],
  ['1','1A ย้าย POS + 1B แยก firmware','ถัดไป · ฐานที่รันได้อย่างอิสระ','POS 25 หน้า, i18n, roles, reports, demo, business rules/tests; แยก ESP-IDF components, config/version/product และ POS boot shell','POS parity ตาม roles/languages; firmware build จาก repo BitPOS และ boot/render บนเครื่องทดสอบ โดยไม่รอ catalog CryptoClock'],
  ['2','ฐานข้อมูลและการสั่ง','Supabase / tenant / menu / order / stock','ออก schema/Auth/RLS และ memberships, guest/wallet binding, customer self-order, immutable order items และ stock reservations','ร้านอ่านข้อมูลกันไม่ได้ ราคาเป็น server authoritative และ concurrent orders ไม่ oversell; พร้อม contract ให้ payments/AI/device'],
  ['3','Payments: Cash / PromptPay / USDG','Stripe / Solana Pay / Actions / Kora / quotes','quote/payment attempts, integer amounts, token mint/program checks, verified webhook, watcher/polling, duplicate/late payment recovery','wrong token/amount/recipient ไม่ paid; replay ไม่ตัด stock/ปิดบิลซ้ำ; multiple successful attempts มี recovery case'],
  ['4','จอหน้าร้านและ event จริง','Terminal web / firmware / QR / sound','order view, channel selector, state machine, idle ticker/GIF, transport authentication, ACK/dedup/reconnect และ state resync','POS/terminal order ตรงกัน; stale event ไม่เล่นซ้ำ; วัด backend paid → physical render ACK p95 บนเครื่องจริง'],
  ['5','Loyalty และของรางวัล','points / CLOCK option / NFT / voucher','5 collectible concepts → assets/metadata, campaign snapshots, backend randomness, grants/claim, tiers, voucher redemption และ physical fulfillment','แจก/claim/redeem ไม่ซ้ำ; paid แต่ mint fail เป็น pending/retry; token/NFT policy และ ownership/transfer/fulfillment ตรวจได้'],
  ['6','AI ที่มีคุณค่ากับร้าน','campaign draft / analytics / feedback loop','bounded query tools ใช้ menu/margin/stock/order/payment, draft preview/publish, wallet opt-in และ campaign outcome metrics','output ผ่าน schema/budget/eligibility checks; ไม่มี unrestricted fund movement; แสดงผลจากข้อมูลจริง ไม่อ้าง forecast ที่ไม่มีฐาน'],
  ['7','Integrations และ pilot','notifications / Grab adapter / production gates','customer inbox/app, legacy home-device opt-in, online-order adapters, tips/check-in/WiFi, deployment/backup/monitoring และร้านนำร่อง','real/mock ชัด, partner API access จริงเมื่อเชื่อม, bind/consent ถูกต้อง, restore/rollback และ staging/end-to-end checks ผ่าน']
];
$('#phase-list').innerHTML = phases.map(([n,title,sub,work,gate]) => `<details class="phase ${n === '0' ? 'done-phase' : ''}" ${n === '1' ? 'open' : ''}><summary><span class="phase-num">${n.padStart(2,'0')}</span><span><span class="phase-title">${title}</span><span class="phase-subtitle">${sub}</span></span><span class="phase-arrow">+</span></summary><div class="phase-body"><div><h4>DELIVERABLE</h4><p>${work}</p></div><div><h4>ACCEPTANCE GATE</h4><p>${gate}</p></div></div></details>`).join('');

const streams = [
  ['WEB / POS','Merchant + Customer','ย้าย UI 25 หน้า ภาษา/roles, customer ordering และ browser terminal','เฟส 1A / 2 / 4','ส่งต่อ: order/payment contracts กับ backend'],
  ['API / DATA','Order + Stock + Auth','schema/tenant isolation, pricing, reservations, API และ outbox','เฟส 2 / 3','ส่งต่อ: stable schemas, error cases และ fixtures'],
  ['SOLANA / PAYMENTS','Settlement + Rewards','Actions, quote, verification, watcher, token/NFT issuance และ redemption','เฟส 3 / 5','ส่งต่อ: verified event, grant status และ retry policy'],
  ['EMBEDDED / DEVICE','BitPosClock','extract firmware, independent build, store shell, transport/state และ render ACK','เฟส 1B / 4','ส่งต่อ: test board + protocol + hardware evidence'],
  ['AI / CAMPAIGNS','Merchant Decision Tools','query tools, draft/publish, deterministic constraints และ outcome analytics','เฟส 6','ส่งต่อ: structured campaign + metrics + budget tests'],
  ['QA / OPS / PRODUCT','Prove the Whole Loop','failure/replay tests, staging limits, log/backup, demo/pitch และ pilot store','ทุกเฟส / 7','ส่งต่อ: evidence, known limits และ submission assets']
];
$('#team-grid').innerHTML = streams.map(([label,title,desc,phase,handoff]) => `<article class="team-card"><div class="mini-label">${label}</div><h3>${title}</h3><p>${desc}</p><small>${phase}<br>${handoff}</small></article>`).join('');

const stack = [
  ['Merchant / Customer web','Astro + React + TypeScript + CSS','คง stack ต้นทางก่อน extraction; ใช้ทำ POS, self-order, loyalty และ browser terminal'],
  ['Backend API','Elysia + TypeScript','order/pricing/authorization/Actions/webhooks; API runtime ยังต้องเลือก'],
  ['Background worker','TypeScript + database outbox','confirmation, events, grants/retries และ reconciliation; runtime ยังต้องเลือก'],
  ['Database / Identity / Files','Supabase: PostgreSQL / Auth / RLS / Storage','เมนู stock order private records และ tenant roles; BitPOS instance/Auth boundary ยังไม่เลือก'],
  ['Payments','USDG + Solana Pay + Actions/Blinks + Kora planned + Stripe PromptPay','server quote, verified settlement และ order attribution; cash เป็นอีกช่องทาง'],
  ['Real-time transport','MQTT / WebSocket','เลือก wiring ตาม device/backend; authentication, dedup, ACK และ resync'],
  ['Store firmware','ESP-IDF + C/C++ + FreeRTOS + LVGL','จอ/touch, network, audio, SD, health และ OTA ของ BitPOS'],
  ['AI','LLM provider + bounded tools','ยังไม่เลือก provider; draft campaign จาก data ที่มีสิทธิ์และผ่าน deterministic rules'],
  ['Hosting / Source','OCI + GitHub cryptoclocks/BitPOS','repo private; OCI inspected read-only; ยังไม่ deploy BitPOS']
];
$('#stack-rows').innerHTML = stack.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');

const entities = ['merchants','merchant_members','locations','terminals','products','categories','suppliers','customers','customer_wallets','orders','order_items','payment_attempts','payments','refunds','stock_reservations','stock_movements','shift_closes','campaigns','campaign_versions','reward_grants','loyalty_ledger','vouchers','redemptions','fulfillments','outbox_events','device_deliveries','notification_preferences','external_orders','audit_logs'];
$('#entity-tags').innerHTML = entities.map(entity => `<code>${entity}</code>`).join('');

const collectibles = [
  ['Espresso Dawn','เริ่มต้น collection ด้วยแก้วกาแฟ', '#694c30','#e6c07b','coffee'],
  ['Solana Ripple','เส้นสาย digital กับวงคลื่น', '#38264a','#b38ed9','ripple'],
  ['Clock Afterglow','เวลาที่กลับมาเจอกันอีกครั้ง', '#353c58','#c1b3df','clock'],
  ['Lucky Orbit','ดวงดาวและการค้นพบชิ้นใหม่', '#463755','#d5d69b','star'],
  ['Café Companion','มาสคอตสำหรับระดับของรางวัล', '#6d4150','#efb7ac','bear']
];
function collectibleArt(type, fg) {
  const common = `<circle cx="90" cy="105" r="61" fill="none" stroke="${fg}" stroke-width=".7" opacity=".3"/><circle cx="90" cy="105" r="48" fill="none" stroke="${fg}" stroke-width=".7" opacity=".2"/>`;
  const arts = {
    coffee: `<path d="M56 76h61v57q-30 23-61 0z" fill="${fg}"/><path d="M116 84q38 0 20 30h-20" fill="none" stroke="${fg}" stroke-width="8"/><path d="M54 151h80M76 62q-11-15 0-30M95 62q-10-15 0-30" fill="none" stroke="${fg}" stroke-width="3" stroke-linecap="round"/><path d="M67 91h37" stroke="#694c30" stroke-width="2"/>`,
    ripple: `<g fill="${fg}"><path d="M51 68h89l-15 16H36z"/><path d="M36 96h89l15 16H51z"/><path d="M51 124h89l-15 16H36z"/></g><circle cx="90" cy="104" r="74" fill="none" stroke="${fg}" stroke-width="1" stroke-dasharray="3 8" opacity=".5"/>`,
    clock: `<circle cx="90" cy="105" r="41" fill="none" stroke="${fg}" stroke-width="4"/><path d="M90 75v30l24 17" stroke="${fg}" stroke-width="5" stroke-linecap="round" fill="none"/><g stroke="${fg}" stroke-width="2"><path d="M90 70v7M90 133v7M54 105h8M119 105h8"/></g><circle cx="90" cy="105" r="5" fill="${fg}"/>`,
    star: `<path d="M90 54l14 31 34 5-25 24 6 34-29-16-30 16 6-34-25-24 34-5z" fill="${fg}"/><ellipse cx="90" cy="105" rx="75" ry="25" fill="none" stroke="${fg}" stroke-width="2" transform="rotate(-30 90 105)"/><circle cx="146" cy="70" r="5" fill="${fg}"/>`,
    bear: `<circle cx="59" cy="68" r="19" fill="${fg}"/><circle cx="121" cy="68" r="19" fill="${fg}"/><ellipse cx="90" cy="104" rx="48" ry="47" fill="${fg}"/><ellipse cx="90" cy="122" rx="23" ry="17" fill="#6d4150" opacity=".3"/><circle cx="72" cy="99" r="4" fill="#6d4150"/><circle cx="108" cy="99" r="4" fill="#6d4150"/><path d="M82 116q8-7 16 0l-8 8z" fill="#6d4150"/><path d="M90 123v7" stroke="#6d4150" stroke-width="2"/>`
  };
  return common + arts[type];
}
$('#nft-grid').innerHTML = collectibles.map(([title,desc,bg,fg,type],i) => `<article class="nft-card"><div class="nft-art"><span class="nft-label">BITPOS / CONCEPT 0${i+1}</span><svg viewBox="0 0 180 240" role="img" aria-label="แนวคิด collectible ${title}"><rect width="180" height="240" fill="${bg}"/><path d="M13 39V22h17M150 22h17v17M167 205v17h-17M30 222H13v-17" fill="none" stroke="${fg}" stroke-width="1" opacity=".5"/>${collectibleArt(type,fg)}<text x="90" y="191" text-anchor="middle" fill="${fg}" font-family="Sarabun,sans-serif" font-size="10" letter-spacing="2">COLLECT / RETURN</text><text x="90" y="211" text-anchor="middle" fill="${fg}" font-family="monospace" font-size="7" opacity=".5">PROTOTYPE ART · NOT MINTED</text></svg></div><h3>${title}</h3><p>${desc}</p><span class="nft-number">0${i+1} / 05 · ART CONCEPT</span></article>`).join('');

const glossary = [
  ['Action / Blink','Action API ส่ง metadata และ transaction ให้ client sign ส่วน Blink แสดง Action เป็น UI ใน client ที่รองรับ'],
  ['USDG / SOL / CLOCK','USDG ใช้ชำระ; SOL จ่ายค่า network; CLOCK เป็นแนวทาง loyalty ที่ยังต้องตัดสินใจ spec'],
  ['Mint','สำหรับ token คือ address ที่ระบุ token นั้น; mint NFT หมายถึงออก asset บนเชน ต้องยืนยัน network/address จริง'],
  ['Payment attempt / Quote','attempt คือความพยายามจ่ายแต่ละครั้ง; quote คือยอด/rate/expiry ที่ server ตรึงไว้สำหรับรายการ'],
  ['Commitment / Confirmation','ระดับการยืนยันของ chain ที่ระบบเลือกใช้เป็น policy ไม่เหมือนการได้รับ callback จากมือถือ'],
  ['Idempotency','ทำ operation ซ้ำแล้วไม่เกิดการปิดบิล ตัด stock แจก grant หรือแลกสิทธิ์เพิ่มอีกครั้ง'],
  ['Outbox','บันทึก event ที่ต้องส่งไว้ใน DB transaction เดียวกับการเปลี่ยนสถานะ แล้ว worker ส่ง/retry ภายหลัง'],
  ['Reconciliation','ตรวจ record ที่ index ไว้เทียบกับ chain/provider เพื่อกู้รายการที่ notification หายหรือสถานะคลาดเคลื่อน'],
  ['Tenant / RLS','Tenant คือร้าน/องค์กร; RLS คือ row-level policy ของ Postgres ต้องใช้ร่วมกับ server roles และ access path ที่ถูกต้อง'],
  ['ACK / p95','ACK คือคำตอบรับจาก client หลังทำงาน; p95 คือเวลา 95% ของ samples ไม่เกินค่าที่รายงาน'],
  ['OTA / Rollback','อัปเดต firmware ผ่าน network และย้อนกลับเมื่อรุ่นใหม่ไม่ผ่าน health gate ต้องแยก product/board targets'],
  ['Reward grant / Redemption','Grant คือการออกสิทธิ์ตาม campaign; redemption คือใช้สิทธิ์จริง อาจเกิดคนละเวลากับ mint และการรับของ']
];
$('#glossary').innerHTML = glossary.map(([term,desc]) => `<article class="glossary-item"><h3>${term}</h3><p>${desc}</p></article>`).join('');

const checklist = ['สมาชิกลงทะเบียน Colosseum และเลือก Thailand ตาม track','มี working demo ครบ order → USDG → device → reward','AI มีข้อมูลเข้า/ผลร่าง/ผลลัพธ์ที่ตรวจได้','เปิดเผยงานเดิม งานใหม่ และ third-party ownership','README / architecture / setup / known limitations','Demo video และ submission materials ภาษาอังกฤษ','ระบุ test network, test assets และ mock integrations','ตรวจ code access, deadline และส่งทั้งสอง portals'];
$('#submission-checklist').innerHTML = checklist.map((item,i) => `<label for="check-${i}"><input type="checkbox" id="check-${i}"><span>${item}</span></label>`).join('');

let simStep = 0;
let playTimer = null;
const stepLabels = ['เลือกเมนู','ตรึงยอด','รับการจ่าย','ยืนยัน','ตอบสนอง','ออกสิทธิ์'];
function simSteps() {
  const method = $('#sim-method').value;
  const scenario = $('#sim-case').value;
  const isCash = method === 'cash';
  const isStripe = method === 'promptpay';
  const initial = [
    {title:'เริ่มจาก order เดียวกัน',desc:'พนักงานเลือกสินค้า หรือผู้ใช้สแกนเมนูแล้วเลือกเอง ยอดและรายการต้องถูกตรวจจาก catalog ฝั่ง server ไม่ใช้ราคาใน browser เป็นหลักฐาน',order:'DRAFT',payment:'NOT CREATED',reward:'NOT ELIGIBLE',terminal:'ยินดีต้อนรับ',sub:'พร้อมรับ order',rule:'ร้านและลูกค้าใช้ order ID เดียวกันเพื่อเชื่อมรายการทั้งระบบ'},
    {title:'Backend ตรึงยอดและสำรอง stock',desc:`สร้าง order items snapshot, quote และ payment attempt ${isCash?'สำหรับเงินสด':isStripe?'พร้อม Stripe PaymentIntent/QR':'สำหรับ USDG พร้อม token/network/recipient ที่กำหนด'} แล้วแสดง order เดียวกันบน POS และจอ`,order:'AWAITING PAYMENT',payment:'AWAITING',reward:'NOT ELIGIBLE',terminal:'฿120.00',sub:isCash?'รอรับเงินสด':isStripe?'สแกน PromptPay QR':'USDG quote จำลอง 3.50',rule:'การมี QR หรือ payment attempt ยังไม่เท่ากับ paid; stock reservation มี expiry'},
    {title:isCash?'พนักงานรับเงินและตรวจเงินทอน':isStripe?'ลูกค้าจ่ายจาก PromptPay QR':'Wallet sign และส่ง transaction',desc:isCash?'ผู้มีสิทธิ์บันทึกยอดที่รับจริงและตรวจเงินทอน ก่อน backend รับ cash confirmation':isStripe?'ลูกค้าใช้แอปธนาคารชำระ QR แล้วรอ Stripe ยืนยันผ่าน webhook ที่ตรวจ signature':'Action POST ประกอบ transaction ลูกค้า sign/send แต่ backend ยังต้องตรวจ transaction ที่สำเร็จและข้อมูล transfer บน chain',order:'CONFIRMING',payment:'PENDING',reward:'NOT ELIGIBLE',terminal:'กำลังตรวจสอบ',sub:isCash?'รอยืนยันเงินสด':isStripe?'รอ Stripe webhook':'รอ chain confirmation',rule:'ห้ามแสดงจ่ายสำเร็จเพียงเพราะมี client callback หรือ wallet sign แล้ว'},
    {title:'ยืนยันรายการและบันทึก outbox',desc:isCash?'Backend ตรวจสิทธิ์และข้อมูล cash receipt จากผู้รับเงิน บันทึก payment/order/stock พร้อม outbox ใน DB transaction':isStripe?'Backend ตรวจ verified webhook และ PaymentIntent ของ order แล้วบันทึก payment/order/stock พร้อม outbox':'Watcher ตรวจ successful transaction, commitment, mint/program, recipient, amount และ order reference แล้วบันทึก payment/order/stock พร้อม outbox',order:'PAID',payment:'SUCCEEDED',reward:'PENDING',terminal:'กำลังตรวจสอบ',sub:'backend paid แล้ว · รอ device event',rule:'บันทึก paid และ event แบบ durable ก่อนส่งไป device; ยังไม่อ้างว่า reward ออกสำเร็จ'},
    {title:'เครื่องร้านแสดงผลและ ACK',desc:'Worker ส่ง paid event ไปจอ เครื่องตรวจ merchant/device target และ event ID แล้ว render animation/เสียงหนึ่งครั้ง ส่ง ACK หลัง render สำเร็จ นี่คือช่วงที่ใช้วัด latency',order:'PAID',payment:'SUCCEEDED',reward:'PENDING',terminal:'ชำระสำเร็จ ✓',sub:'จอรับ event แล้ว · reward pending',rule:'เป้าหมาย p95 < 1s คือ backend paid → physical render ACK ไม่ใช่เวลาทั้ง chain'},
    {title:'ออก reward แล้ววัดผลแคมเปญ',desc:'Worker ตรวจ campaign version/eligibility แล้วบันทึก grant และออกแต้ม/NFT/voucher ตาม policy ลูกค้า claim/redeem ได้ตามสิทธิ์ และร้านเห็น payment กับ campaign metrics ตัวอย่างจำลองนี้เปิดสิทธิ์ทุกช่องทาง',order:'PAID',payment:'SUCCEEDED',reward:'ISSUED',terminal:'ขอบคุณ แล้วพบกันใหม่',sub:'reward issued · ดูสิทธิ์บนเว็บลูกค้า',rule:'grant/claim/redemption dedup แยกจาก payment; NFT กับของจริงมี fulfillment คนละขั้น'}
  ];
  if (scenario === 'failed') {
    initial[3] = {title:'การจ่ายไม่สำเร็จ',desc:isCash?'ข้อมูลยอดที่รับหรือสิทธิ์ไม่ผ่านการตรวจ ไม่บันทึก payment สำเร็จ':isStripe?'Stripe ยืนยัน failure หรือไม่พบ payment ที่สำเร็จ ตะกร้าต้องไม่ถูกปิดเป็น paid':'transaction ไม่สำเร็จ หรือ mint/amount/recipient ไม่ตรง quote Backend ไม่เปลี่ยน order เป็น paid',order:'AWAITING PAYMENT',payment:'FAILED',reward:'NOT ELIGIBLE',terminal:'ยังไม่ชำระ',sub:'ตรวจวิธีจ่ายและลองใหม่',rule:'ไม่แจก reward ไม่ commit stock และไม่เล่น success sound'};
    initial[4] = {title:'รักษา order และเปิด retry',desc:'ลูกค้าเลือกวิธีจ่ายใหม่ได้ด้วย payment attempt ใหม่ หาก reservation หมดอายุให้ release/requote ตาม policy ไม่ใช้การเปลี่ยนหน้าจอเพื่อยืนยันยอด',order:'AWAITING PAYMENT',payment:'FAILED',reward:'NOT ELIGIBLE',terminal:'รอชำระใหม่',sub:'order เดิม · attempt ใหม่เมื่อ retry',rule:'หากเงินเข้าภายหลัง expiry ต้อง reconciliation/recovery ไม่ทิ้ง record'};
    initial[5] = {title:'ไม่มีสิทธิ์จนกว่าจะ paid',desc:'จบสถานการณ์ failure โดยยังไม่มี reward grant ที่ออกสำเร็จ ใช้ปุ่มเริ่มใหม่เพื่อดู flow สำเร็จ; ระบบจริงต้องมีหน้าทางกลับไป retry และ support',order:'AWAITING PAYMENT',payment:'FAILED',reward:'NOT ELIGIBLE',terminal:'รอชำระใหม่',sub:'ยังไม่มี collectible จาก order นี้',rule:'failure และ unpaid ต้องมองเห็นได้ทั้ง POS เว็บลูกค้า และจอ'};
  }
  if (scenario === 'duplicate') {
    initial[4] = {title:'event เดิมมาสองครั้ง รับผลครั้งเดียว',desc:'จำลองส่ง payment/device event ID เดิมซ้ำ ระบบเห็นว่า order paid และ delivery ถูกใช้แล้วจึงไม่ปิดบิล ตัด stock หรือเล่นเสียงรอบสอง',order:'PAID',payment:'SUCCEEDED',reward:'PENDING',terminal:'ชำระสำเร็จ ✓',sub:'event ซ้ำถูกข้าม · render ครั้งเดียว',rule:'event received 2 → accepted 1; payment 1 / stock commit 1 / sound 1'};
    initial[5].rule = 'event ซ้ำไม่สร้าง grant ใหม่: reward grant 1 และ redeem ได้ครั้งเดียวตาม policy';
  }
  if (scenario === 'reward-failed') {
    initial[5] = {title:'จ่ายแล้ว แต่ reward ยังรอ retry',desc:'Mint/provider call ล้มเหลวหลัง payment paid เก็บ issuance attempt และ retry ใน worker แจ้ง pending ให้ลูกค้า ไม่เปลี่ยน paid กลับเป็น unpaid และไม่ขอให้ลูกค้าจ่ายซ้ำ',order:'PAID',payment:'SUCCEEDED',reward:'FAILED / RETRY',terminal:'ชำระสำเร็จ ✓',sub:'reward pending · ระบบจะลองใหม่',rule:'payment succeeded ≠ reward issued; retry ใช้ grant ID เดิมเพื่อป้องกันการแจกซ้ำ'};
  }
  return initial;
}
function stopPlay() { if (playTimer !== null) clearTimeout(playTimer); playTimer = null; $('#sim-play').textContent = 'เล่น flow อัตโนมัติ ▷'; }
function renderSim() {
  const steps = simSteps(); const step = steps[simStep];
  $('#step-counter').textContent = `STEP 0${simStep+1} / 06`;
  $('#sim-title').textContent = step.title; $('#sim-description').textContent = step.desc;
  $('#order-state').textContent = step.order; $('#payment-state').textContent = step.payment; $('#reward-state').textContent = step.reward;
  $('#terminal-message').textContent = step.terminal; $('#terminal-sub').textContent = step.sub;
  $('#sim-invariant').textContent = step.rule;
  $('#sim-terminal').classList.toggle('paid',step.order === 'PAID' && simStep >= 4);
  $('#sim-terminal').classList.toggle('failed',step.payment === 'FAILED');
  $('#sim-prev').disabled = simStep === 0; $('#sim-next').disabled = simStep === 5;
  $('#sim-next').textContent = simStep === 5 ? 'ครบ flow แล้ว ✓' : 'ขั้นถัดไป →';
  $('#step-track').innerHTML = stepLabels.map((label,i) => `<li class="${i === simStep ? 'active' : i < simStep ? 'completed' : ''}" ${i === simStep ? 'aria-current="step"' : ''}>0${i+1}<br>${label}</li>`).join('');
}
$('#sim-next').addEventListener('click', () => { stopPlay(); simStep = Math.min(simStep+1,5); renderSim(); });
$('#sim-prev').addEventListener('click', () => { stopPlay(); simStep = Math.max(simStep-1,0); renderSim(); });
function resetSim() { stopPlay(); simStep = 0; renderSim(); }
$('#sim-reset').addEventListener('click', resetSim);
$('#sim-method').addEventListener('change', resetSim); $('#sim-case').addEventListener('change', resetSim);
$('#sim-play').addEventListener('click', () => {
  if (playTimer !== null) { stopPlay(); return; }
  if (simStep === 5) simStep = 0;
  $('#sim-play').textContent = 'หยุดเล่น Ⅱ'; renderSim();
  const tick = () => { simStep++; renderSim(); if (simStep < 5) playTimer = setTimeout(tick,2200); else stopPlay(); };
  playTimer = setTimeout(tick,2200);
});
renderSim();

function renderCalculation() {
  const values = ['price','cost','reward','every'].map(key => Number($('#calc-'+key).value));
  const [price,cost,reward,every] = values;
  const valid = values.every(Number.isFinite) && price > 0 && cost >= 0 && reward >= 0 && every >= 1 && Number.isInteger(every) && ['price','cost','reward','every'].every(key => $('#calc-'+key).value !== '' && $('#calc-'+key).checkValidity());
  const result = $('.calculator-result');
  if (!valid) { $('#calc-per-order').textContent = '—'; $('#calc-margin').textContent = '—'; $('#calc-note').textContent = 'กรอกค่าตามช่วงที่กำหนด จำนวนบิลต้องเป็นจำนวนเต็มอย่างน้อย 1'; result.classList.add('loss'); return; }
  const rewardPerOrder = reward / every; const margin = price-cost-rewardPerOrder;
  const fmt = n => '฿'+ n.toLocaleString('th-TH',{maximumFractionDigits:2});
  $('#calc-per-order').textContent = fmt(rewardPerOrder); $('#calc-margin').textContent = fmt(margin);
  $('#calc-note').textContent = margin <= 0 ? 'ตัวอย่างนี้ไม่เหลือ margin: ต้องปรับเงื่อนไข/รางวัลก่อน publish แคมเปญ' : 'สมมติทุกบิลมีคุณสมบัติและแลกรางวัลครบ ไม่รวม fee/ภาษี ไม่ใช่ forecast';
  result.classList.toggle('loss',margin <= 0);
}
$$('.calculator-fields input').forEach(input => input.addEventListener('input',renderCalculation));
renderCalculation();

function setMenu(open) {
  $('#sidebar').classList.toggle('open',open); $('#scrim').hidden = !open;
  $('#menu-toggle').setAttribute('aria-expanded',String(open));
  $('#menu-toggle').setAttribute('aria-label',open ? 'ปิดสารบัญ' : 'เปิดสารบัญ');
}
$('#menu-toggle').addEventListener('click', () => setMenu(!$('#sidebar').classList.contains('open')));
$('#scrim').addEventListener('click', () => { setMenu(false); $('#menu-toggle').focus(); });
$('#contents').addEventListener('click',event => { if(event.target.closest('a')) setMenu(false); });

const sections = $$('.section');
const searchIndex = sections.map(section => ({id:section.id,title:section.querySelector('h1,h2').textContent.replace(/\s+/g,' ').trim(),keywords:(section.dataset.title+' '+section.textContent).toLocaleLowerCase()}));
function performSearch() {
  const query = $('#search').value.trim().toLocaleLowerCase(); const results = $('#search-results');
  if (!query) { results.hidden = true; results.replaceChildren(); return; }
  const matches = searchIndex.filter(item => query.split(/\s+/).every(word => item.keywords.includes(word))).slice(0,8);
  results.replaceChildren(); results.hidden = false;
  if (!matches.length) { const p=document.createElement('p'); p.textContent='ไม่พบหัวข้อนี้ ลองคำว่า order, firmware หรือ NFT'; results.append(p); return; }
  matches.forEach(item => { const a=document.createElement('a'); a.href='#'+item.id; a.textContent=item.title; a.addEventListener('click',() => { $('#search').value=''; performSearch(); setMenu(false); const heading=$('#'+item.id).querySelector('h1,h2'); heading.tabIndex=-1; heading.focus({preventScroll:true}); }); results.append(a); });
}
$('#search').addEventListener('input',performSearch);
document.addEventListener('keydown',event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if(window.innerWidth <= 1000) setMenu(true); $('#search').focus(); }
  if (event.key === 'Escape') { $('#search').value=''; performSearch(); setMenu(false); }
});

let scheduledScroll = false;
function updateScroll() {
  const offset=window.scrollY; const available=document.documentElement.scrollHeight-window.innerHeight;
  $('#read-progress').style.width=(available > 0 ? Math.min(100,offset/available*100) : 0)+'%';
  let active=sections[0].id;
  for (const section of sections) if(section.getBoundingClientRect().top < 175) active=section.id;
  $$('#contents a').forEach(a => { const selected=a.hash === '#'+active; a.classList.toggle('active',selected); if(selected) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current'); });
  scheduledScroll=false;
}
window.addEventListener('scroll',() => { if(!scheduledScroll) { scheduledScroll=true; requestAnimationFrame(updateScroll); } },{passive:true});
window.addEventListener('resize',updateScroll); updateScroll();

let beforePrintState = [];
function expandForPrint() { beforePrintState=$$('details').map(detail => [detail,detail.open]); $$('details').forEach(detail=>detail.open=true); }
function restoreAfterPrint() { beforePrintState.forEach(([detail,open])=>detail.open=open); beforePrintState=[]; }
window.addEventListener('beforeprint',expandForPrint); window.addEventListener('afterprint',restoreAfterPrint);
$('#print-guide').addEventListener('click',()=>window.print());
