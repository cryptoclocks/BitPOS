import test from 'node:test';
import assert from 'node:assert/strict';
import {DriverSettlementSession,type PendingDriverSettlement} from '../apps/web/src/lib/driver-settlement-session';
import {PlatformError} from '../apps/web/src/lib/platform-session';

// Synthetic boundary fixtures only. These tests replace fetch; they never call a provider.
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const at='2026-10-19T00:00:00Z';
const asset={assetId:'usdg-devnet',symbol:'USDG',displayLabel:'USDG devnet fixture',cluster:'devnet',genesisHash:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',mint:'1'.repeat(32),tokenProgram:'2'.repeat(32),decimals:6,instructionPolicy:'spl_checked',issuerTestAsset:true};
const earning={currency:'USD',decimals:2,amountMinor:'125'},payout={currency:'USDG',decimals:6,amountMinor:'1250000'};
const eligibility:PendingDriverSettlement={kind:'ELIGIBILITY',merchantId:id(3),accrualId:id(4),command:{idempotencyKey:id(5),expectedVersion:'7',decision:'RELEASE',reason:'Fixture delivery eligibility'}};
const prepare:PendingDriverSettlement={kind:'PREPARE',command:{idempotencyKey:id(6),expectedVersion:'0',merchantId:id(3),driverId:id(7),beneficiaryId:id(8),beneficiaryVersion:'2',sourceIds:[id(4),id(9)],sourceVersions:['7','11']}};
const eligibilityReceipt={kind:'ELIGIBILITY_DECIDED',accrualId:id(4),decisionId:id(10),state:'AVAILABLE',version:'8',availableAt:at,fundsTransferred:false};
const draftReceipt={kind:'BATCH_DRAFT',batchId:id(11),state:'DRAFT',version:'1',beneficiaryId:id(8),beneficiaryVersion:'2',sourceIds:[id(4),id(9)],sourceVersions:['7','11'],money:earning,payoutMoney:payout,asset,outwardReady:false,fundsTransferred:false};
const reservedReceipt={kind:'BATCH_RESERVED',batchId:id(11),state:'RESERVED',version:'2',money:earning,payoutMoney:payout,asset,reserveTransactionId:id(12),outwardReady:false,fundsTransferred:false};
const reserve:PendingDriverSettlement={kind:'BATCH',merchantId:id(3),batchId:id(11),command:{kind:'APPROVE_RESERVE',idempotencyKey:id(13),expectedVersion:'1',beneficiaryId:id(8),beneficiaryVersion:'2',sourceIds:[id(4),id(9)],sourceVersions:['7','11'],reason:'Fixture accounting reserve only'}};

async function fixture(action:(f:{api:DriverSettlementSession;calls:{path:string;body:string}[];values:Map<string,string>;reply:(handler:(path:string,body:string)=>Promise<Response>)=>void;account:(value:string)=>void;expires:(value:string)=>void;refresh:(handler:()=>Promise<Response>)=>void;storageFailure:(value:'before'|'settle'|null)=>void})=>Promise<void>){
 const oldFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const values=new Map<string,string>(),calls:{path:string;body:string}[]=[],locks=new Map<string,Promise<unknown>>();
 let account=id(1),expires='2099-01-01T00:00:00Z',failure:'before'|'settle'|null=null;
 let reply:(path:string,body:string)=>Promise<Response>=async()=>Response.json(eligibilityReceipt);
 let refresh:()=>Promise<Response>=async()=>{throw new Error('Synthetic refresh response lost');};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{if(failure==='before'||failure==='settle'&&JSON.parse(value).pending===null)throw new Error('Synthetic storage failure');values.set(key,value);}}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(name:string,action:()=>unknown)=>{const next=(locks.get(name)??Promise.resolve()).then(action);locks.set(name,next.catch(()=>{}));return next;}}}});
 globalThis.fetch=async(input,init)=>{
  const path=String(input);
  if(path.endsWith('/auth/verify'))return Response.json({accountId:account,sessionId:id(2),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:expires,refreshExpiresAt:'2099-02-01T00:00:00Z'});
  if(path.endsWith('/auth/logout'))return Response.json({revoked:true});
  if(path.endsWith('/auth/refresh'))return refresh();
  const body=String(init?.body??'');calls.push({path,body});return reply(path,body);
 };
 try{
  const api=new DriverSettlementSession();await api.verify('+66900000001','123456');
  await action({api,calls,values,reply:handler=>{reply=handler;},account:value=>{account=value;},expires:value=>{expires=value;},refresh:handler=>{refresh=handler;},storageFailure:value=>{failure=value;}});
 }finally{
  globalThis.fetch=oldFetch;
  if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');
  if(nav)Object.defineProperty(globalThis,'navigator',nav);else Reflect.deleteProperty(globalThis,'navigator');
 }
}

test('lost commit persists before request, rejects replacement, and replays exact body after page restart',async()=>fixture(async f=>{
 f.reply(async()=>{assert.deepEqual(f.api.journal().pending,eligibility);throw Error('Synthetic response lost after commit');});
 await assert.rejects(f.api.submitSettlement(eligibility));
 await assert.rejects(f.api.submitSettlement({...eligibility,command:{...eligibility.command,idempotencyKey:id(99)}}),e=>e instanceof PlatformError&&e.code==='PENDING_COMMAND');
 assert.equal(f.calls.length,1);
 const restarted=new DriverSettlementSession();await restarted.verify('+66900000001','123456');assert.deepEqual(restarted.journal().pending,eligibility);
 f.reply(async()=>Response.json(eligibilityReceipt));const result=await restarted.submitSettlement(eligibility);
 assert.equal(result.kind,'ELIGIBILITY');assert.equal(result.receipt.fundsTransferred,false);assert.equal(restarted.journal().pending,null);
 assert.equal(f.calls[0].path,'/api/mobile/v1/platform/earnings/'+id(4)+'/eligibility');assert.equal(f.calls[0].body,f.calls[1].body);
 for(const raw of f.values.values()){assert.ok(!raw.includes('a'.repeat(43)));assert.ok(!raw.includes('b'.repeat(43)));}
}));

test('two simultaneous taps and another tab cannot replace an unresolved command',async()=>fixture(async f=>{
 const sibling=new DriverSettlementSession();await sibling.verify('+66900000001','123456');
 f.reply(async()=>{throw Error('Synthetic unknown outcome');});
 const results=await Promise.allSettled([f.api.submitSettlement(eligibility),sibling.submitSettlement({...eligibility,command:{...eligibility.command,idempotencyKey:id(90)}})]);
 assert.equal(results.filter(result=>result.status==='rejected').length,2);assert.equal(f.calls.length,1);assert.deepEqual(sibling.journal().pending,eligibility);
}));

for(const [status,code] of [[401,'AUTH_REQUIRED'],[403,'ROLE_REQUIRED'],[404,'RESOURCE_NOT_FOUND'],[409,'SETTLEMENT_AUTH_RETRY'],[409,'UNRECOGNIZED_ERROR'],[503,'CONFIGURATION_REQUIRED'],[502,'SERVICE_UNAVAILABLE']] as const){
 test(`${status} ${code} does not erase an ambiguous original command`,async()=>fixture(async f=>{
  f.reply(async()=>{throw Error('Synthetic lost commit');});await assert.rejects(f.api.submitSettlement(eligibility));
  f.reply(async()=>Response.json({error:{code}},{status}));await assert.rejects(f.api.submitSettlement(eligibility));
  if(!f.api.accountId)await f.api.verify('+66900000001','123456');
  assert.deepEqual(f.api.journal().pending,eligibility);assert.equal(f.calls[0].body,f.calls[1].body);
 }));
}
for(const [status,code] of [[422,'INVALID_REQUEST'],[409,'VERSION_CONFLICT'],[409,'IDEMPOTENCY_CONFLICT'],[409,'SETUP_REQUIRED'],[409,'SETTLEMENT_NOT_READY']] as const){
 test(`${status} ${code} conclusively rejects and retires only the exact original`,async()=>fixture(async f=>{
  f.reply(async()=>Response.json({error:{code}},{status}));await assert.rejects(f.api.submitSettlement(eligibility));assert.equal(f.api.journal().pending,null);
 }));
}
for(const patch of [{accrualId:id(99)},{version:'9'},{state:'HELD'},{fundsTransferred:true},{callbackProof:'not authority'}]){
 test('mismatched or permissive financial receipt cannot retire pending: '+JSON.stringify(patch),async()=>fixture(async f=>{
  f.reply(async()=>Response.json({...eligibilityReceipt,...patch}));await assert.rejects(f.api.submitSettlement(eligibility));assert.deepEqual(f.api.journal().pending,eligibility);
 }));
}

test('prepare sorts neither IDs nor versions silently; malformed aligned sources never send',async()=>fixture(async f=>{
 assert.equal(prepare.kind,'PREPARE');if(prepare.kind!=='PREPARE')throw Error('Fixture kind');
 for(const command of [{...prepare.command,sourceIds:[id(9),id(4)]},{...prepare.command,sourceVersions:['7']},{...prepare.command,sourceIds:[id(4),id(4)]}])await assert.rejects(f.api.submitSettlement({kind:'PREPARE',command}));
 assert.equal(f.calls.length,0);assert.equal(f.api.journal().pending,null);
}));

test('draft source receipt is durable before retiring pending; reserve preserves its exact source/version pairs',async()=>fixture(async f=>{
 f.reply(async()=>Response.json({...draftReceipt,sourceVersions:['11','7']}));await assert.rejects(f.api.submitSettlement(prepare));assert.deepEqual(f.api.journal().pending,prepare);
 f.reply(async()=>Response.json(draftReceipt));const draft=await f.api.submitSettlement(prepare);assert.equal(draft.kind,'PREPARE');assert.equal(draft.receipt.fundsTransferred,false);
 const restarted=new DriverSettlementSession();await restarted.verify('+66900000001','123456');
 assert.deepEqual(restarted.journal().drafts,[{merchantId:id(3),driverId:id(7),receipt:draftReceipt}]);assert.equal(restarted.journal().pending,null);
 f.reply(async()=>Response.json(reservedReceipt));const result=await restarted.submitSettlement(reserve);
 assert.equal(result.receipt.fundsTransferred,false);assert.equal(result.kind,'BATCH');assert.equal(restarted.journal().drafts.length,0);
 assert.equal(f.calls[0].path,'/api/mobile/v1/platform/settlement-batches');assert.equal(f.calls.at(-1)?.path,'/api/mobile/v1/platform/settlement-batches/'+id(11)+'/commands');
 assert.deepEqual(JSON.parse(f.calls.at(-1)!.body),reserve.command);
}));

test('storage failure before request sends nothing; failure after draft commit retains recoverable pending',async()=>fixture(async f=>{
 f.storageFailure('before');await assert.rejects(f.api.submitSettlement(prepare));assert.equal(f.calls.length,0);
 f.storageFailure('settle');f.reply(async()=>Response.json(draftReceipt));await assert.rejects(f.api.submitSettlement(prepare));assert.deepEqual(f.api.journal().pending,prepare);assert.equal(f.calls.length,1);
 f.storageFailure(null);await f.api.submitSettlement(prepare);assert.equal(f.api.journal().pending,null);assert.deepEqual(f.api.journal().drafts[0].receipt,draftReceipt);assert.equal(f.calls[0].body,f.calls[1].body);
}));

test('account replacement fences delayed receipts and never retires the former account journal',async()=>fixture(async f=>{
 let release!:(value:Response)=>void,started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});
 f.reply(async()=>{started();return new Promise<Response>(resolve=>{release=resolve;});});
 const request=f.api.submitSettlement(eligibility);await waiting;await f.api.logout();f.account(id(50));await f.api.verify('+66900000002','123456');
 release(Response.json(eligibilityReceipt));await assert.rejects(request,e=>e instanceof PlatformError&&e.code==='SESSION_CHANGED');assert.equal(f.api.journal().pending,null);assert.equal(f.api.journal().drafts.length,0);
 f.account(id(1));await f.api.verify('+66900000001','123456');assert.deepEqual(f.api.journal().pending,eligibility);
}));

test('ambiguous mobile refresh preserves pending without sending financial request',async()=>fixture(async f=>{
 f.expires('2000-01-01T00:00:00Z');await f.api.verify('+66900000001','123456');await assert.rejects(f.api.submitSettlement(eligibility));assert.equal(f.api.accountId,null);assert.equal(f.calls.length,0);
 f.expires('2099-01-01T00:00:00Z');await f.api.verify('+66900000001','123456');assert.deepEqual(f.api.journal().pending,eligibility);
 f.reply(async()=>Response.json(eligibilityReceipt));await f.api.submitSettlement(eligibility);assert.equal(f.api.journal().pending,null);
}));

test('cancel uses only the exact draft schema and never represents funds transferred',async()=>fixture(async f=>{
 f.reply(async()=>Response.json(draftReceipt));await f.api.submitSettlement(prepare);
 const cancel:PendingDriverSettlement={kind:'BATCH',merchantId:id(3),batchId:id(11),command:{kind:'CANCEL_DRAFT',idempotencyKey:id(14),expectedVersion:'1',reason:'Cancel fixture draft, not a refund'}};
 f.reply(async()=>Response.json({...reservedReceipt,kind:'BATCH_CANCELLED',state:'CANCELLED',reserveTransactionId:null}));const receipt=await f.api.submitSettlement(cancel);
 assert.equal(receipt.receipt.fundsTransferred,false);assert.equal(f.api.journal().drafts.length,0);assert.deepEqual(JSON.parse(f.calls.at(-1)!.body),cancel.command);
}));

test('merchant pages use only the exact afterId route, reject wrong tenant and strict extra fields',async()=>fixture(async f=>{
 const page={kind:'FINANCE_EARNINGS',merchantId:id(3),items:[],nextAfterId:null,snapshotAt:at,availabilityIsLiquidity:false};
 f.reply(async()=>Response.json(page));assert.deepEqual(await f.api.financePage(id(3),id(4)),page);
 assert.equal(f.calls[0].path,'/api/mobile/v1/platform/merchants/'+id(3)+'/earnings?afterId='+id(4));
 f.reply(async()=>Response.json({...page,merchantId:id(99)}));await assert.rejects(f.api.financePage(id(3),null));
 f.reply(async()=>Response.json({...page,dailyTotal:earning}));await assert.rejects(f.api.financePage(id(3),null));
}));
