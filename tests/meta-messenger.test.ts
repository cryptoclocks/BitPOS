// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {MessengerError,parseMessengerWebhook,sendMessenger,verifyMessengerSignature,verifySubscription} from '../apps/api/src/meta/messenger';

const PAGE='1234567890',PSID='9876543210';
const msg=(m:Record<string,unknown>)=>({object:'page',entry:[{id:PAGE,time:1,messaging:[{sender:{id:PSID},recipient:{id:PAGE},timestamp:1700000000000,...m}]}]});
const code=(c:string)=>(e:unknown)=>e instanceof MessengerError&&e.code===c;

test('webhook signature is checked over the exact raw bytes',()=>{
 const raw=Buffer.from(JSON.stringify(msg({})));
 const good='sha256='+createHmac('sha256','app-secret').update(raw).digest('hex');
 verifyMessengerSignature(raw,good,'app-secret');
 assert.throws(()=>verifyMessengerSignature(Buffer.concat([raw,Buffer.from(' ')]),good,'app-secret'),code('SIGNATURE_INVALID'));
 assert.throws(()=>verifyMessengerSignature(raw,good,'other-secret'),code('SIGNATURE_INVALID'));
 assert.throws(()=>verifyMessengerSignature(raw,undefined,'app-secret'),code('SIGNATURE_INVALID'));
 assert.throws(()=>verifyMessengerSignature(raw,'sha1=abc','app-secret'),code('SIGNATURE_INVALID'));
});

test('subscription handshake echoes the challenge only for the right token',()=>{
 const p=(token:string,challenge='abc123',mode='subscribe')=>new URLSearchParams({'hub.mode':mode,'hub.verify_token':token,'hub.challenge':challenge});
 assert.equal(verifySubscription(p('verify-me'),'verify-me'),'abc123');
 assert.equal(verifySubscription(p('wrong'),'verify-me'),null);
 assert.equal(verifySubscription(p('verify-me','abc123','unsubscribe'),'verify-me'),null);
 assert.equal(verifySubscription(p('verify-me','<script>'),'verify-me'),null);
});

test('referrals, consent postbacks and stop words become events; everything else is ignored',()=>{
 const ref='Abc_def-0123456789xyzABCDEFGHIJKL';
 assert.deepEqual(parseMessengerWebhook(msg({referral:{ref,source:'SHORTLINK',type:'OPEN_THREAD'}})).map(e=>e.event),[{kind:'referral',pageId:PAGE,psid:PSID,timestamp:1700000000000,ref}]);
 assert.equal(parseMessengerWebhook(msg({postback:{payload:'GET_STARTED',referral:{ref}}}))[0].event.kind,'referral');
 const id='0f8fad5b-d9cb-469f-a165-70867728950e';
 assert.deepEqual(parseMessengerWebhook(msg({postback:{payload:`BITPOS_CONSENT_ACCEPT:${id}`}}))[0].event,{kind:'consent',pageId:PAGE,psid:PSID,timestamp:1700000000000,requestId:id,accept:true});
 assert.equal((parseMessengerWebhook(msg({message:{mid:'m1',quick_reply:{payload:`BITPOS_CONSENT_DECLINE:${id}`}}}))[0].event as any).accept,false);
 assert.equal(parseMessengerWebhook(msg({message:{mid:'m2',text:' ลบข้อมูล '}}))[0].event.kind,'revoke');
 assert.equal(parseMessengerWebhook(msg({message:{mid:'m3',text:'STOP'}}))[0].event.kind,'revoke');
 assert.equal(parseMessengerWebhook(msg({message:{mid:'m4',text:'ขอเมนูหน่อย'}})).length,0);
 assert.equal(parseMessengerWebhook(msg({referral:{ref:'short'}})).length,0);
 assert.equal(parseMessengerWebhook(msg({postback:{payload:'BITPOS_CONSENT_ACCEPT:not-a-uuid'}})).length,0);
 // An event whose recipient is not the entry's page is dropped.
 assert.equal(parseMessengerWebhook({object:'page',entry:[{id:'1111111111',messaging:[{sender:{id:PSID},recipient:{id:PAGE},timestamp:1,referral:{ref}}]}]}).length,0);
 assert.throws(()=>parseMessengerWebhook({object:'instagram',entry:[]}),code('PAYLOAD_INVALID'));
 // Retried deliveries of the same event keep the same idempotency key.
 assert.deepEqual(parseMessengerWebhook(msg({referral:{ref}}))[0].key,parseMessengerWebhook(msg({referral:{ref}}))[0].key);
});

test('Send API puts the page token in a header, never in the URL',async()=>{
 let seen:{url:string;init:RequestInit}|undefined;
 await sendMessenger({appSecret:'s',verifyToken:'v',pageToken:'PAGE_TOKEN',graphVersion:'v24.0'},{kind:'buttons',psid:PSID,text:'hi',buttons:[{type:'postback',title:'Yes',payload:'X'}]},async(url,init)=>{seen={url,init};return new Response('{}',{status:200});});
 assert.equal(seen!.url,'https://graph.facebook.com/v24.0/me/messages');
 assert.ok(!seen!.url.includes('PAGE_TOKEN'));
 assert.equal((seen!.init.headers as Record<string,string>).Authorization,'Bearer PAGE_TOKEN');
 const body=JSON.parse(String(seen!.init.body));
 assert.equal(body.recipient.id,PSID);assert.equal(body.message.attachment.payload.template_type,'button');
 await assert.rejects(sendMessenger({appSecret:'s',verifyToken:'v',pageToken:'t',graphVersion:'v24.0'},{kind:'text',psid:PSID,text:'x'},async()=>new Response('{}',{status:400})),code('SEND_FAILED'));
});
