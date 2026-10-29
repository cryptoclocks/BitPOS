// Named disposable W01 DB/API and existing AVD only. No order/payment/chain/provider commands.
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReviewAvdScope} from './food-cancellation-review-avd-smoke';
const scope=new ReviewAvdScope(300000),db=new pg.Client({host:'127.0.0.1',port:55446,database:'bitpos_w01_fixture',statement_timeout:10000});
const stamp=new Date().toISOString().replaceAll(':','-'),root='.omp/work/flutter-delivery-20261016/evidence/',evidence=root+'customer-menu-search-avd-'+stamp+'.json';
const account=randomUUID(),session=randomUUID(),device=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url'),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
let connected=false,privateDirectory:string|undefined,configPath:string|undefined,shots=Promise.resolve(),log='';
const captured=new Set<string>(),receipt:Record<string,unknown>={status:'RUNNING',fixture:true,captures:[],limits:['Actual existing local API catalog; ephemeral local fixture identity only','Native FoodPage surface, not root navigation/full platform acceptance','No order/payment/chain/provider operations'],physicalTesting:'deferred_by_user_2026-10-16'};
try{
 await db.connect();connected=true;assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_w01_fixture');
 const before=(await db.query('SELECT id,stock,reserved FROM bitpos.products ORDER BY id')).rows;
 await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '30 minutes')",[session,account,device,hash(access),hash(refresh)]);
 await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',[hash(refresh),session]);
 const value={accountId:account,sessionId:session,accessToken:access,refreshToken:refresh,accessExpiresAt:new Date(Date.now()+900000).toISOString(),refreshExpiresAt:new Date(Date.now()+1800000).toISOString()};
 privateDirectory=await mkdtemp(join(tmpdir(),'bitpos-native-menu-config-'));configPath=join(privateDirectory,'fixture.json');
 await writeFile(configPath,JSON.stringify({BITPOS_FIXTURE:'true',BITPOS_TEST_DEVICE_ID:device,BITPOS_TEST_SESSION_BASE64:Buffer.from(JSON.stringify(value)).toString('base64'),BITPOS_MOBILE_API:'http://10.0.2.2:3046/api/mobile/v1/'}),{mode:0o600,flag:'wx'});
 const pre=await fetch('http://127.0.0.1:3046/api/mobile/v1/branches',{signal:scope.signal});assert.equal(pre.status,200);
 const child=scope.track(spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/menu_search_recovery_test.dart','-d','emulator-5554','--dart-define-from-file='+configPath,'--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-customer',stdio:['ignore','pipe','pipe']}));
 const observe=(chunk:Buffer)=>{const text=chunk.toString().replaceAll(access,'[fixture-token]').replaceAll(refresh,'[fixture-token]');process.stdout.write(text);log=(log+text).slice(-24000);for(const stage of ['NO_MATCH_EN','RECOVERED_EN','NO_MATCH_TH','RECOVERED_TH']){if(captured.has(stage)||!log.includes('BITPOS_MENU_'+stage))continue;captured.add(stage);shots=shots.then(async()=>{if(scope.signal.aborted)return;const path=root+'customer-menu-'+stage.toLowerCase()+'-'+stamp+'.png',adb=scope.track(spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554','exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']})),chunks:Buffer[]=[];adb.stdout.on('data',bytes=>chunks.push(bytes));assert.equal((await scope.wait(once(adb,'exit')))[0],0);const bytes=Buffer.concat(chunks);assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));await writeFile(path,bytes,{flag:'wx'});(receipt.captures as unknown[]).push({path,sha256:hashBytes(bytes)});}).catch(error=>{receipt.captureError=redact(error);scope.abort(error);});}};
 child.stdout.on('data',observe);child.stderr.on('data',observe);assert.equal((await scope.wait(once(child,'exit')))[0],0);await shots;if(receipt.captureError)throw new Error(String(receipt.captureError));assert.equal(captured.size,4);
 assert.deepEqual((await db.query('SELECT id,stock,reserved FROM bitpos.products ORDER BY id')).rows,before);
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.online_food_orders WHERE account_id=$1',[account])).rows[0].n,0);
 assert.equal((await db.query('SELECT revoked_at IS NOT NULL revoked FROM bitpos.mobile_sessions WHERE id=$1',[session])).rows[0].revoked,true);
 receipt.status='PASS_ACTUAL_LOCAL_API_AVD_MENU_SEARCH_RECOVERY';receipt.checks={localApiMenu:true,englishAndThaiNoMatchClear:true,stockUnchanged:true,createdOrders:0,logoutSessionRevoked:true};
 receipt.sourceHashes=Object.fromEntries(await Promise.all(['apps/mobile-customer/lib/food_page.dart','apps/mobile-customer/integration_test/menu_search_recovery_test.dart','tools/runtime/customer-menu-search-recovery-avd.ts'].map(async path=>[path,hashBytes(await readFile(path))])));
}catch(error){receipt.status='FAIL_RETAINED';receipt.error=String(error instanceof Error?error.message:error).replaceAll(access,'[fixture-token]').replaceAll(refresh,'[fixture-token]');process.exitCode=1;}
finally{
 scope.close();await shots;const cleanupErrors:string[]=[];
 const cleanup=async(label:string,action:()=>Promise<unknown>)=>{try{await action();}catch(error){cleanupErrors.push(label+': '+redact(error));}};
 if(connected){
  await cleanup('session retirement',()=>db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1',[session]));
  await cleanup('account retirement',()=>db.query('UPDATE bitpos.mobile_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[account]));
  await cleanup('database close',()=>db.end());
 }
 await cleanup('private config removal',async()=>{if(configPath)await unlink(configPath);receipt.privateConfigRemoved=true;});
 await cleanup('private directory removal',async()=>{if(privateDirectory)await rmdir(privateDirectory);});
 if(cleanupErrors.length){receipt.status='FAIL_RETAINED';receipt.cleanupErrors=cleanupErrors;process.exitCode=1;}
 await writeFile(evidence,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:receipt.status,evidence,error:receipt.error,cleanupErrors}));
}
function hashBytes(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}
function redact(error:unknown){return String(error instanceof Error?error.message:error).replaceAll(access,'[fixture-token]').replaceAll(refresh,'[fixture-token]');}
