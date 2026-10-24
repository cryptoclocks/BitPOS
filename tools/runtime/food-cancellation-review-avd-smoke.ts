import assert from 'node:assert/strict';import {spawn,type ChildProcess} from 'node:child_process';import {once} from 'node:events';import {randomUUID} from 'node:crypto';import {writeFile} from 'node:fs/promises';import type pg from 'pg';
import {snapshotFoodCancellationEffects} from './food-cancellation-review-sql-smoke';
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number,signal?:AbortSignal)=>Promise<any>;
/** One cancellation owner covers Flutter, coordinator response bodies and adb. */
export class ReviewAvdScope{
 readonly controller=new AbortController();readonly signal=this.controller.signal;private timer:ReturnType<typeof setTimeout>;
 constructor(milliseconds=300000){this.timer=setTimeout(()=>this.abort(new Error('REVIEW_AVD_DEADLINE')),milliseconds);}
 abort(reason:unknown){if(this.signal.aborted)return;clearTimeout(this.timer);this.controller.abort(reason);}
 wait<T>(operation:Promise<T>):Promise<T>{return new Promise((resolve,reject)=>{
  const abort=()=>reject(this.signal.reason);
  if(this.signal.aborted){void operation.catch(()=>{});reject(this.signal.reason);return;}
  this.signal.addEventListener('abort',abort,{once:true});
  operation.then(value=>{this.signal.removeEventListener('abort',abort);resolve(value);},error=>{this.signal.removeEventListener('abort',abort);reject(error);});
 });}
 track<T extends ChildProcess>(child:T):T{
  let escalation:ReturnType<typeof setTimeout>|undefined;
  const abort=()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');escalation=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},250);escalation.unref();}};
  child.once('error',error=>this.abort(error));
  child.once('exit',(code,signal)=>{this.signal.removeEventListener('abort',abort);clearTimeout(escalation);if(code!==0)this.abort(new Error('REVIEW_AVD_CHILD_EXIT_'+(code??signal)));});
  if(this.signal.aborted)abort();else this.signal.addEventListener('abort',abort,{once:true});return child;
 }
 close(){clearTimeout(this.timer);this.abort(new Error('REVIEW_AVD_SCOPE_CLOSED'));}
}
export async function runFoodCancellationReviewAvd(c:{db:pg.Client;base:string;shipment:string;orderId:string;product:string;assignment:any;customer:{account:string;session:string;access:string};driverActor:{access:string};dispatcher:{access:string};merchantToken:string;call:Call}){
 const {db,shipment,orderId,product,assignment,customer,driverActor,dispatcher,merchantToken,call:rawCall}=c,base=new URL(c.base),root='/api/mobile/v1',fence={generation:assignment.generation,leaseGeneration:assignment.leaseGeneration};assert.equal(base.hostname,'127.0.0.1');assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const responseLoss=process.argv.includes('--cancellation-review-response-loss'),suffix=responseLoss?'response-loss-20261021':'native-route-20261021';
 const scope=new ReviewAvdScope(),call:Call=(path,method,body,token,status)=>scope.wait(rawCall(path,method,body,token,status,scope.signal));
 try{
 await call(root+'/driver/food/assignments/'+assignment.assignmentId+'/arrive','POST',{...fence,stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access);
 const proof=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',{assignmentId:assignment.assignmentId,...fence,idempotencyKey:randomUUID(),rotate:false},merchantToken),before=await snapshotFoodCancellationEffects(db,{orderId,product,shipment,assignmentId:assignment.assignmentId,proofId:proof.proofId});
 const session={accountId:customer.account,sessionId:customer.session,accessToken:customer.access,refreshToken:'r'.repeat(43),accessExpiresAt:new Date(Date.now()+1800000).toISOString(),refreshExpiresAt:new Date(Date.now()+3600000).toISOString()},evidence='.omp/work/flutter-delivery-20261016/evidence',screenshots:string[]=[];
 async function capture(stage:string){scope.signal.throwIfAborted();const name='dispatch083-cancellation-review-'+stage+'-avd-'+suffix+'.png',adb=scope.track(spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554','exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']})),chunks:Buffer[]=[];adb.stdout.on('data',value=>chunks.push(value));assert.equal((await scope.wait(once(adb,'exit')))[0],0);scope.signal.throwIfAborted();await writeFile(evidence+'/'+name,Buffer.concat(chunks));screenshots.push(name);}
 const child=spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/food_cancellation_review_test.dart','-d','emulator-5554','--dart-define=BITPOS_FIXTURE=true','--dart-define=BITPOS_TEST_LOSE_CANCELLATION_RESPONSE='+responseLoss,'--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:'+base.port+'/api/mobile/v1/','--dart-define=BITPOS_TEST_ORDER_ID='+orderId,'--dart-define=BITPOS_TEST_SESSION_BASE64='+Buffer.from(JSON.stringify(session)).toString('base64'),'--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-customer',stdio:['ignore','pipe','pipe']});
 scope.track(child);
 let text='',formReady=false,requested=false,visible=false,dropped=false,restored=false,reviewId='',disposition:any;let pending=Promise.resolve();
 function observe(bytes:Buffer){process.stdout.write(bytes);text=(text+bytes.toString()).slice(-16000);
  if(text.includes('BITPOS_CANCELLATION083_COMMITTED_RESPONSE_DROPPED'))dropped=true;
  if(text.includes('BITPOS_CANCELLATION083_RESTORED_EXACT_RETRY'))restored=true;
  if(!formReady&&text.includes('BITPOS_CANCELLATION083_FORM_READY')){formReady=true;pending=pending.then(()=>capture('form-ready'));void pending.catch(error=>scope.abort(error));}
  if(!requested&&text.includes('BITPOS_CANCELLATION083_REQUESTED')){requested=true;pending=pending.then(async()=>{
   await capture('requested');const history=await call(root+'/orders/'+orderId+'/cancellation-reviews','GET',undefined,customer.access);assert.equal(history.items.length,1);reviewId=history.items[0].reviewId;
   const path=root+'/platform/food/cancellation-reviews/'+reviewId,inspected=await call(path+'/inspect','POST',{purpose:'Synthetic native review coordinator private triage'},dispatcher.access);assert.ok(inspected.inspectionId);
   const current=await call(path+'/review','GET',undefined,dispatcher.access);disposition=await call(path+'/disposition','POST',{idempotencyKey:randomUUID(),expectedReviewVersion:current.review.reviewVersion,expectedShipmentVersion:current.shipmentVersion,decision:'COMPENSATION_REVIEW_REQUIRED',customerExplanation:'AVD synthetic review recorded. Further compensation investigation is required; order remains active and no refund has been sent.'},dispatcher.access);
  });void pending.catch(error=>scope.abort(error));}
  if(!visible&&text.includes('BITPOS_CANCELLATION083_REVIEW_VISIBLE')){visible=true;pending=pending.then(()=>capture('reviewed'));void pending.catch(error=>scope.abort(error));}
 }
 child.stdout.on('data',observe);child.stderr.on('data',observe);
  assert.equal((await scope.wait(once(child,'exit')))[0],0);await scope.wait(pending);assert.ok(requested&&visible);assert.equal(disposition.refundExecuted,false);assert.equal(disposition.orderCancelled,false);
  const after=await snapshotFoodCancellationEffects(db,{orderId,product,shipment,assignmentId:assignment.assignmentId,proofId:proof.proofId});assert.deepEqual(after,before);
  const persisted=(await db.query("SELECT r.version::text version,r.decision,(SELECT count(*)::int FROM bitpos.food_cancellation_review_access_audit a WHERE a.review_id=r.id) inspections FROM bitpos.food_cancellation_reviews r WHERE r.id=$1",[reviewId])).rows[0];assert.deepEqual(persisted,{version:'2',decision:'COMPENSATION_REVIEW_REQUIRED',inspections:1});
  const commandCount=(await db.query("SELECT count(*)::int n FROM bitpos.food_dispatch_commands WHERE actor_account_id=$1 AND operation='cancellation-review-request'",[customer.account])).rows[0].n;
  assert.equal(commandCount,1);if(responseLoss){assert.ok(dropped&&restored,'Actual committed-response loss and restored exact retry must both execute');}
  const receipt={status:'PASS_JOINED_NATIVE_CUSTOMER_CANCELLATION_REVIEW_HTTP_PERSISTED_NO_EFFECT',assignmentId:assignment.assignmentId,orderId,reviewId,persisted,commandCount,responseLoss:{enabled:responseLoss,committedResponseDropped:dropped,apiObjectClosedAndRestored:restored,osProcessRestart:false,secureStorageBackend:'fixture'},custody:{assignment:after.assignment.state,lease:after.lease.state,kitchen:after.kitchen.status,proofConsumed:after.proof.consumed_at!==null,proofRevoked:after.proof.revoked_at!==null},screenshots,fixture:'Actual native customer delivery route and request/history UI; synthetic secure-storage identity/payment. Scoped coordinator actual HTTP inspection/disposition; not operator browser. Optional committed-response drop is a transport fixture after genuine API200, not an explanation of historical intermittency. No OTP rate limit bypass or actual refund/cancellation.',limits:['Direct actual delivery route fixture, not app sign-in/history-navigation acceptance','No OS process kill, physical field test, money transfer or terminal custody execution'],physicalTesting:'deferred_by_user_2026-10-16'};
  scope.signal.throwIfAborted();
  await writeFile(evidence+'/dispatch083-cancellation-review-avd-'+suffix+'.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }finally{scope.close();}
}
