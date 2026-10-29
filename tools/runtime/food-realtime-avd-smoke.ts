import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const evidence=resolve(root,'.omp/work/flutter-delivery-20261016/evidence');
const adb='/Users/cryptoclock/Library/Android/sdk/platform-tools/adb';
const orderId=process.argv[2]??'18c92189-0750-45d9-9136-9ab005b2ca69';assert.match(orderId,/^[0-9a-f-]{36}$/);
const fixturePort='3006';
async function command(binary:string,args:string[]){const child=spawn(binary,args,{cwd:root,stdio:['ignore','pipe','pipe']});const chunks:Buffer[]=[];let error='';child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.on('data',chunk=>error+=String(chunk));const [code]=await once(child,'exit');assert.equal(code,0,error.slice(-1000));return Buffer.concat(chunks);}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
async function startApi(){
 const child=spawn(process.execPath,['--import','tsx','tools/runtime/delivery-fixture-server.ts','--api-only'],{cwd:root,env:{...process.env,BITPOS_FIXTURE_API_PORT:fixturePort},stdio:['ignore','pipe','pipe']});
 await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Owned fixture API startup deadline'));},15000);const data=(chunk:Buffer)=>{if(String(chunk).includes('FIXTURE API ready')){clearTimeout(timeout);resolve();}};child.stdout!.on('data',data);child.once('error',reject);child.once('exit',()=>{clearTimeout(timeout);reject(Error('Owned fixture API startup failed'));});});
 return child;
}
let api:ChildProcess|undefined,flutter:ChildProcess|undefined;
try{
 api=await startApi();
 flutter=spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/food_realtime_test.dart','-d','emulator-5554','--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:3006/api/mobile/v1/','--dart-define=BITPOS_FIXTURE=true',`--dart-define=BITPOS_TEST_ORDER_ID=${orderId}`,'--no-enable-impeller','--no-uninstall'],{cwd:resolve(root,'apps/mobile-customer'),stdio:['ignore','pipe','pipe']});
 let buffer='',stoppedForRestart=false,restarted=false,captured=false,action=Promise.resolve(),actionError:unknown;
 const enqueue=(job:()=>Promise<void>)=>{action=action.then(job).catch(error=>{actionError=error;flutter?.kill('SIGTERM');});};
 const observe=(chunk:Buffer)=>{
  const text=String(chunk);process.stdout.write(text);buffer=(buffer+text).slice(-8192);
  if(!stoppedForRestart&&buffer.includes('BITPOS_REALTIME_RESTART_READY')){stoppedForRestart=true;enqueue(async()=>{await stop(api!);api=undefined;});}
  if(!restarted&&buffer.includes('BITPOS_REALTIME_UI_CLEARED')){restarted=true;enqueue(async()=>{api=await startApi();});}
  if(!captured&&buffer.includes('BITPOS_REALTIME_RECOVERED')){captured=true;enqueue(async()=>{await writeFile(resolve(evidence,'realtime069-avd-recovered-r2-20261018.png'),await command(adb,['-s','emulator-5554','exec-out','screencap','-p']));});}
 };
 flutter.stdout!.on('data',observe);flutter.stderr!.on('data',observe);
 const deadline=setTimeout(()=>flutter?.kill('SIGTERM'),180000);
 const [code]=await once(flutter,'exit');clearTimeout(deadline);await action;
 if(actionError)throw actionError;assert.equal(code,0,'AVD realtime integration must pass');assert.ok(stoppedForRestart&&restarted&&captured,'Observed cleared UI, real restart and final capture required');
 const receipt=JSON.parse((await command(adb,['-s','emulator-5554','exec-out','run-as','com.bitpos.bitpos_customer','cat','code_cache/bitpos-realtime069.json'])).toString());
 assert.equal(receipt.status,'PASS_BOUNDED_AVD_REAL_API_RESTART');assert.equal(receipt.transportDisconnectedObserved,true);assert.equal(receipt.uiSnapshotCleared,true);
 await command(adb,['-s','emulator-5554','shell','run-as','com.bitpos.bitpos_customer','rm','code_cache/bitpos-realtime069.json']);
 await writeFile(resolve(evidence,'realtime069-avd-restart-r2-20261018.json'),JSON.stringify({...receipt,host:{actualOwnedApiRestart:true,restartWaitedForAssertedUiClearing:true,port:fixturePort,retainedScreenshot:'realtime069-avd-recovered-r2-20261018.png',scratchCreated:0,scratchRemaining:0,privateExportRemoved:true}},null,2)+'\n');
 console.log(JSON.stringify({status:receipt.status,actualOwnedApiRestart:true,fixture:true,physicalTesting:'deferred_by_user_2026-10-16'}));
}finally{if(flutter)await stop(flutter);if(api)await stop(api);}
