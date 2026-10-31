// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Unit tests (plan/05 U-WH) for offline PayPal webhook signature verification. A throwaway RSA key and self-signed
// certificate are generated with openssl per run and served by a stub in place of PayPal's certificate URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSign} from 'node:crypto';
import {crc32} from 'node:zlib';
import {webhookVerifier,webhookHeaders,allowedCertUrl} from '../apps/api/src/paypal/webhook-verify';
import {PayPalError} from '../apps/api/src/paypal/config';

const dir=mkdtempSync(join(tmpdir(),'paypal-wh-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'k.pem'),'-out',join(dir,'c.pem'),'-days','2','-subj','/CN=messageverificationcerts.sandbox.paypal.com'],{stdio:'ignore'});
const key=readFileSync(join(dir,'k.pem'),'utf8'),cert=readFileSync(join(dir,'c.pem'),'utf8');rmSync(dir,{recursive:true,force:true});
const CERT_URL='https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-test';
const WEBHOOK_ID='8PT597110X687430LKGECATA';
// Whitespace and key order exactly as received: the signature covers these bytes, never a re-serialization.
const raw=Buffer.from('{"id":"WH-58D329510W468432D-8HN650336L201105X","event_type":"PAYMENT.CAPTURE.COMPLETED",  "resource":{"id":"3NJ75207B63619939","custom_id":"bitpos:v1:m:o:c"}}');
function sign(body:Buffer,webhookId=WEBHOOK_ID,id='b2384410-f8d2-11e8-8c5b-7b4c4b9d2a1f',time='2026-10-31T09:05:00Z'){
 const s=createSign('sha256');s.update(`${id}|${time}|${webhookId}|${crc32(body)>>>0}`);
 return {transmissionId:id,transmissionTime:time,certUrl:CERT_URL,transmissionSig:s.sign(key,'base64'),authAlgo:'SHA256withRSA'};
}
function verifier(){let fetches=0;const v=webhookVerifier(async url=>{fetches++;assert.equal(url,CERT_URL);return cert;});return {v,fetches:()=>fetches};}
const reason=async(p:Promise<void>)=>{try{await p;return 'OK';}catch(e){return (e as PayPalError).issue??(e as Error).message;}};

test('U-WH-01: a correct signature over the raw body verifies, and the certificate is cached',async()=>{
 const {v,fetches}=verifier();
 assert.equal(await reason(v(sign(raw),raw,WEBHOOK_ID)),'OK');assert.equal(await reason(v(sign(raw),raw,WEBHOOK_ID)),'OK');assert.equal(fetches(),1);
});

test('U-WH-02/05/06: any changed byte, other webhook id or re-serialized JSON fails',async()=>{
 const {v}=verifier();const h=sign(raw);
 const changed=Buffer.from(raw);changed[changed.length-3]^=1;
 assert.equal(await reason(v(h,changed,WEBHOOK_ID)),'WEBHOOK_SIGNATURE');
 assert.equal(await reason(v(h,raw,'OTHERWEBHOOKID00000000')),'WEBHOOK_SIGNATURE');
 assert.equal(await reason(v(h,Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),WEBHOOK_ID)),'WEBHOOK_SIGNATURE','parse+stringify changes the bytes');
 assert.equal(await reason(v({...h,transmissionTime:'2026-10-31T09:05:01Z'},raw,WEBHOOK_ID)),'WEBHOOK_SIGNATURE');
 assert.equal(await reason(v({...h,transmissionSig:'not base64 at all'},raw,WEBHOOK_ID)),'WEBHOOK_SIGNATURE');
 assert.equal(await reason(v({...h,authAlgo:'SHA1withRSA'},raw,WEBHOOK_ID)),'AUTH_ALGO');
});

test('U-WH-03: certificate URL must be https on a PayPal host, checked before any fetch',async()=>{
 for(const ok of [CERT_URL,'https://api.paypal.com/v1/notifications/certs/CERT-1'])assert.equal(allowedCertUrl(ok),true,ok);
 for(const bad of ['http://api.sandbox.paypal.com/c','https://api.sandbox.paypal.com.evil.com/c','https://evil.com/api.paypal.com','https://user:pw@api.paypal.com/c','https://api.paypal.com:8443/c','https://paypal.co/c','not a url'])assert.equal(allowedCertUrl(bad),false,bad);
 const {v,fetches}=verifier();
 assert.equal(await reason(v({...sign(raw),certUrl:'https://api.sandbox.paypal.com.evil.com/c'},raw,WEBHOOK_ID)),'CERT_URL');assert.equal(fetches(),0);
 const garbage=webhookVerifier(async()=>'-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----');
 assert.equal(await reason(garbage(sign(raw),raw,WEBHOOK_ID)),'CERT_INVALID');
 const expired=webhookVerifier(async()=>cert,()=>Date.now()+10*86400_000);
 assert.equal(await reason(expired(sign(raw),raw,WEBHOOK_ID)),'CERT_EXPIRED');
});

test('U-WH-04: missing or oversized headers are rejected; header names are case-insensitive',()=>{
 const h=sign(raw);const map=new Map(Object.entries({'paypal-transmission-id':h.transmissionId,'paypal-transmission-time':h.transmissionTime,'paypal-cert-url':h.certUrl,'paypal-transmission-sig':h.transmissionSig,'paypal-auth-algo':h.authAlgo}));
 const headers=new Headers([...map].map(([k,x])=>[k.toUpperCase(),x] as [string,string]));
 assert.deepEqual(webhookHeaders(n=>headers.get(n)),h);
 for(const k of ['paypal-transmission-id','paypal-transmission-time','paypal-cert-url','paypal-transmission-sig'])assert.equal(webhookHeaders(n=>n===k?null:map.get(n)),null,k);
 assert.equal(webhookHeaders(n=>n==='paypal-transmission-id'?'x'.repeat(200):map.get(n)),null);
 assert.equal(webhookHeaders(n=>n==='paypal-auth-algo'?null:map.get(n))?.authAlgo,null,'auth algo is optional');
});
