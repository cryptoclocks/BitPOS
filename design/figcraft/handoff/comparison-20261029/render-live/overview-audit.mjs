// Asserts the POS Overview numbers against direct SQL, in two browser time zones.
// usage: node overview-audit.mjs   (stack up, seed-all done; re-times the seeded orders around Bangkok midnight first)
import {launch,login,click,MERCHANT} from './lib.mjs';
import pg from '/Users/cryptoclock/.codex/worktrees/bitpos-h2-parallel/BitPOS/node_modules/pg/lib/index.js';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const here=new URL('.',import.meta.url).pathname;
execFileSync('npx',['tsx',here+'seed.ts','retime'],{stdio:'inherit',env:process.env});
const BULK='7e0d0c0e-0000-4000-8000-00000000f002';
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
// capped=true reproduces what GET /orders can return (newest 200, apps/api/src/orders.ts); full totals are reported separately.
async function expected(m,capped=false){
 const day=(await db.query("SELECT ((now() AT TIME ZONE 'Asia/Bangkok')::date)::text d")).rows[0].d;
 const rows=(await db.query(`SELECT o.id,o.status,to_char(o.created_at AT TIME ZONE 'Asia/Bangkok','HH24:MI') hhmm,extract(hour FROM o.created_at AT TIME ZONE 'Asia/Bangkok')::int hr,
  (SELECT coalesce(sum(qty*unit_minor),0) FROM bitpos.order_items i WHERE i.order_id=o.id)::bigint total,coalesce(f.status,'RECEIVED') k
  FROM (SELECT * FROM bitpos.orders WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT ${capped?200:100000}) o LEFT JOIN bitpos.order_fulfillment f ON f.order_id=o.id
  WHERE o.merchant_id=$1 AND (o.created_at AT TIME ZONE 'Asia/Bangkok')::date=$2::date ORDER BY o.created_at DESC`,[m,day])).rows;
 const paid=rows.filter(r=>r.status==='PAID');const hours={};for(const r of paid)hours[r.hr]=(hours[r.hr]||0)+1;
 return {day,orders:rows.length,paid:paid.length,salesMinor:paid.reduce((a,r)=>a+BigInt(r.total),0n).toString(),inProgress:paid.filter(r=>r.k!=='COLLECTED').length,hours,recent:rows.slice(0,5).map(r=>({id:r.id.slice(0,8),hhmm:r.hhmm}))};
}
async function scrape(page){
 await click(page,'Overview');await page.waitForSelector('.pos-overview-kpis');await page.waitForTimeout(600);
 const k=await page.locator('.pos-overview-kpis article').evaluateAll(a=>a.map(x=>({v:x.querySelector('strong').textContent,s:x.querySelector('span').textContent})));
 const chart=await page.locator('.pos-overview-chart').getAttribute('aria-label').catch(()=>'');
 const hours={};for(const m of (chart||'').matchAll(/(\d+):00 (\d+)/g))if(+m[2])hours[+m[1]]=+m[2];
 const recent=await page.locator('.pos-overview-recent tbody tr').evaluateAll(r=>r.map(x=>({id:x.children[0].textContent.replace('#',''),hhmm:x.children[4].textContent})));
 return {salesText:k[0].v,paidText:k[0].s,orders:+k[1].v,inProgress:+k[2].v,hours,recent};
}
const results=[];const b=await launch();
for(const [label,merchant,mid] of [['main',MERCHANT,''],['bulk(230 paid today)',BULK,BULK]]){
 const exp=await expected(merchant,!!mid);const full=await expected(merchant,false);const truncated=full.orders>exp.orders;
 for(const tz of ['Asia/Bangkok','America/New_York']){
  const ctx=await b.newContext({viewport:{width:1440,height:900},timezoneId:tz,locale:'en-GB'});const p=await ctx.newPage();
  await login(p,mid?'bulk':'owner',mid);const got=await scrape(p);
  const salesOk=got.salesText.replace(/[^0-9.]/g,'')===(Number(exp.salesMinor)/100).toFixed(2);
  const checks={sales:salesOk,paidCount:got.paidText.startsWith(String(exp.paid)+' '),orders:got.orders===exp.orders,inProgress:got.inProgress===exp.inProgress,hourly:JSON.stringify(got.hours)===JSON.stringify(exp.hours),recentIds:JSON.stringify(got.recent.map(r=>r.id))===JSON.stringify(exp.recent.map(r=>r.id)),noticeWhenTruncated:(await p.locator('.pos-overview .notice',{hasText:'newest 200'}).count()>0)===truncated,recentTimes:JSON.stringify(got.recent.map(r=>r.hhmm))===JSON.stringify(exp.recent.map(r=>r.hhmm))};
  results.push({label,tz,expected:exp,fullTotals:{orders:full.orders,paid:full.paid,salesMinor:full.salesMinor},got,checks});
  console.log(label,tz,JSON.stringify(checks),'| exp orders',exp.orders,'paid',exp.paid,'sales',exp.salesMinor,'inprog',exp.inProgress,'| got',got.orders,got.paidText,got.salesText,got.inProgress);
  await p.screenshot({path:here+'shots/overview-'+label.split('(')[0]+'-'+tz.replace('/','_')+'.png'}).catch(()=>{});
  await ctx.close();
 }
}
await b.close();await db.end();
writeFileSync(here+'overview-audit-'+(process.env.AUDIT_TAG||'run')+'.json',JSON.stringify(results,null,1));
const bad=results.flatMap(r=>Object.entries(r.checks).filter(([,v])=>!v).map(([k])=>r.label+'/'+r.tz+'/'+k));
console.log(bad.length?'MISMATCHES: '+bad.join(', '):'ALL OVERVIEW CHECKS PASS');process.exit(bad.length?1:0);
