// Isolated execution of the actual native helper; never starts adb/Flutter or mutates a device.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url),sourcePath='tools/runtime/customer-surface-native-smoke.mjs';
const source=await readFile(sourcePath,'utf8');
const compiled=ts.transpileModule(source,{fileName:'probe.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const results=[];
for(const fault of ['new-anr','active-anr','historical-closed','capture-rejection','capture-collision','cleanup-size','cleanup-density','cleanup-readback','cleanup-output','cleanup-scratch','SIGINT-after-size','SIGTERM-running','SIGINT-during-cleanup']){
 let receipt,historyReads=0,sizeReads=0,child,childStopped=false,copyExclusive=false,outputPersisted=false;
 const actions=[],existing=Buffer.from('existing retained PNG'),before=Buffer.from(existing);
 const processFixture=new EventEmitter();processFixture.stdout={write(){}};
 const failure=message=>Object.assign(new Error(message),{code:'INJECTED'});
 const childStop=()=>{if(childStopped)return;childStopped=true;child.exitCode=143;child.emit('exit',143);};
 const fakeSpawn=()=>{
  child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;
  child.kill=signal=>{actions.push(signal);childStop();return true;};
  setTimeout(()=>{
   if(fault==='SIGTERM-running'){processFixture.emit('SIGTERM');return;}
   child.stdout.write('BITPOS_CUSTOMER_SURFACE_CAPTURE U11-th BITPOS_CUSTOMER_SURFACE_CAPTURE U15-th All tests passed!');
   setTimeout(()=>{if(!childStopped){childStopped=true;child.exitCode=0;child.emit('exit',0);}},10);
  },0);
  return child;
 };
 const execFile=(bin,args,options,callback)=>{
  if(options.signal?.aborted)return callback(options.signal.reason);
  let stdout='';
  if(args.includes('lastanr'))stdout=++historyReads===1||fault!=='new-anr'?'ANR time: old\nReason: com.bitpos.bitpos_customer prior closed focus wait':'ANR time: new\nReason: com.bitpos.bitpos_customer focus wait';
  if(args.includes('windows'))stdout=fault==='active-anr'?'Window #0 Window{fixture Application Not Responding: com.bitpos.bitpos_customer}\n isOnScreen=true':'Window #0 Window{fixture com.bitpos.bitpos_customer}\n isOnScreen=true';
  if(args.includes('size')){
   if(args.includes('reset')){actions.push('size-reset');if(fault==='SIGINT-during-cleanup')processFixture.emit('SIGINT');if(fault==='cleanup-size')return callback(failure('size reset failed'));}
   else if(args.includes('1170x2532')){actions.push('size-mutation');if(fault==='SIGINT-after-size')processFixture.emit('SIGINT');}
   else {sizeReads++;if(fault==='cleanup-readback'&&sizeReads>1)return callback(failure('size readback failed'));}
   stdout='Physical size: 1080x2424\n';
  }
  if(args.includes('density')){if(args.includes('reset')){actions.push('density-reset');if(fault==='cleanup-density')return callback(failure('density reset failed'));}stdout='Physical density: 420\n';}
  if(args.includes('screencap')&&fault==='capture-rejection')return callback(failure('capture failed'));
  callback(null,{stdout:Buffer.from(stdout),stderr:Buffer.from('')});
 };
 const fakeFs={
  readFile:async()=>'{"holder":"Main"}',mkdtemp:async()=>'/owned-scratch',
  writeFile:async(path,bytes)=>{if(path.endsWith('.txt')){if(fault==='cleanup-output')throw failure('output persistence failed');outputPersisted=true;}if(path.endsWith('.json'))receipt=JSON.parse(bytes);},
  copyFile:async(from,to,flags)=>{copyExclusive=flags===require('node:fs').constants.COPYFILE_EXCL;if(fault==='capture-collision'){assert.ok(copyExclusive);throw Object.assign(new Error('retained file exists'),{code:'EEXIST'});}},
  readdir:async()=>{if(fault==='cleanup-scratch')throw failure('scratch enumeration failed');return [];},rm:async()=>{},rmdir:async()=>{},
 };
 const localRequire=name=>name==='node:child_process'?{execFile,spawn:fakeSpawn}:name==='node:util'?{promisify:fn=>(...args)=>new Promise((resolve,reject)=>fn(...args,(error,value)=>error?reject(error):resolve(value)))}:name==='node:fs/promises'?fakeFs:require(name);
 await vm.runInNewContext('(async()=>{'+compiled+'})()',{require:localRequire,exports:{},AbortController,Buffer,setTimeout,clearTimeout,process:processFixture,console:{log(){}}},{timeout:1000});
 const shouldPass=fault==='historical-closed';
 assert.equal(receipt.status,shouldPass?'PASS_CURRENT_ANDROID_CUSTOMER_SURFACE_FIXTURE':'FAIL',fault);
 assert.ok(actions.includes('size-reset')&&actions.includes('density-reset'),fault+' must attempt both restores');
 assert.equal(child===undefined||childStopped,true,fault+' leaves an owned child');
 assert.equal(processFixture.listenerCount('SIGINT')+processFixture.listenerCount('SIGTERM'),0);
 if(fault==='active-anr')assert.equal(receipt.activeAnrDialog,true);
 if(fault==='new-anr')assert.ok(receipt.nativeAnr);
 if(fault.startsWith('cleanup-'))assert.ok(receipt.cleanupErrors.length);
 if(fault.startsWith('SIG'))assert.ok(receipt.cancelled);
 if(fault==='capture-collision'){assert.ok(copyExclusive);assert.deepEqual(existing,before);assert.match(receipt.captureError,/retained file exists/);}
 results.push({fault,status:receipt.status,error:receipt.error??null,cleanupErrors:receipt.cleanupErrors,restoreAttempts:actions.filter(a=>a.endsWith('-reset')),cancelled:receipt.cancelled??null,receiptPersisted:true,ownedChildStopped:child===undefined||childStopped,outputPersisted});
}
const evidence='.omp/work/flutter-delivery-20261016/evidence/customer-surface-lifecycle-faults-'+new Date().toISOString().replaceAll(':','-')+'.json';
await writeFile(evidence,JSON.stringify({fixture:true,sourcePath,sourceSha256:createHash('sha256').update(source).digest('hex'),results,limits:['Actual helper executed with isolated process/fs/adb adapters; not actual Android faults or physical testing'],physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS',cases:results.length,evidence}));
