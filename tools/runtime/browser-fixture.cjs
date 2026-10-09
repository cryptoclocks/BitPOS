'use strict';
// Host-only signing fixture. Never installs keys in browser; never overrides settlement.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {Keypair,Transaction,PublicKey}=require('@solana/web3.js');const nacl=require('tweetnacl');const bs58=require('bs58').default;const pg=require('pg');
const root=path.resolve(__dirname,'../..');const config=require('dotenv').parse(fs.readFileSync(path.join(root,'.env')));
const vault=config.DEVNET_PRIVATE_DIR;const wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(vault,'keys/customer-no-sol.json'),'utf8'))));
const manifest=JSON.parse(fs.readFileSync(path.join(vault,'wallets.public.json'),'utf8'));const sponsor=new PublicKey(manifest.wallets.find(w=>w.id==='fee-sponsor').address);
async function query(sql,args){const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();try{return (await db.query(sql,args)).rows;}finally{await db.end();}}
module.exports=async function install(page,orderId){
 assert.match(orderId,/^[0-9a-f-]{36}$/);
 await page.exposeFunction('bitposFixtureSignMessage',async bytes=>{
  const message=Buffer.from(bytes).toString('utf8');
  const rows=await query("SELECT c.id FROM bitpos.challenges c JOIN bitpos.orders o ON o.id=c.order_id WHERE c.order_id=$1 AND c.address=$2 AND c.message=$3 AND c.used_at IS NULL AND c.expires_at>now() AND o.quote_expires_at>now() AND o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT')",[orderId,wallet.publicKey.toBase58(),message]);assert.equal(rows.length,1,'fixture signs only server-issued live challenge for its fixed order');
  return Array.from(nacl.sign.detached(Buffer.from(message),wallet.secretKey));
 });
 await page.exposeFunction('bitposFixtureSignTransaction',async bytes=>{
  const tx=Transaction.from(Buffer.from(bytes));
  const rows=await query("SELECT a.* FROM bitpos.payment_attempts a JOIN bitpos.orders o ON o.id=a.order_id WHERE a.order_id=$1 AND a.payer=$2 AND a.status='READY' AND o.quote_expires_at>now() AND o.status='AWAITING_PAYMENT'",[orderId,wallet.publicKey.toBase58()]);assert.equal(rows.length,1);
  assert.ok(manifest.wallets.some(role=>role.address===rows[0].recipient),'demo fixture refuses external/fresh wallet targets');
  const expected=Transaction.from(Buffer.from(rows[0].transaction_base64,'base64'));assert.ok(tx.serializeMessage().equals(expected.serializeMessage()));assert.ok(tx.feePayer.equals(sponsor));
  const signature=tx.signatures.find(s=>s.publicKey.equals(sponsor))?.signature;assert.ok(signature&&nacl.sign.detached.verify(tx.serializeMessage(),signature,sponsor.toBytes()));
  tx.partialSign(wallet);assert.ok(tx.verifySignatures());const signed=tx.serialize();const transactionSignature=bs58.encode(tx.signature);
  fs.writeFileSync(path.join(vault,'transactions',transactionSignature+'.json'),JSON.stringify({signature:transactionSignature,lastValidBlockHeight:rows[0].last_valid_height,serialized:signed.toString('base64'),event:{type:'browser-fixture',orderId}})+'\n',{mode:0o600});
  fs.appendFileSync(path.join(vault,'activity.jsonl'),JSON.stringify({at:new Date().toISOString(),cluster:'devnet',type:'signed',signature:transactionSignature,orderId,fixture:'browser dedicated test-wallet; physical mobile deferred'})+'\n',{mode:0o600});
  return Array.from(signed);
 });
 await page.evaluate(address=>{window.__BITPOS_TEST_WALLET__={isBitPOSTestFixture:true,connect:async()=>({address}),signMessage:async bytes=>Uint8Array.from(await window.bitposFixtureSignMessage(Array.from(bytes))),signTransaction:async bytes=>Uint8Array.from(await window.bitposFixtureSignTransaction(Array.from(bytes)))};},wallet.publicKey.toBase58());
 return {fixture:true,address:wallet.publicKey.toBase58(),fixedOrderId:orderId};
};
