// Existing Pixel AVD only. UI fixtures: no API, GPS, provider or financial operations.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReviewAvdScope} from './food-cancellation-review-avd-smoke';
const scope=new ReviewAvdScope(600000);
const stamp=new Date().toISOString().replaceAll(':','-');
const root='.omp/work/flutter-delivery-20261016/evidence/';
const custody=process.env.BITPOS_RIDER_SURFACE==='custody';
assert.ok(!process.env.BITPOS_RIDER_SURFACE||custody,'Unknown Rider surface');
const evidence=root+(custody?'rider-custody-surface-avd-':'rider-assigned-navigation-avd-')+stamp+'.json';
const scratch=await mkdtemp(join(tmpdir(),custody?'bitpos-rider-custody-':'bitpos-rider-assigned-navigation-'));
const stages=custody?['R11','R13']:['R09_EN','R12_EN','R09_TH','R12_TH'].flatMap(stage=>[stage+'_MAP',stage+'_ACTIONS']);
const captured=new Set<string>();
const captures:{path:string;sha256:string}[]=[];
const receipt:Record<string,unknown>={status:'RUNNING',fixture:true,captures,scratchDirectory:scratch,scratchCleanup:'pending_parent_visual_analysis',physicalTesting:'deferred_by_user_2026-10-16',limits:[custody?'Native R11/R13 custody presentation; in-memory work/proof fixtures':'Native R09/R12 composition with original synthetic route and tile fixtures','No API, real GPS, background, payment, custody or delivery proof','No full fidelity/platform acceptance inferred']};
let log='',shots=Promise.resolve(),captureError:unknown;
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const deviceOutput=async(...args:string[])=>{
 const child=scope.track(spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554',...args],{stdio:['ignore','pipe','pipe']}));
 const chunks:Buffer[]=[];child.stdout.on('data',bytes=>chunks.push(bytes));
 assert.equal((await scope.wait(once(child,'exit')))[0],0);
 return Buffer.concat(chunks);
};
try{
 const anrBefore=(await deviceOutput('shell','dumpsys','activity','lastanr')).toString();
 const child=scope.track(spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test',custody?'integration_test/surface_driver_food_ui_test.dart':'integration_test/assigned_navigation_surface_test.dart','-d','emulator-5554','--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-driver',stdio:['ignore','pipe','pipe']}));
 const observe=(chunk:Buffer)=>{
  process.stdout.write(chunk);log=(log+chunk.toString()).slice(-24000);
  for(const stage of stages){
   if(captured.has(stage)||!log.includes((custody?'RIDER_SURFACE_NATIVE_READY ':'BITPOS_RIDER_NAVIGATION_')+stage))continue;
   captured.add(stage);
   shots=shots.then(async()=>{
    const path=join(scratch,(custody?'rider-custody-':'rider-assigned-navigation-')+stage.toLowerCase()+'-'+stamp+'.png');
    const bytes=await deviceOutput('exec-out','screencap','-p');
    assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    await writeFile(path,bytes,{flag:'wx'});captures.push({path,sha256:hash(bytes)});
   }).catch(error=>{captureError=error;scope.abort(error);});
  }
 };
 child.stdout.on('data',observe);child.stderr.on('data',observe);
 assert.equal((await scope.wait(once(child,'exit')))[0],0);
 await shots;if(captureError)throw captureError;assert.equal(captured.size,stages.length);
 const anrAfter=(await deviceOutput('shell','dumpsys','activity','lastanr')).toString();
 if(anrAfter!==anrBefore&&anrAfter.includes('com.bitpos.bitpos_driver')){
  receipt.nativeAnr=anrAfter.split('\n').filter(line=>/ANR time:|Reason:/.test(line));
  throw new Error('RIDER_NATIVE_ANR_DURING_SURFACE_RUN');
 }
 receipt.sourceHashes=Object.fromEntries(await Promise.all([
  'apps/mobile-driver/lib/food_work_page.dart',
  'apps/mobile-driver/lib/main.dart',
  'apps/mobile-driver/lib/presentation/driver_navigation.dart',
  'apps/mobile-driver/lib/presentation/driver_assigned_navigation_card.dart',
  ...(custody?['apps/mobile-driver/lib/presentation/driver_food_custody_card.dart']:[]),
  'apps/mobile-driver/test/surface_driver_food_ui_test.dart',
  custody?'apps/mobile-driver/integration_test/surface_driver_food_ui_test.dart':'apps/mobile-driver/integration_test/assigned_navigation_surface_test.dart',
  'packages/mobile_shared/lib/food_navigation_map.dart',
  'tools/runtime/rider-assigned-navigation-surface-avd.ts',
 ].map(async path=>[path,hash(await readFile(path))])));
 receipt.status=custody?'PASS_BOUNDED_NATIVE_RIDER_CUSTODY_FIXTURES':'PASS_BOUNDED_NATIVE_RIDER_ASSIGNED_NAVIGATION_FIXTURES';
}catch(error){receipt.status='FAIL_RETAINED';receipt.error=String(error instanceof Error?error.message:error);process.exitCode=1;}
finally{scope.close();await shots;await writeFile(evidence,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,evidence,error:receipt.error}));}
