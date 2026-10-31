// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Phase 0 spike CLI (sandbox only). Prints ids, statuses, amounts and debug ids only.
//   pnpm exec tsx tools/paypal/sandbox-smoke.ts create [amount=4.50]   → prints approve URL (buyer approves in a browser)
//   pnpm exec tsx tools/paypal/sandbox-smoke.ts capture <orderId>     → capture with the stored capture request id
//   pnpm exec tsx tools/paypal/sandbox-smoke.ts get <orderId>         → GET order (+ capture) and verify
//   pnpm exec tsx tools/paypal/sandbox-smoke.ts idem <orderId>        → S-02/S-03/S-04 idempotency probes on a captured order
import {randomUUID} from 'node:crypto';
import {call,view,verify,load,save,newCheckout} from './sandbox-lib';

const [cmd,arg]=process.argv.slice(2);
if(cmd==='create'){
 const {s,payload}=newCheckout(arg??'4.50');
 const r=await call('POST','/v2/checkout/orders',s.createRequestId,payload);
 console.log(JSON.stringify({step:'create',http:r.status,debugId:r.debugId,...view(r.body)},null,1));
 if(r.body?.id){save({...s,orderId:r.body.id,createdAt:new Date().toISOString(),createPayload:payload});console.log('\nOpen the approveUrl in a browser, sign in with the SANDBOX BUYER account, approve; then run: capture '+r.body.id);}
}else if(cmd==='capture'){
 const s=load(arg);const r=await call('POST',`/v2/checkout/orders/${arg}/capture`,s.captureRequestId,{});
 console.log(JSON.stringify({step:'capture',http:r.status,debugId:r.debugId,...view(r.body)},null,1));
 if(r.status<300){const fail=verify(s,r.body);console.log(JSON.stringify({step:'verify',pass:!fail.length,fail}));}
}else if(cmd==='get'){
 const s=load(arg);const r=await call('GET',`/v2/checkout/orders/${arg}`);
 console.log(JSON.stringify({step:'get',http:r.status,debugId:r.debugId,...view(r.body)},null,1));
 const capId=view(r.body).capture?.id;
 if(capId){const c=await call('GET',`/v2/payments/captures/${capId}`);console.log(JSON.stringify({step:'get-capture',http:c.status,debugId:c.debugId,id:c.body.id,status:c.body.status,amount:c.body.amount,invoiceId:c.body.invoice_id,customId:c.body.custom_id}));}
 if(r.body?.status==='COMPLETED'){const fail=verify(s,r.body);console.log(JSON.stringify({step:'verify',pass:!fail.length,fail}));}
}else if(cmd==='idem'){
 const s=load(arg);
 const again=await call('POST','/v2/checkout/orders',s.createRequestId,s.createPayload);
 console.log(JSON.stringify({probe:'S-02 create replay, same request id',http:again.status,sameOrder:again.body?.id===arg,orderId:again.body?.id,status:again.body?.status,issues:view(again.body).issues}));
 const cap=await call('POST',`/v2/checkout/orders/${arg}/capture`,s.captureRequestId,{});
 console.log(JSON.stringify({probe:'S-03 capture replay, same request id',http:cap.status,captureId:view(cap.body).capture?.id,status:cap.body?.status,issues:view(cap.body).issues}));
 const fresh=await call('POST',`/v2/checkout/orders/${arg}/capture`,randomUUID(),{});
 console.log(JSON.stringify({probe:'S-04 capture again, new request id',http:fresh.status,name:fresh.body?.name,issues:view(fresh.body).issues,debugId:fresh.debugId}));
 const dup=await call('POST','/v2/checkout/orders',randomUUID(),s.createPayload);
 console.log(JSON.stringify({probe:'duplicate invoice_id, new request id',http:dup.status,orderId:dup.body?.id,status:dup.body?.status,name:dup.body?.name,issues:view(dup.body).issues}));
}else{
 console.log('usage: create [amount] | capture <orderId> | get <orderId> | idem <orderId>');process.exit(2);
}
