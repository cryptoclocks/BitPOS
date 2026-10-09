import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {PublicKey,Keypair} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {z} from 'zod';
import {config} from './config';
import {pool,tenant,audit} from './db';
import {counterQuote,createRoutedOrder,submission,dismissOrder,orderView,orderViews,emitOrder} from './orders';
import {cancelUnpaidOrder} from './order-closure';
import {currentScreen} from './device-commands';
import {avatar,hash,challengeMessage,liveOrder} from '../../../packages/domain/src/index';
import {build,validateSigned} from './payments';
import {paymentStream} from './payment-stream';
import {associateProvenWallet} from './wallet-proof';
import {attachDevices} from './devices';
import {tableRequest} from './table-ordering';
import {productOffer,effectiveMenu} from './offers';
import {pricingView,publishPrices} from './catalog';
import {registry} from './registry';
import {fail,RequestError,errorView,routingLock,requireRole,cart,serving,positive} from './authority';
import type {AttemptRow,OrderRow} from './types';
import {demoAccessEnabled,demoCredentials,demoRoles,type DemoRole} from './demo-auth';
const uuid=z.string().uuid();const address=z.string().refine(v=>{try{return new PublicKey(v).toBytes().length===32;}catch{return false;}});
const profile=z.object({name:z.string().max(120).optional(),phone:z.string().max(40).optional(),email:z.string().max(254).optional(),notes:z.string().max(2000).optional()}).strict();
async function body(req:http.IncomingMessage){let bytes=0;const parts:Buffer[]=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)fail('REQUEST_TOO_LARGE',413);parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
async function paymentAttempt(merchant:string,access:string,input:unknown){
 const requested=z.object({address:address.optional()}).strict().parse(input);
 const prepared=await tenant(merchant,async db=>{
 const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE access_token=$1 FOR UPDATE',[access])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);liveOrder(o);const payer=requested.address??o.payer;if(!payer)fail('WALLET_PROOF_REQUIRED',422);if(o.payer&&o.payer!==payer)fail('WALLET_CONFLICT',409);
 const old=(await db.query<AttemptRow>("SELECT * FROM payment_attempts WHERE order_id=$1 AND status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')",[o.id])).rows[0];if(old){if(old.payer!==payer)fail('WALLET_CONFLICT',409);return old;}
 if((await db.query("SELECT count(*)::int AS n FROM payment_attempts WHERE payer=$1 AND created_at>now()-interval '1 minute'",[payer])).rows[0].n>=3)fail('SPONSOR_RATE_LIMIT',429);
 await db.query('INSERT INTO sponsor_days(day) VALUES(current_date) ON CONFLICT DO NOTHING');await db.query('INSERT INTO sponsor_orders(order_id,merchant_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[o.id,merchant]);
 if(!(await db.query('UPDATE sponsor_days SET reserved_lamports=reserved_lamports+1000000 WHERE day=current_date AND reserved_lamports+1000000<=260000000 RETURNING day')).rowCount)fail('SPONSOR_BUDGET_EXHAUSTED',429);
 if(!(await db.query('UPDATE sponsor_orders SET reserved_lamports=reserved_lamports+1000000 WHERE order_id=$1 AND reserved_lamports+1000000<=1000000 RETURNING order_id',[o.id])).rowCount)fail('SPONSOR_BUDGET_EXHAUSTED',429);
 const settlement=(await orderView(db,o,true)).settlement;return (await db.query<AttemptRow>('INSERT INTO payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[merchant,o.id,Keypair.generate().publicKey.toBase58(),payer,settlement.recipient,settlement.amountMinor,settlement.mint,settlement.tokenProgram])).rows[0];
 });
 if(prepared.transaction_base64)return {id:prepared.id,base64:prepared.transaction_base64,lastValidHeight:Number(prepared.last_valid_height),blockhash:prepared.blockhash,reference:prepared.reference};
 // BUILDING survives crashes: retries reuse its frozen reference and one budget reservation.
 const tx=await build(prepared);
 return tenant(merchant,async db=>{
 const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[prepared.order_id])).rows[0];liveOrder(o);
 const a=(await db.query<AttemptRow>('SELECT * FROM payment_attempts WHERE id=$1 AND order_id=$2 FOR UPDATE',[prepared.id,o.id])).rows[0];
 if(a.status==='BUILDING')await db.query("UPDATE payment_attempts SET transaction_base64=$2,blockhash=$3,last_valid_height=$4,fee_lamports=$5,status='READY' WHERE id=$1",[a.id,tx.base64,tx.blockhash,tx.lastValidHeight,tx.fee]);else if(!a.transaction_base64)throw Error('Attempt is not ready');
 if(a.status==='BUILDING')await emitOrder(db,o);
 const committed=(await db.query<AttemptRow>('SELECT * FROM payment_attempts WHERE id=$1',[a.id])).rows[0];return {id:committed.id,base64:committed.transaction_base64,lastValidHeight:Number(committed.last_valid_height),blockhash:committed.blockhash,reference:committed.reference};
 });
}
const credentialsSchema=z.object({email:z.string().email(),password:z.string().min(1),merchantId:uuid.optional()});
async function login(credentials:z.infer<typeof credentialsSchema>,demoRole?:DemoRole){
 const response=await fetch(config.AUTH_URL+'/token?grant_type=password',{method:'POST',headers:{apikey:config.AUTH_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:credentials.email,password:credentials.password})});
 if(!response.ok)fail('AUTH_REQUIRED',401);const auth=z.object({user:z.object({id:uuid})}).parse(await response.json());
 const memberships=(await pool.query('SELECT merchant_id,role FROM members WHERE user_id=$1 ORDER BY merchant_id',[auth.user.id])).rows;
 const membership=credentials.merchantId?memberships.find(m=>m.merchant_id===credentials.merchantId):memberships.length===1?memberships[0]:null;
 if(!membership||demoRole&&membership.role!==demoRole)fail('ROLE_REQUIRED',403);
 const token=randomBytes(32).toString('base64url');
 await tenant(membership.merchant_id,async db=>{await db.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')",[hash(token),auth.user.id,membership.merchant_id,membership.role]);await audit(db,membership.merchant_id,auth.user.id,demoRole?'session.demo_login':'session.login',auth.user.id);});
 return {token,userId:auth.user.id,merchantId:membership.merchant_id,role:membership.role};
}
export async function handle(req:http.IncomingMessage){
 const url=new URL(req.url??'/',config.PUBLIC_URL),path=url.pathname,method=req.method;let input:unknown;if(['POST','PUT','PATCH'].includes(method??''))input=await body(req);
 if(path==='/api/session'&&method==='POST')return login(credentialsSchema.parse(input));
 if(path==='/api/demo-session'){
  if(method==='GET')return {enabled:demoAccessEnabled(),roles:demoAccessEnabled()?demoRoles:[]};
  if(method==='POST'){const selected=await demoCredentials(req,input);return login(selected.credentials,selected.role);}
  fail('RESOURCE_NOT_FOUND',404);
 }
 if(path.startsWith('/api/table/'))return tableRequest(path,method??'GET',input);
 const pay=path.match(/^\/api\/pay\/([^/]+)(?:\/(challenge|bind|attempt|submit|dismiss))?$/);
 if(pay){const merchant=(await pool.query('SELECT bitpos.resolve_access($1) AS merchant',[pay[1]])).rows[0]?.merchant;if(!merchant)fail('RESOURCE_NOT_FOUND',404)
 if(method==='POST'&&pay[2]==='attempt')return paymentAttempt(merchant,pay[1],input);
 return tenant(merchant,async db=>{
 const o=(await db.query('SELECT * FROM orders WHERE access_token=$1 FOR UPDATE',[pay[1]])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404)
 if(method==='GET'&&!pay[2]){const view=await orderView(db,o,true);const payment=(await db.query("SELECT signature FROM payments WHERE merchant_id=$1 AND order_id=$2 AND state='SETTLED' ORDER BY created_at DESC LIMIT 1",[merchant,o.id])).rows[0];return {...view,...(payment?{paymentSignature:payment.signature}:{})};}
 if(method!=='POST')fail('RESOURCE_NOT_FOUND',404);if(!['submit','dismiss'].includes(pay[2]!))liveOrder(o);
 if(pay[2]==='dismiss'){
 z.object({}).strict().parse(input);if(o.status!=='PAID')fail('ORDER_NOT_RELEASABLE',409);
 const view=await orderView(db,o,true);if(view.authority.kind!=='versioned')fail('ORDER_NOT_RELEASABLE',409);
 const id=view.authority.target.deviceId;const screen=(await db.query('SELECT * FROM device_screen_state WHERE device_id=$1',[id])).rows[0];
 if(screen?.kind==='order'&&screen.order_id===o.id)await dismissOrder(db,merchant,id,o.id,o.version,String(screen.screen_generation));
 else if(screen?.kind!=='idle')fail('ORDER_NOT_RELEASABLE',409);
 const entry=(await db.query('SELECT e.entry_token FROM table_entries e JOIN devices d ON d.merchant_id=e.merchant_id AND d.id=e.device_id AND d.table_id=e.table_id AND d.assignment_generation=e.assignment_generation AND d.auth_generation=e.auth_generation JOIN merchant_tables t ON t.merchant_id=e.merchant_id AND t.id=e.table_id WHERE e.merchant_id=$1 AND e.device_id=$2 AND d.revoked_at IS NULL AND t.retired_at IS NULL',[merchant,id])).rows[0];
 return {done:true,returnUrl:entry?'/table/'+entry.entry_token:null};
 }
 if(pay[2]==='challenge'){const {address:wallet}=z.object({address}).strict().parse(input);const expiresAt=new Date(Math.min(Date.now()+120000,new Date(o.quote_expires_at).getTime())).toISOString();const message=challengeMessage({nonce:randomBytes(32).toString('base64url'),address:wallet,orderId:o.id,merchantId:merchant,domain:new URL(config.PUBLIC_URL).host,expiresAt});const c=(await db.query('INSERT INTO challenges(merchant_id,order_id,address,message,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id',[merchant,o.id,wallet,message,expiresAt])).rows[0];return {id:c.id,message,expiresAt};}
 if(pay[2]==='bind'){
 const data=z.object({challengeId:uuid,signature:z.string().max(128)}).strict().parse(input);const c=(await db.query('SELECT * FROM challenges WHERE id=$1 AND order_id=$2 FOR UPDATE',[data.challengeId,o.id])).rows[0];
 if(!c||c.used_at||new Date(c.expires_at).getTime()<=Date.now())throw Error('Challenge expired or used');let signature:Uint8Array;try{signature=bs58.decode(data.signature);}catch{throw Error('Invalid wallet signature');}
 if(signature.length!==64||!nacl.sign.detached.verify(Buffer.from(c.message),signature,new PublicKey(c.address).toBytes()))throw Error('Invalid wallet signature');
 await associateProvenWallet(db,o,c.address);
 await db.query('UPDATE challenges SET used_at=now() WHERE id=$1',[c.id]);const updated=(await db.query("UPDATE orders SET payer=$2,status='AWAITING_PAYMENT',version=version+1 WHERE id=$1 RETURNING *",[o.id,c.address])).rows[0];await emitOrder(db,updated);return {payer:c.address,avatar:avatar(c.address)};
 }
 if(pay[2]==='submit'){
 const data=z.object({attemptId:uuid,base64:z.string().max(8192)}).strict().parse(input);const a=(await db.query('SELECT * FROM payment_attempts WHERE id=$1 AND order_id=$2 FOR UPDATE',[data.attemptId,o.id])).rows[0];if(!a||!a.transaction_base64)throw Error('Attempt not found');const signed=validateSigned(data.base64,a.transaction_base64,a.payer);if(a.signature&&a.signature!==signed.signature)throw Error('Attempt already submitted');
 if(!a.signature){liveOrder(o);if(a.status!=='READY')throw Error('Attempt is not ready');}
 if(!a.signature){await associateProvenWallet(db,o,a.payer);const updated=(await db.query("UPDATE orders SET payer=$2,status='AWAITING_PAYMENT',version=version+1 WHERE id=$1 RETURNING *",[o.id,a.payer])).rows[0];await emitOrder(db,updated);}
 await db.query("UPDATE payment_attempts SET signature=$2,signed_base64=$3,status=CASE WHEN signature IS NULL THEN 'SUBMITTING' ELSE status END,submitted_at=coalesce(submitted_at,now()) WHERE id=$1",[a.id,signed.signature,data.base64]);
 // Broadcast is worker-owned: this transaction must commit the signature first.
 return {signature:signed.signature,status:o.status};
 }
 fail('RESOURCE_NOT_FOUND',404)
 });}
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token)fail('AUTH_REQUIRED',401);
 const session=(await pool.query('SELECT s.*,m.role AS current_role FROM sessions s JOIN members m ON m.user_id=s.user_id AND m.merchant_id=s.merchant_id WHERE token_hash=$1 AND expires_at>now()',[hash(token)])).rows[0];if(!session)fail('AUTH_REQUIRED',401);const merchant=session.merchant_id;
 return tenant(merchant,async db=>{
 if(path==='/api/session'){if(method==='DELETE'){await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(token)]);await audit(db,merchant,session.user_id,'session.logout',session.user_id);return {ok:true};}if(method==='GET')return {userId:session.user_id,merchantId:merchant,role:session.current_role};}
 if(path==='/api/menu'&&method==='GET')return effectiveMenu(db,merchant);
 const registered=await registry(db,merchant,session.user_id,session.current_role,path,method??'',input);if(registered!==undefined)return registered;
 if(path==='/api/settings/pricing'){if(method==='GET')return pricingView(db,merchant);if(method==='PUT')return publishPrices(db,merchant,session.user_id,session.current_role,input);}
 const registerOrder=path.match(/^\/api\/registers\/([^/]+)\/(quotes|orders|submissions)(?:\/([^/]+)(?:\/(dismiss))?)?$/);
 if(registerOrder){const id=uuid.parse(registerOrder[1]);const action=registerOrder[2];
 if(action==='submissions'&&method==='GET'&&registerOrder[3]){if(!(await db.query('SELECT id FROM registers WHERE id=$1',[id])).rowCount)fail('RESOURCE_NOT_FOUND',404);const o=await submission(db,merchant,'register',id,decodeURIComponent(registerOrder[3]));return {order:o?await orderView(db,o):null};}
 if(action==='orders'&&registerOrder[4]==='dismiss'&&method==='POST'){const d=z.object({orderVersion:z.number().int().positive(),screenGeneration:positive}).strict().parse(input);const a=(await db.query('SELECT * FROM order_authority WHERE source_kind=\'register\' AND source_register_id=$1 AND order_id=$2',[id,uuid.parse(registerOrder[3])])).rows[0];if(!a)fail('RESOURCE_NOT_FOUND',404);await dismissOrder(db,merchant,a.target_device_id,a.order_id,d.orderVersion,d.screenGeneration);await audit(db,merchant,session.user_id,'order.dismiss',a.order_id);return {ok:true};}
 if(method==='POST'&&!registerOrder[3]){const draft=z.object({items:cart.refine(items=>items.length>0),customerId:uuid.optional(),serving}).strict();if(action==='quotes')return counterQuote(db,merchant,id,draft.parse(input));if(action==='orders'){const d=draft.extend({quoteId:uuid,priceVersion:uuid,idempotencyKey:z.string().min(1).max(128)}).strict().parse(input);const result=await createRoutedOrder(db,merchant,'register',id,d);if(!result.replayed)await audit(db,merchant,session.user_id,'order.create',result.order.id);return {...result.order,replayed:result.replayed};}}
 fail('RESOURCE_NOT_FOUND',404);}
 const cancel=path.match(/^\/api\/orders\/([^/]+)\/cancel$/);
 if(cancel&&method==='POST'){const d=z.object({deviceId:uuid,orderVersion:z.number().int().positive(),screenGeneration:positive}).strict().parse(input);await cancelUnpaidOrder(db,merchant,d.deviceId,uuid.parse(cancel[1]),d.orderVersion,d.screenGeneration,session.user_id);const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,cancel[1]])).rows[0];return {order:await orderView(db,o),screen:await currentScreen(db,merchant,d.deviceId)};}
 const recovery=path.match(/^\/api\/orders\/([^/]+)\/recovery$/);
 if(recovery&&method==='POST'){requireRole(session.current_role);z.object({resolution:z.literal('acknowledged')}).strict().parse(input);const o=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[uuid.parse(recovery[1])])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);if(o.status!=='RECOVERY')fail('RECOVERY_REQUIRED');if((await db.query("SELECT 1 FROM payment_attempts WHERE order_id=$1 AND status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')",[o.id])).rowCount)fail('PAYMENT_PENDING');await db.query('UPDATE orders SET recovery_resolved_at=coalesce(recovery_resolved_at,clock_timestamp()) WHERE id=$1',[o.id]);await audit(db,merchant,session.user_id,'order.recovery.acknowledged',o.id);return {ok:true};}
 const offer=path.match(/^\/api\/products\/([^/]+)\/offer$/);
 if(offer)return productOffer(db,merchant,session.user_id,session.current_role,offer[1],method??'',input,url.searchParams.get('priceVersion')??undefined);
 if(path==='/api/settings'){if(method==='GET')return (await db.query('SELECT treasury FROM merchants WHERE id=$1',[merchant])).rows[0];if(method==='PUT'){requireRole(session.current_role,true);const {treasury}=z.object({treasury:address}).strict().parse(input);if(!PublicKey.isOnCurve(new PublicKey(treasury).toBytes()))throw new RequestError(422,'INVALID_TREASURY','Treasury must be a wallet');await routingLock(db,merchant);await db.query('UPDATE merchants SET treasury=$2,version=version+1 WHERE id=$1',[merchant,treasury]);await audit(db,merchant,session.user_id,'treasury.update',merchant);return {treasury};}}
 const customer=path.match(/^\/api\/customers(?:\/([^/]+)(?:\/(history))?)?$/);
 if(customer){if(customer[1])uuid.parse(customer[1]);if(customer[2]&&method==='GET'){if(!(await db.query('SELECT id FROM customers WHERE id=$1',[customer[1]])).rowCount)fail('RESOURCE_NOT_FOUND',404);const rows=(await db.query('SELECT * FROM orders WHERE customer_id=$1 ORDER BY created_at DESC',[customer[1]])).rows;return {orders:await orderViews(db,rows)};}
 if(method==='POST'||method==='PATCH'){const p=profile.parse(input);let row;if(method==='POST')row=(await db.query('INSERT INTO customers(merchant_id,name,phone,email,notes) VALUES($1,$2,$3,$4,$5) RETURNING *',[merchant,p.name??'',p.phone??'',p.email??'',p.notes??''])).rows[0];else {if(!customer[1])fail('INVALID_REQUEST',422);row=(await db.query('UPDATE customers SET name=coalesce($2,name),phone=coalesce($3,phone),email=coalesce($4,email),notes=coalesce($5,notes) WHERE id=$1 RETURNING *',[customer[1],p.name,p.phone,p.email,p.notes])).rows[0];}if(!row)fail('RESOURCE_NOT_FOUND',404);await audit(db,merchant,session.user_id,'customer.edit',row.id);const wallets=(await db.query('SELECT address FROM customer_wallets WHERE customer_id=$1',[row.id])).rows;return {...row,wallets:wallets.map(w=>({...w,avatar:avatar(w.address)}))};}
 if(method==='GET'&&!customer[1]){const rows=(await db.query('SELECT id,name,phone,email,notes FROM customers ORDER BY created_at DESC')).rows;return {customers:await Promise.all(rows.map(async c=>({...c,wallets:(await db.query('SELECT address FROM customer_wallets WHERE customer_id=$1',[c.id])).rows.map(w=>({...w,avatar:avatar(w.address)}))})))};}}
 if(path==='/api/orders'&&method==='GET'){const rows=(await db.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200')).rows;return {orders:await orderViews(db,rows)};}
 const order=path.match(/^\/api\/orders\/([^/]+)$/);if(order&&method==='GET'){const o=(await db.query('SELECT * FROM orders WHERE id=$1',[uuid.parse(order[1])])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);return orderView(db,o);}
 fail('RESOURCE_NOT_FOUND',404);
 });
}
export const server=http.createServer(async(req,res)=>{try{const stream=(req.url??'').match(/^\/api\/pay\/([A-Za-z0-9_-]+)\/events$/);if(req.method==='GET'&&stream){await paymentStream(req,res,stream[1]);return;}const result=await handle(req);const created=req.method==='POST'&&/^\/api\/registers\/[^/]+\/orders$/.test(new URL(req.url??'/',config.PUBLIC_URL).pathname)&&!('replayed' in result&&result.replayed);res.writeHead(created?201:200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));}catch(error){const e=errorView(error);res.writeHead(e.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.view}));}});
attachDevices(server);if(process.argv[1]?.endsWith('/api/src/index.ts'))server.listen(3001,process.env.BITPOS_BIND_HOST==='127.0.0.1'?'127.0.0.1':'0.0.0.0');
