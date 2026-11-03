// Pays one demo order on the BitPOS devnet stack with a private devnet test wallet, over the public pay API
// (challenge -> bind -> attempt -> sign -> submit). Same canonical-quote path the web pay page uses; no money, devnet test tokens only.
// Usage: BITPOS_PAY_ORIGIN=https://pay.cashlessthailand.com BITPOS_PAY_KEY=/path/to/customer-alice.json tsx tools/runtime/oci-demo-pay.ts <access-token>
import {readFileSync} from 'node:fs';
import {Keypair,Transaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
const origin=process.env.BITPOS_PAY_ORIGIN??'https://pay.cashlessthailand.com',keyPath=process.env.BITPOS_PAY_KEY,access=process.argv[2];
if(!keyPath||!access)throw Error('usage: BITPOS_PAY_KEY=<keypair.json> tsx oci-demo-pay.ts <access-token>');
const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath,'utf8'))));
async function call<T>(path:string,body:unknown):Promise<T>{
 const r=await fetch(`${origin}/api/pay/${access}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const j=await r.json();if(!r.ok)throw Error(`${path} ${r.status} ${JSON.stringify(j).slice(0,200)}`);return j as T;
}
const challenge=await call<{id:string;message:string}>('/challenge',{address:wallet.publicKey.toBase58()});
await call('/bind',{challengeId:challenge.id,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message),wallet.secretKey))});
const attempt=await call<{id:string;base64:string}>('/attempt',{});
const tx=Transaction.from(Buffer.from(attempt.base64,'base64'));tx.partialSign(wallet);
const submitted=await call<Record<string,unknown>>('/submit',{attemptId:attempt.id,base64:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')});
console.log(JSON.stringify({payer:wallet.publicKey.toBase58(),submitted}).slice(0,400));
