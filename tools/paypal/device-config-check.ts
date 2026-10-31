// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Before flashing a Mini: connects once with the private device JSON (as the firmware would: token in the
// Authorization header, never in the URL) and reports what the server's CONFIG tells the device — the pay origin its
// QR codes will use and the table entry link. Prints no token. Closes after the first CONFIG.
//   node --import tsx tools/paypal/device-config-check.ts <private device json>
import {readFileSync,statSync} from 'node:fs';
import WebSocket from 'ws';

const file=process.argv[2];if(!file)throw Error('usage: device-config-check.ts <private device json>');
if(statSync(file).mode&0o077)throw Error('device JSON must be mode 600');
const d=JSON.parse(readFileSync(file,'utf8')) as {ws_url:string;merchant:string;terminal:string};
const u=new URL(d.ws_url);const token=u.searchParams.get('token');if(!token)throw Error('no token in ws_url');
const endpoint=`${u.protocol}//${u.host}${u.pathname}`;
const ws=new WebSocket(endpoint,{headers:{Authorization:'Bearer '+token}});
const timer=setTimeout(()=>{console.log(JSON.stringify({endpoint,ok:false,error:'no CONFIG within 15 s'}));process.exit(1);},15000);
ws.on('message',raw=>{
 const m=JSON.parse(raw.toString());if(m.type!=='CONFIG')return;
 const c=m.payload??m;const entry=c.tableEntryUrl?new URL(c.tableEntryUrl):null;
 console.log(JSON.stringify({endpoint,ok:true,deviceId:c.deviceId,merchantMatches:c.merchantId===d.merchant,label:c.label,paymentOrigin:c.paymentOrigin,
  tableEntry:entry?`${entry.origin}/table/<token>`:null,currency:c.catalogCurrency??c.currency??null}));
 clearTimeout(timer);ws.close();
});
ws.on('unexpected-response',(_req,res)=>{console.log(JSON.stringify({endpoint,ok:false,status:res.statusCode}));process.exit(1);});
ws.on('error',e=>{console.log(JSON.stringify({endpoint,ok:false,error:e.message}));process.exit(1);});
