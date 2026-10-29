import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {ReviewAvdScope} from './food-cancellation-review-avd-smoke';
const checks:Record<string,unknown>[]=[];
const evidence='.omp/work/flutter-delivery-20261016/evidence/transport083-deadline-smoke-20261019.json';
const sleeper=()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
try{
 // Genuine local response headers arrive, but JSON body never completes. Abort
 // must stop that body read and the tracked Flutter stand-in, not merely race it.
 const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.write('{"never":');});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 const scope=new ReviewAvdScope(250),child=scope.track(sleeper()),exited=once(child,'exit',{signal:AbortSignal.timeout(2000)});let cleanup=false;
 try{
  const response=await fetch('http://127.0.0.1:'+address.port,{signal:scope.signal});
  const body=response.json();await assert.rejects(scope.wait(body),/REVIEW_AVD_DEADLINE/);
  await assert.rejects(Promise.race([body,new Promise((_,reject)=>{setTimeout(()=>reject(new Error('BODY_NOT_CANCELLED')),1000).unref();})]),/aborted|REVIEW_AVD_DEADLINE/i);
 }finally{scope.close();await exited;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));cleanup=true;}
 assert.equal(cleanup,true);assert.ok(child.signalCode==='SIGTERM'||child.signalCode==='SIGKILL');checks.push({case:'stalled_coordinator_response_body',boundedFailure:true,childTerminated:true,fixtureCleanupReached:cleanup});
 const captureScope=new ReviewAvdScope(100),native=captureScope.track(sleeper()),capture=captureScope.track(sleeper()),nativeExit=once(native,'exit',{signal:AbortSignal.timeout(2000)}),captureExit=once(capture,'exit',{signal:AbortSignal.timeout(2000)});let captureCleanup=false;
 try{await assert.rejects(captureScope.wait(captureExit),/REVIEW_AVD_DEADLINE/);}finally{captureScope.close();await Promise.all([nativeExit,captureExit]);captureCleanup=true;}
 assert.ok(native.signalCode&&capture.signalCode);checks.push({case:'stalled_capture_process',boundedFailure:true,nativeAndCaptureTerminated:true,fixtureCleanupReached:captureCleanup});
 const failureScope=new ReviewAvdScope(2000),failed=failureScope.track(spawn(process.execPath,['-e','process.exit(7)'],{stdio:'ignore'})),hanging=failureScope.track(sleeper()),hangingExit=once(hanging,'exit',{signal:AbortSignal.timeout(2000)});let failureCleanup=false;
 try{await assert.rejects(failureScope.wait(once(failed,'exit')),/REVIEW_AVD_CHILD_EXIT_7/);}finally{failureScope.close();await hangingExit;failureCleanup=true;}
 assert.equal((failureScope.signal.reason as Error).message,'REVIEW_AVD_CHILD_EXIT_7');checks.push({case:'primary_child_failure',originalErrorPreserved:true,otherChildTerminated:true,fixtureCleanupReached:failureCleanup});
 const receipt={status:'PASS_BOUNDED_FIXTURE_DEADLINE_HTTP_BODY_CAPTURE_CHILD_FAILURE_CLEANUP',checks,limits:['Local real HTTP streaming response and actual short-lived Node child processes, not an AVD rerun or Flutter process-tree proof','No application/DB/provider calls'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile(evidence,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await writeFile(evidence,JSON.stringify({status:'FAIL',checks,error:error instanceof Error?error.message:'Unknown error'},null,2)+'\n');throw error;}
