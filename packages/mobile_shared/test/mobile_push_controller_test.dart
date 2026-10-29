import 'dart:async';import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_push_settings.dart';
import 'package:flutter_test/flutter_test.dart';import 'package:flutter_secure_storage/flutter_secure_storage.dart';import 'package:http/http.dart' as http;import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/mobile_push_controller.dart';import 'package:mobile_shared/mobile_push_native.dart';
import 'mobile_session_race_test.dart' as fixture;
class Native implements MobilePushNative{
 Native({this.configured=true});@override final bool configured;
 final fids=StreamController<String>.broadcast(sync:true),gone=StreamController<void>.broadcast(sync:true),opens=StreamController<MobilePushEnvelope>.broadcast(sync:true),messages=StreamController<MobilePushEnvelope>.broadcast(sync:true);
 int prompts=0,registers=0,clears=0,closed=0;bool failUnregister=false;Completer<void>? registrationGate;
 @override Stream<String> get registrations=>fids.stream;@override Stream<void> get unregistrations=>gone.stream;@override Stream<MobilePushEnvelope> get opened=>opens.stream;@override Stream<MobilePushEnvelope> get foreground=>messages.stream;
 @override Future<Map<String,dynamic>> environment()async=>{};@override Future<void> clearUpdates()async{clears++;}@override Future<void> openSettings()async{}
 @override Future<MobilePushEnvelope?> initialize()async=>null;@override Future<MobilePushPermission> permission({bool request=false})async{if(request)prompts++;return MobilePushPermission.authorized;}
 @override Future<void> register()async{registers++;if(registrationGate!=null)await registrationGate!.future;fids.add('synthetic-fixture-fid');}
 @override Future<void> unregister()async{if(failUnregister)throw const MobilePushNativeException('PUSH_UNREGISTRATION_UNAVAILABLE');}@override Future<void> close()async{closed++;await fids.close();await gone.close();await opens.close();await messages.close();}
}
class Server{
 bool consent=false,loseEnable=false;int revision=0,generation=0;String? key;final bodies=<Map<String,dynamic>>[];final receipts=<String,Map<String,dynamic>>{};
 final registrationCommitted=Completer<void>();
 Completer<void>? enableResponseGate;
 Future<http.Response> handle(http.Request request)async{
  Map<String,dynamic> response;
  final incoming=request.headers['X-BitPOS-Push-Installation-Key'];
  if(request.method=='GET'){
   if(key!=null&&incoming!=key)return http.Response(jsonEncode({'error':{'code':'VERSION_CONFLICT'}}),409);
   response={'installation':revision==0?{'kind':'UNREGISTERED','revision':'0'}:{'kind':'REGISTERED','installationId':'00000000-0000-4000-8000-000000000087','bindingId':'00000000-0000-4000-8000-000000000088','revision':'$revision','generation':'$generation','boundToCurrentSession':true,'consentEnabled':consent,'capability':'authorized','endpointRegistered':consent},'endpointEncryptionAvailable':true};
  }else{
   final body=jsonDecode(request.body) as Map<String,dynamic>;bodies.add(body);final id=body['idempotencyKey'] as String;
   if(receipts.containsKey(id)){response={...receipts[id]!,'replayed':true};}
   else{
    if(body['expectedRevision']!='$revision')return http.Response(jsonEncode({'error':{'code':'VERSION_CONFLICT'}}),409);
    if(body['kind']!='ROTATE'){revision++;generation++;}consent=body['kind']!='DISABLE';key=body['kind']=='ENABLE'?request.headers['X-BitPOS-Push-Next-Key']:incoming;
    response={'installationId':'00000000-0000-4000-8000-000000000087','bindingId':'00000000-0000-4000-8000-000000000088','revision':'$revision','generation':'$generation','action':body['kind'],'replayed':false};receipts[id]=response;
    if(body['kind']=='ENABLE'){if(!registrationCommitted.isCompleted)registrationCommitted.complete();if(enableResponseGate!=null)await enableResponseGate!.future;if(loseEnable){loseEnable=false;throw http.ClientException('Synthetic response lost after commit');}}
   }
  }return http.Response(jsonEncode(response),200);
 }
}
class GatedStorage extends FlutterSecureStorage{
 final reading=Completer<void>(),release=Completer<void>();
 @override Future<String?> read({required String key,AppleOptions? iOptions,AndroidOptions? aOptions,LinuxOptions? lOptions,WindowsOptions? wOptions,WebOptions? webOptions,AppleOptions? mOptions})async{
  if(key=='bitpos.privatePush.customer.v1'){if(!reading.isCompleted)reading.complete();await release.future;}
  return super.read(key:key);
 }
}
void main(){TestWidgetsFlutterBinding.ensureInitialized();
 Future<MobileApi> api(Server server,{FlutterSecureStorage? secure})async{final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,storage:secure??const FlutterSecureStorage(),client:MockClient(server.handle));await api.restore();return api;}
 void storage()=>FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode(fixture.session('1'))});
 MobilePushController controller(MobileApi api,Native native)=>MobilePushController(api:api,native:native,app:MobilePushApp.customer,locale:()=> 'en',onOpen:(_,_)=>fail('Unexpected notification navigation'));
 test('unconfigured build never prompts or registers but actual opt-out is a durable server command',()async{
  storage();final server=Server(),client=await api(server),native=Native(configured:false),push=controller(client,native);try{
   await push.start();await push.enable();expect(push.errorCode,'PUSH_CONFIGURATION_REQUIRED');expect(server.consent,false);expect(native.prompts,0);expect(native.registers,0);
   await push.disable();expect(server.bodies.single['kind'],'DISABLE');expect(server.revision,1);expect(push.enabled,false);
  }finally{await push.close();client.close();}
 });
 test('lost ENABLE response recovers exact persisted command after process restart without another permission prompt',()async{
  storage();final server=Server()..loseEnable=true,firstApi=await api(server),firstNative=Native(),first=controller(firstApi,firstNative);
  await first.start();await first.enable();expect(server.consent,true);expect(first.enabled,false);expect(first.errorCode,isNotNull);final id=server.bodies.single['idempotencyKey'];await first.close();firstApi.close();
  final nextApi=await api(server),native=Native(),restarted=controller(nextApi,native);try{
   await restarted.start();expect(restarted.enabled,true);expect(native.prompts,0);expect(server.bodies[1]['idempotencyKey'],id);expect(server.bodies.where((b)=>b['kind']=='ENABLE').length,2);expect(server.revision,1);
  }finally{await restarted.close();nextApi.close();}
 });
 test('opt-out during unresolved committed ENABLE survives restart before that response settles',()async{
  storage();final server=Server()..enableResponseGate=Completer<void>(),firstApi=await api(server),first=controller(firstApi,Native());await first.start();
  final enabling=first.enable();await server.registrationCommitted.future;final disabling=first.disable();await Future<void>.delayed(Duration.zero);
  // A stopped old actor remains blocked on its network response; restart reads only durable state.
  final nextApi=await api(server),restarted=controller(nextApi,Native(configured:false));
  try{await restarted.start();expect(server.consent,false,reason:'Explicit opt-out must survive restart while prior ENABLE response is unresolved');expect(restarted.enabled,false);}
  finally{server.enableResponseGate!.complete();await enabling;await disabling;await first.close();await restarted.close();firstApi.close();nextApi.close();}
 });
 test('immediate close after opt-out cannot preserve positive consent from an unresolved ENABLE',()async{
  storage();final server=Server()..enableResponseGate=Completer<void>(),firstApi=await api(server),first=controller(firstApi,Native());await first.start();
  final enabling=first.enable();await server.registrationCommitted.future;final disabling=first.disable(),closing=first.close();
  final nextApi=await api(server),restarted=controller(nextApi,Native(configured:false));
  try{await restarted.start();expect(server.consent,false,reason:'Dispose must flush explicit opt-out before discarding its owner epoch');expect(restarted.enabled,false);}
  finally{server.enableResponseGate!.complete();await enabling;await disabling;await closing;await restarted.close();firstApi.close();nextApi.close();}
 });
 test('opt-out and close during initial private-state read preserve negative consent for restart',()async{
  storage();final server=Server(),originalApi=await api(server),original=controller(originalApi,Native());await original.start();await original.enable();await original.close();originalApi.close();
  final secure=GatedStorage(),loadingApi=await api(server,secure:secure),loading=controller(loadingApi,Native(configured:false)),starting=loading.start();await secure.reading.future;
  final disabling=loading.disable(),closing=loading.close();secure.release.complete();await starting;await disabling;await closing;loadingApi.close();
  final nextApi=await api(server),next=controller(nextApi,Native(configured:false));
  try{await next.start();expect(server.consent,false);expect(server.bodies.where((b)=>b['kind']=='ENABLE').length,1);expect(next.enabled,false);}finally{await next.close();nextApi.close();}
 });
 test('disable while native registration waits freezes immediately and late FID cannot issue ENABLE',()async{
  storage();final server=Server(),client=await api(server),native=Native()..registrationGate=Completer<void>(),push=controller(client,native);try{
   await push.start();final enabling=push.enable();while(native.registers==0){await Future<void>.delayed(Duration.zero);}
   final disabling=push.disable();expect(push.enabled,false);native.registrationGate!.complete();await enabling;await disabling;
   expect(server.bodies.map((b)=>b['kind']),['DISABLE']);expect(server.consent,false);expect(server.revision,1);
  }finally{await push.close();client.close();}
 });
 test('persisted opt-out crash window converges committed ENABLE and pending ROTATE without replaying positive consent',()async{
  for(final committed in [false,true]){for(final kind in ['ENABLE','ROTATE']){
   storage();final server=Server()..loseEnable=true,firstApi=await api(server),first=controller(firstApi,Native());await first.start();await first.enable();await first.close();firstApi.close();
   const secure=FlutterSecureStorage();final saved=jsonDecode((await secure.read(key:'bitpos.privatePush.customer.v1'))!) as Map<String,dynamic>;
   saved['desiredOwner']=null;
   if(kind=='ROTATE'){final pending=saved['pending'] as Map<String,dynamic>;final body=pending['command'] as Map<String,dynamic>;body.remove('platform');body.remove('consentVersion');body['kind']='ROTATE';body['expectedRevision']='1';pending['key']=pending['nextKey'];pending['nextKey']=null;}
   if(!committed){server.consent=false;server.key=null;server.revision=0;server.generation=0;server.receipts.clear();}
   await secure.write(key:'bitpos.privatePush.customer.v1',value:jsonEncode(saved));
   final calls=server.bodies.length,nextApi=await api(server),native=Native(),next=controller(nextApi,native);try{
    await next.start();expect(server.consent,false);expect(next.status!.installation.toJson()['consentEnabled'],false);
    expect(server.bodies.skip(calls).map((body)=>body['kind']),['DISABLE']);expect(native.prompts,0);expect(native.registers,0);
   }finally{await next.close();nextApi.close();}
  }}
 });
 test('native disposal failure retains sanitized diagnostic and still clears and closes once',()async{
  storage();final server=Server(),client=await api(server),native=Native()..failUnregister=true,push=controller(client,native);await push.start();await push.close();expect(push.errorCode,'PUSH_UNREGISTRATION_UNAVAILABLE');expect(native.clears,1);expect(native.closed,1);await push.close();expect(native.closed,1);client.close();
 });
 testWidgets('narrow Thai settings render without requesting system permission',(tester)async{
  await tester.binding.setSurfaceSize(const Size(320,900));addTearDown(()=>tester.binding.setSurfaceSize(null));
  storage();final server=Server(),client=await api(server),native=Native(),push=controller(client,native);
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:const TextScaler.linear(1.5)),child:Scaffold(body:SingleChildScrollView(child:MobilePushSettings(controller:push,thai:true)))))));
  await tester.runAsync(()=>push.start());await tester.pump();
  expect(native.prompts,0);expect(native.registers,0);expect(server.bodies,isEmpty);
  final disable=find.widgetWithText(OutlinedButton,'ปิดรับบนอุปกรณ์นี้');await tester.ensureVisible(disable);await tester.pumpAndSettle();
  expect(tester.widget<OutlinedButton>(disable).onPressed,isNotNull);expect(tester.getSize(disable).height,greaterThanOrEqualTo(52));expect(tester.takeException(),isNull);
  await tester.pumpWidget(const SizedBox.shrink());await tester.runAsync(()=>push.close());client.close();
 });
 testWidgets('visible opt-out remains actionable while native enable is unresolved',(tester)async{
  storage();final server=Server(),client=await api(server),native=Native()..registrationGate=Completer<void>(),push=controller(client,native);
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:MobilePushSettings(controller:push,thai:false)))));
  await tester.runAsync(()=>push.start());await tester.pump();
  await tester.runAsync(()async{await tester.tap(find.text('Enable notifications'));for(var i=0;i<50&&native.registers==0;i++){await Future<void>.delayed(const Duration(milliseconds:5));}});await tester.pump();expect(native.registers,1,reason:push.errorCode);
  final optout=find.widgetWithText(OutlinedButton,'Opt out on this device');expect(tester.widget<OutlinedButton>(optout).onPressed,isNotNull);
  await tester.ensureVisible(optout);await tester.runAsync(()=>tester.tap(optout));await tester.pump();expect(push.enabled,false);
  await tester.runAsync(()async{native.registrationGate!.complete();await push.refresh();});await tester.pump();expect(push.busy,false);
  expect(server.bodies.map((b)=>b['kind']),['DISABLE']);expect(server.consent,false);await tester.pumpWidget(const SizedBox.shrink());await tester.runAsync(()=>push.close());client.close();
 });
 test('persisted negative consent without any pending journal disables confirmed server binding once',()async{
  storage();final server=Server(),firstApi=await api(server),first=controller(firstApi,Native());await first.start();await first.enable();expect(first.enabled,true);await first.close();firstApi.close();
  const secure=FlutterSecureStorage();final saved=jsonDecode((await secure.read(key:'bitpos.privatePush.customer.v1'))!) as Map<String,dynamic>;expect(saved['pending'],isNull);saved['desiredOwner']=null;await secure.write(key:'bitpos.privatePush.customer.v1',value:jsonEncode(saved));
  final before=server.bodies.length,nextApi=await api(server),native=Native(),next=controller(nextApi,native);try{
   await next.start();expect(server.consent,false);expect(server.bodies.skip(before).map((body)=>body['kind']),['DISABLE']);expect(native.prompts,0);expect(native.registers,0);
   final revision=server.revision;await next.refresh();expect(server.revision,revision);expect(server.bodies.length,before+1);
  }finally{await next.close();nextApi.close();}
 });
}
