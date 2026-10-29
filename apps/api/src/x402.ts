import type {IncomingMessage,ServerResponse} from 'node:http';
import type pg from 'pg';
import type {Address} from '@solana/kit';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import type {PaymentPayload,PaymentRequired,PaymentRequirements} from '@x402/core/types';
import type {PendingSettlementStore} from '@x402/core/facilitator';
import {ExactSvmScheme} from '@x402/svm/exact/facilitator';
import type {FacilitatorSvmSigner} from '@x402/svm';
import {decodePaymentSignatureHeader,encodePaymentRequiredHeader,encodePaymentResponseHeader} from '@x402/core/http';
import bs58 from 'bs58';
import {z} from 'zod';
import {pool,tenant} from './db';
import {chain,loadSponsor,assertCluster,mintPolicy,ata} from './payments';
import {frozenAttempt,selectedQuote} from './payment-assets';
import {settleAttempt,orderView,emitOrder} from './orders';
import {fail,RequestError} from './authority';
import {liveOrder} from '../../../packages/domain/src/index';
import {customerOrigin} from './config';
import type {AttemptRow,OrderRow} from './types';
import {X402_NETWORK,X402_USDC,x402Memo,readX402Binding,assertX402Message,verifyX402Transfer,type X402Attempt,type X402Binding} from './x402-payment';
import {assertOrderRepeatLimit} from './coffee-order-constraints';
import {associateProvenWallet} from './wallet-proof';
import {assertOnlinePaymentAuthorization} from './online-acceptance-policy';
const requestSchema=z.object({address:z.string().max(44).refine(v=>{try{return PublicKey.isOnCurve(new PublicKey(v).toBytes());}catch{return false;}})}).strict();
export interface TrustedX402Grant {grantId:string;holdId:string;transferAuthority:string;memoBinding:string;bindAttempt(db:pg.PoolClient,a:X402Attempt):Promise<void>;assertAttempt(db:pg.PoolClient,attemptId:string,phase:'sign'|'send'):Promise<void>;}
async function locked<T>(a:AttemptRow,fn:(db:pg.PoolClient,current:AttemptRow)=>Promise<T>){return tenant(a.merchant_id,async db=>{await db.query('SELECT id FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[a.merchant_id,a.order_id]);const current=(await db.query<AttemptRow>('SELECT * FROM payment_attempts WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[a.merchant_id,a.id])).rows[0];if(!current)fail('RESOURCE_NOT_FOUND',404);return fn(db,current);});}
export async function prepareX402(merchant:string,access:string,payer:string,grant?:TrustedX402Grant):Promise<X402Attempt>{
 if(grant&&!/^[0-9a-f]{64}$/.test(grant.memoBinding))fail('INVALID_REQUEST',422);
 // Recover issued authorization using only durable state; RPC availability is not replay authority.
 const snapshot=await tenant(merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND access_token=$2 FOR UPDATE',[merchant,access])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);if(o.payer&&o.payer!==payer)fail('WALLET_CONFLICT');
  const old=(await db.query<AttemptRow>("SELECT * FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2 AND (status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED','FINALIZED') OR ((signature IS NOT NULL OR signed_base64 IS NOT NULL) AND failure_reconciled_at IS NULL)) ORDER BY created_at LIMIT 1",[merchant,o.id])).rows[0];
  if(old){const x402=await readX402Binding(db,old);if(!x402)fail('PAYMENT_PENDING');if(old.payer!==payer||x402.grantId!==grant?.grantId||x402.holdId!==grant?.holdId)fail('WALLET_CONFLICT');return {kind:'issued' as const,attempt:{...await frozenAttempt(db,old),x402}};}
  if(!grant&&(await db.query("SELECT 1 FROM delegated_holds WHERE merchant_id=$1 AND order_id=$2 AND state='HELD'",[merchant,o.id])).rowCount)fail('PAYMENT_PENDING');
  liveOrder(o);await assertOnlinePaymentAuthorization(db,o);const q=await selectedQuote(db,o);if(new Date(q.expires_at).getTime()<=Date.now())fail('QUOTE_EXPIRED');if(q.descriptor.assetId!=='usdc-devnet'||q.descriptor.mint!==X402_USDC)fail('PAYMENT_ASSET_UNAVAILABLE',422);await assertOrderRepeatLimit(db,merchant,o.id,q.settlement);return {kind:'quote' as const,orderId:o.id,quote:q};
 });
 if(snapshot.kind==='issued')return snapshot.attempt;
 await assertCluster();await mintPolicy(snapshot.quote.descriptor);
 const accounts=await chain.getMultipleAccountsInfo([ata(payer,snapshot.quote.descriptor),ata(snapshot.quote.settlement.recipient,snapshot.quote.descriptor)],'finalized');if(accounts.some(a=>!a))fail('INSUFFICIENT_BALANCE',422);
 const latest=await chain.getLatestBlockhash('finalized'),feePayer=loadSponsor().publicKey.toBase58();if(payer===feePayer||payer===snapshot.quote.settlement.recipient)fail('INVALID_PAYMENT_PARTICIPANT',422);
 return tenant(merchant,async db=>{
  const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND access_token=$2 FOR UPDATE',[merchant,access])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);if(o.payer&&o.payer!==payer)fail('WALLET_CONFLICT');
  const old=(await db.query<AttemptRow>("SELECT * FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2 AND (status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED','FINALIZED') OR ((signature IS NOT NULL OR signed_base64 IS NOT NULL) AND failure_reconciled_at IS NULL)) ORDER BY created_at LIMIT 1",[merchant,o.id])).rows[0];
  if(old){const x402=await readX402Binding(db,old);if(!x402)fail('PAYMENT_PENDING');if(old.payer!==payer||x402.grantId!==grant?.grantId||x402.holdId!==grant?.holdId)fail('WALLET_CONFLICT');return {...await frozenAttempt(db,old),x402};}
  liveOrder(o);await assertOnlinePaymentAuthorization(db,o);const q=await selectedQuote(db,o);if(new Date(q.expires_at).getTime()<=Date.now()||o.id!==snapshot.orderId||q.id!==snapshot.quote.id||!isDeepStrictEqual(q.descriptor,snapshot.quote.descriptor)||!isDeepStrictEqual(q.settlement,snapshot.quote.settlement))fail('QUOTE_EXPIRED');
  if(!grant&&(await db.query("SELECT 1 FROM delegated_holds WHERE merchant_id=$1 AND order_id=$2 AND state='HELD'",[merchant,o.id])).rowCount)fail('PAYMENT_PENDING');
  await assertOrderRepeatLimit(db,merchant,o.id,q.settlement);
  if((await db.query("SELECT count(*)::int AS n FROM payment_attempts WHERE payer=$1 AND created_at>now()-interval '1 minute'",[payer])).rows[0].n>=3)fail('SPONSOR_RATE_LIMIT',429);
  await db.query('INSERT INTO sponsor_days(day) VALUES(current_date) ON CONFLICT DO NOTHING');await db.query('INSERT INTO sponsor_orders(order_id,merchant_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[o.id,merchant]);
  if(!(await db.query('UPDATE sponsor_days SET reserved_lamports=reserved_lamports+1000000 WHERE day=current_date AND reserved_lamports+1000000<=260000000 RETURNING day')).rowCount||!(await db.query('UPDATE sponsor_orders SET reserved_lamports=reserved_lamports+1000000 WHERE merchant_id=$1 AND order_id=$2 AND reserved_lamports+1000000<=1000000 RETURNING order_id',[merchant,o.id])).rowCount)fail('SPONSOR_BUDGET_EXHAUSTED',429);
  const a=(await db.query<AttemptRow>('INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[merchant,o.id,Keypair.generate().publicKey.toBase58(),payer,q.settlement.recipient,q.settlement.amountMinor,q.descriptor.mint,q.descriptor.tokenProgram])).rows[0];
  const resource=customerOrigin+'/api/pay/'+access+'/x402',memo=x402Memo(merchant,o.id,a.id,a.reference,grant?.memoBinding??null);
  const requirements:PaymentRequirements={scheme:'exact',network:X402_NETWORK,asset:X402_USDC,amount:a.amount_minor,payTo:a.recipient,maxTimeoutSeconds:60,extra:{feePayer,memo,orderId:o.id,recentBlockhash:latest.blockhash,lastValidBlockHeight:String(latest.lastValidBlockHeight)}};
  const x402:X402Binding={kind:'x402',merchantId:merchant,orderId:o.id,attemptId:a.id,quoteId:q.id,owner:payer,transferAuthority:grant?.transferAuthority??payer,...(grant?{grantId:grant.grantId,holdId:grant.holdId}:{}),resource,memo,feePayer,blockhash:latest.blockhash,lastValidHeight:String(latest.lastValidBlockHeight),requirements};
  await db.query('INSERT INTO x402_attempt_bindings(merchant_id,order_id,attempt_id,quote_id,binding) VALUES($1,$2,$3,$4,$5)',[merchant,o.id,a.id,q.id,x402]);
  await db.query("UPDATE payment_attempts SET blockhash=$3,last_valid_height=$4,status='READY' WHERE merchant_id=$1 AND id=$2",[merchant,a.id,latest.blockhash,String(latest.lastValidBlockHeight)]);
  const frozen={...await frozenAttempt(db,{...a,blockhash:latest.blockhash,last_valid_height:String(latest.lastValidBlockHeight),status:'READY'}),x402};if(grant)await grant.bindAttempt(db,frozen);return frozen;
 });
}
function facilitator(a:X402Attempt,grant?:TrustedX402Grant){
 const store:PendingSettlementStore={
  get:key=>tenant(a.merchant_id,async db=>(await db.query('SELECT signature FROM x402_pending_settlements WHERE merchant_id=$1 AND attempt_id=$2 AND message_hash=$3',[a.merchant_id,a.id,key])).rows[0]?.signature),
  set:(key,signature)=>locked(a,async(db,current)=>{if(current.signature!==signature||!current.signed_base64)throw Error('Unjournaled settlement');await db.query('INSERT INTO x402_pending_settlements(merchant_id,attempt_id,message_hash,signature) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[a.merchant_id,a.id,key,signature]);}),
  // SDK deletes before re-confirming. Preserve unknown outcomes rather than erasing recovery authority.
  delete:key=>locked(a,async(db)=>{await db.query("DELETE FROM x402_pending_settlements s USING payment_attempts p WHERE s.merchant_id=$1 AND s.attempt_id=$2 AND s.message_hash=$3 AND p.id=s.attempt_id AND p.merchant_id=s.merchant_id AND (p.status='FINALIZED' OR p.failure_reconciled_at IS NOT NULL)",[a.merchant_id,a.id,key]);})
 };
 const signer:FacilitatorSvmSigner={
  getAddresses:()=>[a.x402.feePayer as Address],
  simulateTransaction:async(base64,network)=>{if(network!==X402_NETWORK)throw Error('Wrong network');const tx=assertX402Message(base64,a);const result=await chain.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed'});if(result.value.err)throw Error('Simulation rejected');},
  signTransaction:async(base64,feePayer,network)=>{if(network!==X402_NETWORK||feePayer!==a.x402.feePayer)throw Error('Wrong sponsor');const tx=assertX402Message(base64,a);
   return locked(a,async(db,current)=>{if(current.signed_base64){const journal=VersionedTransaction.deserialize(Buffer.from(current.signed_base64,'base64'));if(!Buffer.from(journal.message.serialize()).equals(Buffer.from(tx.message.serialize()))||!Buffer.from(journal.signatures[1]).equals(Buffer.from(tx.signatures[1])))throw Error('Authorization conflict');return current.signed_base64;}if(current.status!=='READY'||Date.now()>=Date.parse(a.payment.expiresAt))throw Error('Attempt not signable');await assertOrderRepeatLimit(db,a.merchant_id,a.order_id,a.payment.settlement);if(a.x402.grantId){if(!grant||grant.grantId!==a.x402.grantId||grant.holdId!==a.x402.holdId||grant.transferAuthority!==a.x402.transferAuthority)throw Error('Grant required');await grant.assertAttempt(db,a.id,'sign');}
    const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[a.merchant_id,a.order_id])).rows[0];liveOrder(o);await assertOnlinePaymentAuthorization(db,o);if(o.payer&&o.payer!==a.payer)fail('WALLET_CONFLICT');const selected=await selectedQuote(db,o);if(selected.id!==a.payment.quoteId)fail('QUOTE_EXPIRED');await associateProvenWallet(db,o,a.payer);const updated=(await db.query<OrderRow>("UPDATE orders SET payer=$3,status='AWAITING_PAYMENT',version=version+1 WHERE merchant_id=$1 AND id=$2 RETURNING *",[a.merchant_id,a.order_id,a.payer])).rows[0];await emitOrder(db,updated);
    tx.sign([loadSponsor()]);const signed=Buffer.from(tx.serialize()).toString('base64'),signature=bs58.encode(tx.signatures[0]);assertX402Message(signed,a,true);await db.query("UPDATE payment_attempts SET transaction_base64=$3,signed_base64=$4,signature=$5,status='SUBMITTING',submitted_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[a.merchant_id,a.id,base64,signed,signature]);const key=createHash('sha256').update(tx.message.serialize()).digest('base64');await db.query('INSERT INTO x402_pending_settlements(merchant_id,attempt_id,message_hash,signature) VALUES($1,$2,$3,$4)',[a.merchant_id,a.id,key,signature]);return signed;});},
  sendTransaction:async(base64,network)=>{if(network!==X402_NETWORK)throw Error('Wrong network');return locked(a,async(db,current)=>{if(current.signed_base64!==base64||!current.signature)throw Error('Unjournaled broadcast');if(a.x402.grantId){if(!grant||grant.grantId!==a.x402.grantId||grant.holdId!==a.x402.holdId)throw Error('Grant required');await grant.assertAttempt(db,a.id,'send');}
   // Keep order/attempt/grant fence through dispatch. Unknown sends retain the journal.
   try{const signature=await chain.sendRawTransaction(Buffer.from(base64,'base64'),{skipPreflight:false,maxRetries:0});if(signature!==current.signature)throw Error('Signature mismatch');}catch{/* Unknown send is not evidence of failure. */}
   await db.query("UPDATE payment_attempts SET status='SUBMITTED' WHERE merchant_id=$1 AND id=$2 AND status='SUBMITTING'",[a.merchant_id,a.id]);return current.signature;});},
  confirmTransaction:async(signature,network)=>{if(network!==X402_NETWORK)throw Error('Wrong network');const current=await locked(a,async(_db,current)=>current),proof=await verifyX402Transfer(signature,{...a,...current},'finalized');if(!proof)throw Error('Finalization pending');await locked(a,async(db,current)=>{if(current.signature!==signature)throw Error('Signature mismatch');await db.query('UPDATE payment_attempts SET fee_lamports=$3 WHERE merchant_id=$1 AND id=$2',[a.merchant_id,a.id,proof.fee]);await settleAttempt(db,current,true);});return {slot:proof.slot};}
 };
 return new ExactSvmScheme(signer,undefined,{enableSmartWalletVerification:false,maxComputeUnits:20000,maxPriorityFeeMicroLamports:1,maxRequiredSignatures:2,pendingSettlementStore:store});
}
function json(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));}
// Trusted grant callers use the same SDK verification, journal and settlement gate.
export async function acceptX402(a:X402Attempt,header:string,grant?:TrustedX402Grant){
 if(header.length>16384)fail('INVALID_TRANSACTION',422);let payload:PaymentPayload;try{payload=decodePaymentSignatureHeader(header);}catch{fail('INVALID_TRANSACTION',422);}
 if(payload.x402Version!==2||payload.resource?.url!==a.x402.resource||!isDeepStrictEqual(payload.accepted,a.x402.requirements)||typeof payload.payload.transaction!=='string')fail('INVALID_TRANSACTION',422);
 const incoming=VersionedTransaction.deserialize(Buffer.from(payload.payload.transaction,'base64'));
 if(a.signed_base64){const journal=VersionedTransaction.deserialize(Buffer.from(a.signed_base64,'base64'));if(!Buffer.from(incoming.message.serialize()).equals(Buffer.from(journal.message.serialize()))||!Buffer.from(incoming.signatures[1]).equals(Buffer.from(journal.signatures[1])))fail('INVALID_TRANSACTION',422);
  const proof=await verifyX402Transfer(a.signature!,a,'finalized');if(proof){await locked(a,async(db,current)=>{await db.query('UPDATE payment_attempts SET fee_lamports=$3 WHERE merchant_id=$1 AND id=$2',[a.merchant_id,a.id,proof.fee]);await settleAttempt(db,current,true);});return {status:'paid' as const,signature:a.signature!,responseHeader:encodePaymentResponseHeader({success:true,network:X402_NETWORK,transaction:a.signature!,payer:a.x402.transferAuthority})};}return {status:'pending' as const,signature:a.signature!};
 }
 assertX402Message(payload.payload.transaction,a);const sdk=facilitator(a,grant),valid=await sdk.verify(payload,a.x402.requirements);if(!valid.isValid)fail('INVALID_TRANSACTION',422);const result=await sdk.settle(payload,a.x402.requirements);
 if(result.success)return {status:'paid' as const,signature:result.transaction,responseHeader:encodePaymentResponseHeader(result)};
 const current=await locked(a,async(_db,current)=>current);return current.signature?{status:'pending' as const,signature:current.signature}:{status:'rejected' as const,error:result.errorReason};
}
export async function serveX402(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 const url=new URL(req.url??'/',customerOrigin),match=url.pathname.match(/^\/api\/pay\/([A-Za-z0-9_-]{20,128})\/x402$/);if(url.pathname!=='/api/x402/supported'&&!match)return false;
 try{
  if(url.search)fail('RESOURCE_NOT_FOUND',404);
  if(url.pathname==='/api/x402/supported'){if(req.method!=='GET')fail('RESOURCE_NOT_FOUND',405);const feePayer=loadSponsor().publicKey.toBase58();json(res,200,{kinds:[{x402Version:2,scheme:'exact',network:X402_NETWORK,extra:{feePayer}}],extensions:[],signers:{'solana:*':[feePayer]}});return true;}
  if(req.method!=='POST')fail('RESOURCE_NOT_FOUND',405);let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>1024)fail('REQUEST_TOO_LARGE',413);chunks.push(Buffer.from(chunk));}const input=requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const merchant=(await pool.query('SELECT bitpos.resolve_access($1) AS merchant',[match![1]])).rows[0]?.merchant;if(!merchant)fail('RESOURCE_NOT_FOUND',404);const a=await prepareX402(merchant,match![1],input.address);
  const header=req.headers['payment-signature'];if(header===undefined){const required:PaymentRequired={x402Version:2,resource:{url:a.x402.resource,description:'Canonical BitPOS order checkout',mimeType:'application/json'},accepts:[a.x402.requirements]};res.setHeader('PAYMENT-REQUIRED',encodePaymentRequiredHeader(required));json(res,402,required);return true;}
  if(typeof header!=='string')fail('INVALID_TRANSACTION',422);const result=await acceptX402(a,header);
  if(result.status==='paid'){res.setHeader('PAYMENT-RESPONSE',result.responseHeader);const order=await tenant(merchant,async db=>{const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,a.order_id])).rows[0];return orderView(db,o,true);});json(res,200,{status:'paid',signature:result.signature,order});}
  else json(res,result.status==='pending'?202:422,result);
 }catch(error){if(error instanceof RequestError)json(res,error.status,{error:error.code});else if(error instanceof z.ZodError||error instanceof SyntaxError)json(res,422,{error:'INVALID_REQUEST'});else json(res,503,{error:'PAYMENT_UNAVAILABLE'});}
 return true;
}
