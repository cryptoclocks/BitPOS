// Existing Pixel AVD only. UI fixtures: no API, GPS, provider or financial operations.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer, type Server} from 'node:http';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReviewAvdScope} from './food-cancellation-review-avd-smoke';
const scope=new ReviewAvdScope(600000);
const stamp=new Date().toISOString().replaceAll(':','-');
const root='.omp/work/flutter-delivery-20261016/evidence/';
const custody=process.env.BITPOS_RIDER_SURFACE==='custody';
const details=process.env.BITPOS_RIDER_SURFACE==='details';
assert.ok(!process.env.BITPOS_RIDER_SURFACE||custody||details,'Unknown Rider surface');
const evidence=root+(custody?'rider-custody-surface-avd-':details?'rider-details-surface-avd-':'rider-assigned-navigation-avd-')+stamp+'.json';
const scratch=await mkdtemp(join(tmpdir(),custody?'bitpos-rider-custody-':details?'bitpos-rider-details-':'bitpos-rider-assigned-navigation-'));
const stages=custody?['R11','R13']:details?['R08_EN_DETAILS','R08_TH_DETAILS']:['R09_EN','R12_EN','R09_TH','R12_TH'].flatMap(stage=>[stage+'_MAP',stage+'_ACTIONS']).concat(['R08_EN_DETAILS','R08_TH_DETAILS']);
const captured=new Set<string>();
const captures:{path:string;sha256:string}[]=[];
const hostTrace:Record<string,unknown>[]=[];
const clientTrace:Record<string,unknown>[]=[];
const receipt:Record<string,unknown>={status:'RUNNING',fixture:true,captures,hostTrace,clientTrace,scratchDirectory:scratch,scratchCleanup:'pending_parent_visual_analysis',physicalTesting:'deferred_by_user_2026-10-16',limits:[custody?'Native R11/R13 custody presentation; in-memory work/proof fixtures':'Native R09/R12 composition plus R08 details→journey presentation with original synthetic route and tile fixtures','No API, real GPS, background, payment, custody or delivery proof','No full fidelity/platform acceptance inferred']};
if(details){receipt.surface='R08 details only';receipt.limits=['Native TH/EN R08 details fixture only; no R09/R12 retest','No API, real GPS, background, payment, custody or delivery proof','No full fidelity/platform acceptance inferred'];}
let log='',shots=Promise.resolve(),captureError:unknown;
let anrBefore='';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const hostNow=()=>Math.round(performance.now());
const deviceOutput=async(...args:string[])=>{
 const child=scope.track(spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554',...args],{stdio:['ignore','pipe','pipe']}));
 const chunks:Buffer[]=[];child.stdout.on('data',bytes=>chunks.push(bytes));
 assert.equal((await scope.wait(once(child,'exit')))[0],0);
 return Buffer.concat(chunks);
};
const captureStage=async(stage:string)=>{
 const path=join(scratch,(custody?'rider-custody-':'rider-assigned-navigation-')+stage.toLowerCase()+'-'+stamp+'.png');
 const bytes=await deviceOutput('exec-out','screencap','-p');
 assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
 await writeFile(path,bytes,{flag:'wx'});
 captures.push({path,sha256:hash(bytes)});
};
const boundedAnr=async()=>{
 const child=spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554','shell','dumpsys','activity','lastanr'],{stdio:['ignore','pipe','ignore']});
 const chunks:Buffer[]=[];child.stdout.on('data',bytes=>chunks.push(bytes));
 return await new Promise<string>(resolve=>{
  const timer=setTimeout(()=>{child.kill();resolve('ANR_DIAGNOSTIC_TIMEOUT');},5000);
  child.once('error',()=>{clearTimeout(timer);resolve('ANR_DIAGNOSTIC_SPAWN_FAILED');});
  child.once('exit',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks).toString());});
 });
};
let captureServer:Server|undefined,captureInFlight=false;
try{
 anrBefore=(await deviceOutput('shell','dumpsys','activity','lastanr')).toString();
 let expectedStage=0;
 if(!custody){
  captureServer=createServer((request,response)=>{
   void (async()=>{
    const stage=decodeURIComponent(request.url?.replace(/^\//,'')??'');
    const receivedAt=hostNow();
    const trace={stage,requestReceivedMs:receivedAt,expectedStage:stages[expectedStage],capturedStage:undefined as string|undefined,captureStartedMs:undefined as number|undefined,captureFinishedMs:undefined as number|undefined,responseFinishedMs:undefined as number|undefined,responseClosedMs:undefined as number|undefined};
    hostTrace.push(trace);
    response.once('finish',()=>{trace.responseFinishedMs=hostNow();});
    response.once('close',()=>{trace.responseClosedMs=hostNow();});
    if(request.method!=='POST'||stage!==stages[expectedStage]||captureInFlight){
     response.statusCode=409;response.end();
     throw new Error(`Unexpected capture acknowledgement ${request.method??''} ${stage}; expected ${captureInFlight?'no concurrent capture':stages[expectedStage]??'none'}`);
    }
    captureInFlight=true;
    try{
     trace.captureStartedMs=hostNow();
     await captureStage(stage);
     trace.captureFinishedMs=hostNow();
     trace.capturedStage=stage;
     expectedStage++;
     response.statusCode=204;response.end();
    }finally{
     captureInFlight=false;
    }
   })().catch(error=>{
    captureError=error;
    if(!response.headersSent){response.statusCode=500;response.end();}
    scope.abort(error);
   });
  });
  await new Promise<void>((resolve,reject)=>{
   captureServer!.once('error',reject);
   captureServer!.listen(0,'127.0.0.1',resolve);
  });
 }
 const acknowledgementAddress=captureServer?.address();
 let acknowledgementPort:number|undefined;
 if(!custody){
  if(!acknowledgementAddress||typeof acknowledgementAddress==='string')throw new Error('Capture acknowledgement server did not bind a TCP port');
  acknowledgementPort=acknowledgementAddress.port;
 }
 const child=scope.track(spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test',custody?'integration_test/surface_driver_food_ui_test.dart':'integration_test/assigned_navigation_surface_test.dart','-d','emulator-5554',...(details?['--plain-name','R08 assigned job details']:[]),...(!custody?['--dart-define=BITPOS_RIDER_CAPTURE_ACK=http://10.0.2.2:'+acknowledgementPort]:[]),'--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-driver',stdio:['ignore','pipe','pipe']}));
 const observe=(chunk:Buffer)=>{
  const output=chunk.toString();
  process.stdout.write(chunk);log=(log+output).slice(-24000);
  for(const line of output.split(/\r?\n/)){
   const marker='BITPOS_RIDER_CAPTURE_CLIENT ';
   const payload=line.indexOf(marker);
   if(payload<0)continue;
   try{
    const event=JSON.parse(line.slice(payload+marker.length));
    if(typeof event.stage==='string'&&stages.includes(event.stage)&&typeof event.event==='string'&&typeof event.elapsedMs==='number')clientTrace.push(event);
   }catch{clientTrace.push({parseError:true});}
  }
  if(!custody)return;
  for(const stage of stages){
   if(captured.has(stage)||!log.includes('RIDER_SURFACE_NATIVE_READY '+stage))continue;
   captured.add(stage);
   shots=shots.then(()=>captureStage(stage)).catch(error=>{captureError=error;scope.abort(error);});
  }
 };
 child.stdout.on('data',observe);child.stderr.on('data',observe);
 assert.equal((await scope.wait(once(child,'exit')))[0],0);
 await shots;if(captureError)throw captureError;
 assert.equal(custody?captured.size:expectedStage,stages.length);
 const anrAfter=await boundedAnr();
 if(anrAfter!==anrBefore&&anrAfter.includes('com.bitpos.bitpos_driver')){
  receipt.nativeAnr=anrAfter.split('\n').filter(line=>/ANR time:|Reason:/.test(line));
  throw new Error('RIDER_NATIVE_ANR_DURING_SURFACE_RUN');
 }
 receipt.sourceHashes=Object.fromEntries(await Promise.all([
  'apps/mobile-driver/lib/food_work_page.dart',
  'apps/mobile-driver/lib/main.dart',
  'apps/mobile-driver/lib/presentation/driver_navigation.dart',
  'apps/mobile-driver/lib/presentation/driver_assigned_navigation_card.dart',
  'apps/mobile-driver/lib/presentation/driver_job_details_card.dart',
  ...(custody?['apps/mobile-driver/lib/presentation/driver_food_custody_card.dart']:[]),
  'apps/mobile-driver/test/surface_driver_food_ui_test.dart',
  custody?'apps/mobile-driver/integration_test/surface_driver_food_ui_test.dart':'apps/mobile-driver/integration_test/assigned_navigation_surface_test.dart',
  'packages/mobile_shared/lib/food_navigation_map.dart',
  'tools/runtime/rider-assigned-navigation-surface-avd.ts',
 ].map(async path=>[path,hash(await readFile(path))])));
 receipt.status=custody?'PASS_BOUNDED_NATIVE_RIDER_CUSTODY_FIXTURES':details?'PASS_BOUNDED_NATIVE_RIDER_DETAILS_FIXTURES':'PASS_BOUNDED_NATIVE_RIDER_ASSIGNED_NAVIGATION_FIXTURES';
}catch(error){receipt.status='FAIL_RETAINED';receipt.error=String(error instanceof Error?error.message:error);process.exitCode=1;}
finally{
 captureServer?.close();
 const anrAfter=await boundedAnr();
 if(anrAfter!==anrBefore&&anrAfter.includes('com.bitpos.bitpos_driver'))receipt.nativeAnr=anrAfter.split('\n').filter(line=>/ANR time:|Reason:/.test(line));
 scope.close();await shots;if(log)receipt.diagnosticOutput=log;await writeFile(evidence,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,evidence,error:receipt.error}));
}
