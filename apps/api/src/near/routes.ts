// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// HTTP routes for NEAR, wired into the API server chain like serveX402. Customer routes are keyed by the bill's
// access token (same authority as the existing /api/pay/:token routes); device routes by device id + bearer key.
//   GET  /api/pay/:token/near             status, amount, who gets paid (no chain call)
//   POST /api/pay/:token/near/bill        open or return the live on-chain bill for this order
//   POST /api/pay/:token/near/relay       {signedDelegate} the customer's gasless payment, relayed if it is exactly this bill
//   POST /api/pay/:token/near/submitted   {txHash,signerId} a payment the wallet sent itself
//   POST /api/pay/:token/near/demo-pay    {wallet} a labelled testnet demo wallet pays
//   POST /api/pay/:token/near/reclaim     send an unwitnessed payment back to the payer after the window
//   POST /api/pay/:token/near/faucet      {account} testnet demo tokens for a visitor's own wallet
//   GET  /api/pay/:token/near/crosschain  mainnet PREVIEW (dry quotes): this bill paid from another chain's stablecoin
//   POST /api/pay/:token/near/pass        {wallet,ttl,cap,maxBill} demo wallet funds an AI spending pass for this café
//   POST /api/pay/:token/near/pass-status {owner,passId}   POST pass-pay {owner,passId} the AI agent pays this bill
//   POST /api/pay/:token/near/pass-close  {owner,passId} end the pass; the unspent balance goes back to the owner
//   GET  /near/device/state?d=&l=         POST /near/device/register?d=   POST /near/device/ack?d=
//   (the same three also under /api/near-device/ so a browser screen can reach them through the web proxy)
import type {IncomingMessage,ServerResponse} from 'node:http';
import {z} from 'zod';
import {RequestError} from '../authority';
import {isAccountId} from './chain';
import {NearRouteError,createNearBill,demoPay,nearDeps,nearStatus,reclaimBill,relayPayment,submittedPayment} from './bills';
import {closePass,createPass,passPay,passStatus} from './passes';
import {deviceAck,deviceRegister,deviceState} from './device';
import {intentsEnabled,intentsPreview} from './intents';
import {pool,tenant} from '../db';
import {settingsOf} from './bills';

const PAY=/^\/api\/pay\/([A-Za-z0-9_-]{20,128})\/near(?:\/(bill|relay|submitted|demo-pay|reclaim|faucet|crosschain|pass|pass-status|pass-pay|pass-close))?$/;
const DEVICE=/^\/(?:near\/device|api\/near-device)\/(state|register|ack)$/;
const account=z.string().refine(v=>isAccountId(v)&&v.endsWith('.testnet'));
const relayBody=z.object({signedDelegate:z.string().regex(/^[A-Za-z0-9+/=]{100,6000}$/)}).strict();
const submittedBody=z.object({txHash:z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/),signerId:account}).strict();
const demoBody=z.object({wallet:account}).strict();
const passBody=z.object({wallet:account,ttl:z.enum(['30m','1h','1d','1w','1mo']),cap:z.string().max(12),maxBill:z.string().max(12)}).strict();
const passRef=z.object({owner:account,passId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)}).strict();
const passPayBody=passRef.extend({rule:z.string().max(200).optional()}).strict();
const faucetBody=z.object({account}).strict();
const registerBody=z.object({pk:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
const ackBody=z.object({bill:z.string().regex(/^b[0-9a-f]{32}$/),sig:z.string().regex(/^[0-9a-f]{128}$/),pk:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
function json(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));}
async function readJson(req:IncomingMessage,limit=8192):Promise<unknown>{
 let size=0;const chunks:Buffer[]=[];
 for await(const chunk of req){size+=chunk.length;if(size>limit)throw new NearRouteError(413,'REQUEST_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 const text=Buffer.concat(chunks).toString('utf8');return text?JSON.parse(text):{};
}

// Demo faucet: at most 20 test tokens per account per hour, only while the account holds less than one bill's worth.
const FAUCET_UNITS=20_000_000n,faucetSeen=new Map<string,number>();
async function faucet(token:string,accountId:string){
 const d=nearDeps()??(()=>{throw new NearRouteError(503,'NEAR_UNAVAILABLE');})();
 const merchant=(await pool.query('SELECT bitpos.resolve_access($1) AS merchant',[token])).rows[0]?.merchant as string|undefined;
 if(!merchant)throw new NearRouteError(404,'RESOURCE_NOT_FOUND');
 const s=await tenant(merchant,db=>settingsOf(db,merchant));
 if(!s?.enabled||!d.chain.hasKey(s.token_contract))throw new NearRouteError(409,'NEAR_FAUCET_UNAVAILABLE');
 if(Date.now()-(faucetSeen.get(accountId)??0)<3_600_000)throw new NearRouteError(429,'NEAR_FAUCET_LIMIT');
 if(!await d.chain.accountExists(accountId))throw new NearRouteError(422,'NEAR_ACCOUNT_NOT_FOUND');
 if(!await d.chain.isRegistered(s.token_contract,accountId))await d.chain.register(s.token_contract,accountId);
 if(await d.chain.ftBalance(s.token_contract,accountId)>=FAUCET_UNITS)return {ok:true,sent:false};
 faucetSeen.set(accountId,Date.now());
 const tx=await d.chain.faucet(s.token_contract,accountId,FAUCET_UNITS);
 return {ok:tx.ok,sent:tx.ok,tx:tx.hash};
}

export async function serveNear(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
 const url=new URL(req.url??'/','http://localhost');const pay=url.pathname.match(PAY),device=pay?null:url.pathname.match(DEVICE);
 if(!pay&&!device)return false;
 try{
  if(device){
   const id=url.searchParams.get('d')??'',key=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]??'';
   if(device[1]==='state'){if(req.method!=='GET')throw new NearRouteError(405,'METHOD_NOT_ALLOWED');json(res,200,await deviceState(id,key,url.searchParams.get('l')==='th'?'th':'en'));return true;}
   if(req.method!=='POST')throw new NearRouteError(405,'METHOD_NOT_ALLOWED');
   json(res,200,device[1]==='register'?await deviceRegister(id,key,registerBody.parse(await readJson(req)).pk):await deviceAck(id,key,ackBody.parse(await readJson(req))));
   return true;
  }
  if(url.search)throw new NearRouteError(404,'RESOURCE_NOT_FOUND');
  const [,token,action]=pay!;
  if(!action){if(req.method!=='GET')throw new NearRouteError(405,'METHOD_NOT_ALLOWED');json(res,200,await nearStatus(token));return true;}
  if(action==='crosschain'){
   // Mainnet PREVIEW only (dry quotes): what a customer holding another chain's stablecoin would pay for this bill.
   if(req.method!=='GET')throw new NearRouteError(405,'METHOD_NOT_ALLOWED');if(!intentsEnabled())throw new NearRouteError(404,'RESOURCE_NOT_FOUND');
   const status=await nearStatus(token);if(!status.amount)throw new NearRouteError(409,'NEAR_AMOUNT_NOT_EXACT');
   json(res,200,await intentsPreview('pay-in',BigInt(status.amount.units)));return true;
  }
  if(req.method!=='POST')throw new NearRouteError(405,'METHOD_NOT_ALLOWED');
  const body=await readJson(req);
  if(action==='bill'){z.object({}).strict().parse(body);json(res,200,await createNearBill(token));}
  else if(action==='relay')json(res,200,await relayPayment(token,relayBody.parse(body).signedDelegate));
  else if(action==='submitted'){const b=submittedBody.parse(body);json(res,200,await submittedPayment(token,b.txHash,b.signerId));}
  else if(action==='pass')json(res,200,await createPass(token,passBody.parse(body)));
  else if(action==='pass-status'){const b=passRef.parse(body);json(res,200,await passStatus(token,b.owner,b.passId));}
  else if(action==='pass-pay'){const b=passPayBody.parse(body);json(res,200,await passPay(token,b.owner,b.passId,b.rule));}
  else if(action==='pass-close'){const b=passRef.parse(body);json(res,200,await closePass(token,b.owner,b.passId));}
  else if(action==='demo-pay')json(res,200,await demoPay(token,demoBody.parse(body).wallet));
  else if(action==='reclaim'){z.object({}).strict().parse(body);json(res,200,await reclaimBill(token));}
  else json(res,200,await faucet(token,faucetBody.parse(body).account));
 }catch(error){
  if(error instanceof NearRouteError)json(res,error.status,{error:error.code});
  else if(error instanceof RequestError)json(res,error.status,{error:error.code});
  else if(error instanceof z.ZodError||error instanceof SyntaxError)json(res,422,{error:'INVALID_REQUEST'});
  else if((error as {code?:string}).code==='55P03')json(res,409,{error:'PAYMENT_PENDING'});
  else{console.error('NEAR route failed',(error as Error).message);json(res,503,{error:'NEAR_UNAVAILABLE'});}
 }
 return true;
}
