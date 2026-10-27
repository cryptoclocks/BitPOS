// Local deterministic UI fixtures only; never submits an order or payment.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,copyFile,rm,rmdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exec=promisify(execFile),adb='/Users/cryptoclock/Library/Android/sdk/platform-tools/adb';
const evidence='.omp/work/flutter-delivery-20261016/evidence/';
const stamp=new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();
const lease=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/surface-ui-device-lease-20261023.json','utf8'));
assert.equal(lease.holder,'Main','Exclusive parent AVD lease required');
const device=(args,signal)=>exec(adb,['-s','emulator-5554',...args],{encoding:'buffer',maxBuffer:20*1024*1024,timeout:15000,...(signal?{signal}:{})});
const originalSize=(await device(['shell','wm','size'])).stdout.toString(),originalDensity=(await device(['shell','wm','density'])).stdout.toString();
assert.ok(!originalSize.includes('Override')&&!originalDensity.includes('Override'),'Do not overwrite another wm override');
const scratch=await mkdtemp(join(tmpdir(),'bitpos-customer-surface-'));
const receipt={status:'RUNNING',fixture:true,physical_testing:'deferred_by_user_2026-10-16',originalSize,originalDensity,captures:[],cleanupErrors:[],limits:['In-memory API and native fixtures; no HTTP/SQL/provider/payment proof']};
const controller=new AbortController(),seen=new Set();
let output='',pending=Promise.resolve(),child,childExit,timer,killTimer;
const stop=reason=>{
 if(!controller.signal.aborted)controller.abort(reason);
 if(child&&child.exitCode===null&&child.signalCode===null){
  child.kill('SIGTERM');
  if(!killTimer){killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},250);killTimer.unref();}
 }
};
const interrupted=signal=>{const error=new Error('CUSTOMER_SURFACE_CANCELLED_'+signal);receipt.cancelled=signal;receipt.status='FAIL';receipt.error??=String(error);stop(error);};
const onInt=()=>interrupted('SIGINT'),onTerm=()=>interrupted('SIGTERM');
process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
const runDevice=(...args)=>device(args,controller.signal);
const assertUnoccluded=async()=>{
 const windows=(await runDevice('shell','dumpsys','window','windows')).stdout.toString();
 const title='Application Not Responding: com.bitpos.bitpos_customer';
 const focused=windows.split('\n').some(line=>line.includes('mCurrentFocus=')&&line.includes(title));
 const visible=windows.split(/(?=Window #\d+ Window\{)/).some(block=>block.includes(title)&&/\b(?:isOnScreen|isVisible)=true\b/.test(block));
 if(focused||visible){receipt.activeAnrDialog=true;throw new Error('CUSTOMER_NATIVE_ACTIVE_ANR_DIALOG');}
};
try{
 timer=setTimeout(()=>stop(new Error('CUSTOMER_SURFACE_DEADLINE')),280000);
 const anrBefore=(await runDevice('shell','dumpsys','activity','lastanr')).stdout.toString();
 await assertUnoccluded();
 await runDevice('shell','wm','size','1170x2532');await runDevice('shell','wm','density','480');
 controller.signal.throwIfAborted();
 child=spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/surface_customer_food_ui_test.dart','-d','emulator-5554','--no-pub','--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-customer',stdio:['ignore','pipe','pipe']});
 childExit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 const observe=bytes=>{
  process.stdout.write(bytes);output+=bytes.toString();
  for(const screen of ['U11','U15'])if(!seen.has(screen)&&output.includes('BITPOS_CUSTOMER_SURFACE_CAPTURE '+screen+'-')){
   seen.add(screen);pending=pending.then(async()=>{
    await assertUnoccluded();
    const file='customer-surface-'+screen+'-native-th-390-'+stamp+'.png';
    const image=(await runDevice('exec-out','screencap','-p')).stdout;
    await assertUnoccluded();
    await writeFile(join(scratch,file),image,{flag:'wx'});
    await copyFile(join(scratch,file),evidence+file,constants.COPYFILE_EXCL);receipt.captures.push(file);
   }).catch(error=>{receipt.captureError=String(error);stop(error);});
  }
 };
 child.stdout.on('data',observe);child.stderr.on('data',observe);
 const code=await childExit;
 await pending;if(receipt.captureError)throw new Error(receipt.captureError);
 controller.signal.throwIfAborted();
 assert.equal(code,0);assert.ok(output.includes('All tests passed!'));assert.equal(seen.size,2);
 await assertUnoccluded();
 const anrAfter=(await runDevice('shell','dumpsys','activity','lastanr')).stdout.toString();
 if(anrAfter!==anrBefore&&anrAfter.includes('com.bitpos.bitpos_customer')){
  receipt.nativeAnr=anrAfter.split('\n').filter(line=>/ANR time:|Reason:/.test(line));
  throw new Error('CUSTOMER_NATIVE_ANR_DURING_SURFACE_RUN');
 }
 receipt.status='PASS_CURRENT_ANDROID_CUSTOMER_SURFACE_FIXTURE';
}catch(error){receipt.status='FAIL';receipt.error=String(error);stop(error);}
finally{
 clearTimeout(timer);
 if(childExit)await childExit.catch(error=>{receipt.cleanupErrors.push('child exit: '+String(error));});
 clearTimeout(killTimer);await pending;
 const cleanup=async(label,operation)=>{try{await operation();}catch(error){receipt.cleanupErrors.push(label+': '+String(error));}};
 // Restore independently, even after cancellation or an earlier adb failure.
 await cleanup('size reset',()=>device(['shell','wm','size','reset']));
 await cleanup('density reset',()=>device(['shell','wm','density','reset']));
 await cleanup('size readback',async()=>{receipt.restoredSize=(await device(['shell','wm','size'])).stdout.toString();assert.equal(receipt.restoredSize,originalSize);});
 await cleanup('density readback',async()=>{receipt.restoredDensity=(await device(['shell','wm','density'])).stdout.toString();assert.equal(receipt.restoredDensity,originalDensity);});
 await cleanup('output persistence',()=>writeFile(evidence+'customer-surface-native-output-'+stamp+'.txt',output,{flag:'wx'}));
 await cleanup('scratch cleanup',async()=>{const files=await readdir(scratch);let deleted=0;for(const file of files)await cleanup('scratch file '+file,async()=>{await rm(join(scratch,file));deleted++;});const remaining=(await readdir(scratch)).length;if(!remaining)await rmdir(scratch);receipt.cleanup={scratch,created:files.length,deleted,remaining};});
 if(receipt.cleanupErrors.length){receipt.status='FAIL';receipt.error??='CUSTOMER_SURFACE_CLEANUP_FAILED';}
 process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);
 // Receipt write itself remains a hard error if storage is unavailable.
 await writeFile(evidence+'customer-surface-native-'+stamp+'.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
}
if(receipt.status!=='PASS_CURRENT_ANDROID_CUSTOMER_SURFACE_FIXTURE')process.exitCode=1;
console.log(receipt.status);
