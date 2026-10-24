import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile,unlink} from 'node:fs/promises';
const role=process.argv[2];assert.ok(role==='customer'||role==='driver');
const directory='apps/mobile-'+role,target=directory+'/integration_test/push087_native_probe.dart';
const source=`import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:mobile_shared/mobile_push_native.dart';
void main(){IntegrationTestWidgetsFlutterBinding.ensureInitialized();testWidgets('real native notification environment and unconfigured provider',(tester)async{
 final native=FirebaseMobilePushNative(MobilePushConfiguration.fromEnvironment(),app:'${role.toUpperCase()}');addTearDown(native.close);
 expect(native.configured,false);expect(Firebase.apps,isEmpty);
 final before=await native.environment();expect(before['applicationId'],'com.bitpos.bitpos_${role}');expect(before['playServicesStatus'],isA<int>());
 await expectLater(native.initialize(),throwsA(isA<MobilePushNativeException>().having((e)=>e.code,'code','PUSH_CONFIGURATION_REQUIRED')));expect(Firebase.apps,isEmpty);
 await const MethodChannel('bitpos/mobile_push').invokeMethod<void>('ensureUpdateChannel',{'name':'BitPOS fixture notification updates'});
 final after=await native.environment();expect(after['channelEnabled'],true);
 await native.clearUpdates();
 await tester.pumpWidget(MaterialApp(home:Scaffold(body:SafeArea(child:Text('Synthetic native probe only. Push provider configuration unavailable. Google Play status: \u0024{after['playServicesStatus']}. No registration or messages sent.')))));
 await tester.pump();expect(tester.takeException(),isNull);
 debugPrint('BITPOS_PUSH087_NATIVE_ENVIRONMENT_CONFIRMED');
});}
`;
await writeFile(target,source,{flag:'wx'});
try{
 const child=spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/push087_native_probe.dart','-d','emulator-5554','--no-enable-impeller','--no-uninstall'],{cwd:directory,stdio:['ignore','pipe','pipe']});let observed=false;
 const observe=(bytes:Buffer)=>{process.stdout.write(bytes);if(bytes.toString().includes('BITPOS_PUSH087_NATIVE_ENVIRONMENT_CONFIRMED'))observed=true;};child.stdout.on('data',observe);child.stderr.on('data',observe);
 assert.equal((await once(child,'exit'))[0],0);assert.ok(observed);
 const receipt={status:'PASS_REAL_AVD_NATIVE_PUSH_UNCONFIGURED_PROBE',app:role,checks:['Actual compiled native environment returns correct applicationId and Google Play status','Unconfigured real adapter rejects initialization without Firebase app/registration','Distinct Android push notification channel created and app-owned push clear executes'],limits:['Throwaway native probe, not implemented account consent/outbox/settings/open E2E','No provider credentials, provider calls, real push message, APNs/iOS or physical proof'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/notification087-'+role+'-native-probe-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await unlink(target);}
