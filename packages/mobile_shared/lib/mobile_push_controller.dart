import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:uuid/uuid.dart';
import 'mobile_api.dart';
import 'mobile_push_native.dart';
import 'mobile_v1.generated.dart';

typedef PushOwner=({String accountId,String sessionId});
class _PendingPush {
 const _PendingPush(this.owner,this.command,this.key,this.nextKey);
 final PushOwner owner;final MobilePushCommand command;final String key;final String? nextKey;
 Map<String,dynamic> toJson()=>{'accountId':owner.accountId,'sessionId':owner.sessionId,'command':command.toJson(),'key':key,'nextKey':nextKey};
 factory _PendingPush.fromJson(Map<String,dynamic> value){
  if(value.length!=5||value['accountId'] is! String||value['sessionId'] is! String||value['key'] is! String||value['nextKey']!=null&&value['nextKey'] is! String)throw const FormatException('Invalid private push journal');
  final command=MobilePushCommand.fromJson(Map<String,dynamic>.from(value['command'] as Map));
  return _PendingPush((accountId:value['accountId'] as String,sessionId:value['sessionId'] as String),command,value['key'] as String,value['nextKey'] as String?);
 }
}
/// One installation actor per app root. FID callbacks are hints, never consent or account authority.
class MobilePushController extends ChangeNotifier with WidgetsBindingObserver {
 MobilePushController({required this.api,required this.native,required this.app,required this.locale,required this.onOpen});
 final MobileApi api;final MobilePushNative native;final MobilePushApp app;final String Function() locale;
 final void Function(MobilePushOpenResult result,PushOwner owner) onOpen;
 final List<StreamSubscription<dynamic>> _subscriptions=[];
 Future<void> _tail=Future<void>.value();PushOwner? _owner,_desiredOwner;
 Future<void>? _storageTail,_loading,_intentPersistence;
 List<String> _keys=[];_PendingPush? _pending;bool _loaded=false,_closed=false,_started=false,_allowFid=false,_nativeRegistered=false;
 int _epoch=0;({int epoch,Completer<String?> value})? _waiter;String? _registeredFid,_registeredLocale;
 MobilePushStatus? status;MobilePushPermission? permission;String? errorCode;bool busy=false;
 MobilePushEnvelope? _hint;
 bool get hintAvailable=>_hint!=null;
 bool get signedIn=>_owner!=null;
 bool get enabled=>_desiredOwner==_owner&&_owner!=null&&_nativeRegistered&&_effective!=null;
 MobilePushRegistered? get _effective{final installation=status?.installation;return installation is MobilePushRegistered&&installation.boundToCurrentSession&&installation.consentEnabled&&installation.endpointRegistered?installation:null;}
 String get _storageKey=>'bitpos.privatePush.${app.name}.v1';
 String get _language=>locale()=='th'?'th':'en';
 String _proof()=>base64UrlEncode(List<int>.generate(32,(_)=>Random.secure().nextInt(256))).replaceAll('=','');
 void _cancelWait(){final waiter=_waiter;_waiter=null;if(waiter!=null&&!waiter.value.isCompleted)waiter.value.complete(null);}
 void _nativeFailure(Object error){if(_closed||!_allowFid)return;_allowFid=false;_nativeRegistered=false;errorCode=_code(error);_cancelWait();_notify();}
 void _check(int epoch){if(_closed||epoch!=_epoch||_owner==null||api.sessionScope!=_owner)throw const MobileApiException('SESSION_CHANGED',409);}
 void _notify(){if(!_closed)notifyListeners();}
 Future<T> _serial<T>(Future<T> Function() action){final operation=_tail.then((_)=>action());_tail=operation.then((_) {},onError:(Object error,StackTrace stack){});return operation;}
 String _code(Object error)=>error is MobileApiException?error.code:error is MobilePushNativeException?error.code:error is TimeoutException?'PUSH_NATIVE_TIMEOUT':error is FormatException?'PUSH_RECOVERY_REQUIRED':'PUSH_UNAVAILABLE';
 Future<void> _run(Future<void> Function(int epoch) action){final epoch=_epoch;return _serial(()async{
  if(_closed||epoch!=_epoch)return;busy=true;errorCode=null;_notify();
  try{_check(epoch);await action(epoch);}catch(error){if(!_closed&&epoch==_epoch){errorCode=_code(error);_nativeRegistered=false;}}
  finally{if(!_closed&&epoch==_epoch){busy=false;_notify();}}
 });}
 Future<void> _save(){
  final value=jsonEncode({'keys':_keys,'desiredOwner':_desiredOwner==null?null:{'accountId':_desiredOwner!.accountId,'sessionId':_desiredOwner!.sessionId},'pending':_pending?.toJson()});
  final prior=_storageTail,write=prior==null?api.storage.write(key:_storageKey,value:value):prior.then((_)=>api.storage.write(key:_storageKey,value:value));
  _storageTail=write.then((_) {},onError:(Object error,StackTrace stack){});return write;
 }
 Future<void> _load()async{
  if(_loaded)return;final pending=_loading;if(pending!=null)return pending;
  final operation=_readState();_loading=operation;try{await operation;}finally{_loading=null;}
 }
 Future<void> _readState()async{
  final raw=await api.storage.read(key:_storageKey);
  if(raw==null){_keys=[_proof()];await _save();}
  else{final value=jsonDecode(raw);if(value is! Map<String,dynamic>||value.length!=3||value['keys'] is! List)throw const FormatException('Invalid private push state');
   _keys=(value['keys'] as List).map((value){if(value is! String||!RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(value))throw const FormatException('Invalid installation proof');return value;}).toList();
   if(_keys.isEmpty||_keys.length>32||_keys.toSet().length!=_keys.length)throw const FormatException('Invalid installation proofs');
   final desired=value['desiredOwner'];if(desired!=null){if(desired is! Map<String,dynamic>||desired.length!=2||desired['accountId'] is! String||desired['sessionId'] is! String)throw const FormatException('Invalid consent owner');_desiredOwner=(accountId:desired['accountId'] as String,sessionId:desired['sessionId'] as String);}
   final pending=value['pending'];if(pending!=null){if(pending is! Map<String,dynamic>)throw const FormatException('Invalid private push journal');_pending=_PendingPush.fromJson(pending);if(!_keys.contains(_pending!.key)||_pending!.nextKey!=null&&!_keys.contains(_pending!.nextKey))throw const FormatException('Missing journal installation proof');}
  }_loaded=true;
 }
 Future<({MobilePushStatus status,String key})> _probe(int epoch)async{
  for(final key in _keys.reversed){try{final current=await api.pushStatus(app,key);_check(epoch);status=current;return(status:current,key:key);}
   on MobileApiException catch(error){_check(epoch);if(error.code!='VERSION_CONFLICT')rethrow;}}
  throw const MobileApiException('PUSH_RECOVERY_REQUIRED',409);
 }
 Future<void> _submit(_PendingPush pending,int epoch)async{
  _check(epoch);_pending=pending;await _save();_check(epoch);
  final receipt=await api.pushCommand(app,pending.command,pending.key,nextKey:pending.nextKey);_check(epoch);
  final body=pending.command.toJson();if(receipt.action!=body['kind'])throw const FormatException('Uncorrelated notification receipt');
  // Receipt is historical. Only a fresh authenticated GET can establish effective consent.
  final key=pending.nextKey??pending.key,current=await api.pushStatus(app,key);_check(epoch);
  _keys=[key];_pending=null;status=current;await _save();_check(epoch);
 }
 Future<void> _recover(int epoch)async{
  final pending=_pending;if(pending==null)return;
  if(pending.owner!=_owner){_pending=null;await _save();_check(epoch);return;}
  if((pending.command is MobilePushEnable||pending.command is MobilePushRotate)&&_desiredOwner!=_owner){await _disable(epoch,'USER_OPT_OUT','unknown');return;}
  try{await _submit(pending,epoch);}on MobileApiException catch(error){
   if(!['VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','INVALID_REQUEST','CONFIGURATION_REQUIRED'].contains(error.code))rethrow;
   // Definitive rejection has no effect. Preserve all candidate proofs until a successful fenced mutation.
   if(error.code=='CONFIGURATION_REQUIRED'&&error.status>=500)rethrow;
   _pending=null;await _save();_check(epoch);await _probe(epoch);
  }
 }
 Future<void> start()async{
  if(_started)return;_started=true;WidgetsBinding.instance.addObserver(this);
  _subscriptions.add(api.sessionScopes.listen(_changeOwner));
  _subscriptions.add(native.registrations.listen((fid){final epoch=_epoch;if(!_allowFid||_closed)return;final waiter=_waiter;if(waiter!=null&&waiter.epoch==epoch&&!waiter.value.isCompleted){waiter.value.complete(fid);return;}if(_desiredOwner==_owner&&_owner!=null)unawaited(_run((e)=>_rotate(fid,e)));},onError:_nativeFailure));
  _subscriptions.add(native.unregistrations.listen((_){if(_allowFid&&!_closed){_nativeRegistered=false;_notify();unawaited(refresh());}},onError:_nativeFailure));
  _subscriptions.add(native.opened.listen((event){unawaited(_run((epoch)=>_open(event,epoch,navigate:true)));},onError:_nativeFailure));
  _subscriptions.add(native.foreground.listen((event){unawaited(_run((epoch)=>_open(event,epoch,navigate:false)));},onError:_nativeFailure));
  _owner=api.sessionScope;await refresh();
 }
 void _changeOwner(PushOwner? owner){if(owner==_owner)return;_epoch++;_owner=owner;_allowFid=false;_nativeRegistered=false;_registeredFid=null;_hint=null;status=null;permission=null;busy=false;_cancelWait();_notify();
  unawaited(_serial(()async{try{await native.unregister();await native.clearUpdates();}catch(error){if(!_closed){errorCode=_code(error);_notify();}}}));
  if(owner!=null)unawaited(refresh());
 }
 @override void didChangeAppLifecycleState(AppLifecycleState state){if(state==AppLifecycleState.resumed&&_owner!=null)unawaited(refresh());}
 Future<void> refresh()=>_run((epoch)async{
  await _load();_check(epoch);await _recover(epoch);await _probe(epoch);
  if(_desiredOwner==null&&_effective!=null){await _disable(epoch,'USER_OPT_OUT','unknown');return;}
  if(_desiredOwner!=_owner||_effective==null){_allowFid=false;_nativeRegistered=false;return;}
  if(!native.configured){errorCode='PUSH_CONFIGURATION_REQUIRED';return;}
  await _register(epoch,requestPermission:false,enable:false);
 });
 Future<void> enable()=>_run((epoch)async{
  await _load();_check(epoch);await _recover(epoch);final current=await _probe(epoch);
  if(!native.configured||!current.status.endpointEncryptionAvailable)throw const MobilePushNativeException('PUSH_CONFIGURATION_REQUIRED');
  if(_pending!=null)throw const MobileApiException('PUSH_RECOVERY_REQUIRED',409);
  _desiredOwner=_owner;await _save();_check(epoch);await _register(epoch,requestPermission:true,enable:true);
 });
 Future<void> _register(int epoch,{required bool requestPermission,required bool enable})async{
  _check(epoch);_allowFid=true;final waiter=Completer<String?>();_waiter=(epoch:epoch,value:waiter);
  try{
   final initial=await native.initialize();_check(epoch);permission=await native.permission(request:requestPermission);_check(epoch);
   if(![MobilePushPermission.authorized,MobilePushPermission.provisional].contains(permission)){_allowFid=false;await _disable(epoch,'OS_PERMISSION',permission==MobilePushPermission.denied?'denied':'unknown');return;}
   await native.register().timeout(const Duration(seconds:15));_check(epoch);
   final fid=await waiter.future.timeout(const Duration(seconds:10));_check(epoch);if(fid==null)throw const MobilePushNativeException('PUSH_REGISTRATION_UNAVAILABLE');
   _waiter=null;
   if(enable){final current=await _probe(epoch);if(_keys.length>=32)throw const MobileApiException('PUSH_RECOVERY_REQUIRED',409);final next=_proof();_keys=[..._keys,next];
    final revision=switch(current.status.installation){MobilePushRegistered(:final revision)=>revision,MobilePushUnregistered()=> '0'};
    final platform=defaultTargetPlatform==TargetPlatform.iOS?'ios':defaultTargetPlatform==TargetPlatform.android?'android':throw const MobilePushNativeException('PUSH_NATIVE_UNSUPPORTED');
    await _submit(_PendingPush(_owner!,MobilePushEnable(kind:'ENABLE',idempotencyKey:const Uuid().v4(),expectedRevision:revision,capability:permission!.name,locale:_language,platform:platform,consentVersion:'food-transactional-v1',fid:fid),current.key,next),epoch);
   }else{await _rotate(fid,epoch);}
   _check(epoch);_nativeRegistered=_effective!=null;_registeredFid=fid;_registeredLocale=_language;
   if(initial!=null)await _open(initial,epoch,navigate:true);
  }finally{if(_waiter?.value==waiter)_waiter=null;}
 }
 Future<void> _rotate(String fid,int epoch)async{
  _check(epoch);if(!_allowFid||_desiredOwner!=_owner||_pending!=null)return;
  permission=await native.permission();_check(epoch);
  if(![MobilePushPermission.authorized,MobilePushPermission.provisional].contains(permission)){await _disable(epoch,'OS_PERMISSION','denied');return;}
  final current=await _probe(epoch),installation=current.status.installation;
  if(installation is! MobilePushRegistered||!installation.boundToCurrentSession||!installation.consentEnabled){_allowFid=false;_nativeRegistered=false;return;}
  if(_registeredFid==fid&&_registeredLocale==_language&&installation.capability==permission!.name)return;
  await _submit(_PendingPush(_owner!,MobilePushRotate(kind:'ROTATE',idempotencyKey:const Uuid().v4(),expectedRevision:installation.revision,capability:permission!.name,locale:_language,fid:fid),current.key,null),epoch);
  _nativeRegistered=_effective!=null;_registeredFid=fid;_registeredLocale=_language;
 }
 /// Freeze synchronously before queued/native/network work, including a sign-out attempt.
 Future<void> disable({String reason='USER_OPT_OUT'}){
  _epoch++;_allowFid=false;_nativeRegistered=false;_hint=null;_cancelWait();busy=false;_notify();
  // Persist negative intent independently of a prior unresolved network command.
  final owner=_owner;({Object error,StackTrace stack})? persistenceError;
  final persisted=(()async{
   if(!_loaded)await _load();
   // Disposal cancels network work, not an opt-out already issued by this owner.
   if(owner==null||_owner!=owner||api.sessionScope!=owner)throw const MobileApiException('SESSION_CHANGED',409);
   _desiredOwner=null;await _save();
  })().then<void>((_) {},onError:(Object error,StackTrace stack){persistenceError=(error:error,stack:stack);if(_closed)errorCode=_code(error);});
  _intentPersistence=persisted;
  return _run((epoch)async{await persisted;final failure=persistenceError;if(failure!=null)Error.throwWithStackTrace(failure.error,failure.stack);_check(epoch);await _disable(epoch,reason,'unknown');});
 }
 Future<void> _disable(int epoch,String reason,String capability)async{
  _allowFid=false;_nativeRegistered=false;_desiredOwner=null;await _save();_check(epoch);
  try{
   for(var attempt=0;attempt<3;attempt++){
    final current=await _probe(epoch),installation=current.status.installation;
    if(installation is MobilePushRegistered&&!installation.boundToCurrentSession){_pending=null;await _save();return;}
    final revision=switch(installation){MobilePushRegistered(:final revision)=>revision,MobilePushUnregistered()=> '0'};
    try{await _submit(_PendingPush(_owner!,MobilePushDisable(kind:'DISABLE',idempotencyKey:const Uuid().v4(),expectedRevision:revision,capability:capability,locale:_language,reason:reason),current.key,null),epoch);return;}
    on MobileApiException catch(error){_check(epoch);if(error.code!='VERSION_CONFLICT')rethrow;}
   }throw const MobileApiException('VERSION_CONFLICT',409);
  }finally{await native.unregister();await native.clearUpdates();}
 }
 Future<void> openSettings()async{try{await native.openSettings();}catch(error){errorCode=_code(error);_notify();}}
 Future<void> openHint(){final event=_hint;return event==null?Future<void>.value():_run((epoch)=>_open(event,epoch,navigate:true));}
 Future<void> _open(MobilePushEnvelope event,int epoch,{required bool navigate})async{
  _check(epoch);if(_desiredOwner!=_owner||event.app!=app.name.toUpperCase())return;
  final current=await _probe(epoch),installation=current.status.installation;
  if(installation is! MobilePushRegistered||!installation.boundToCurrentSession||!installation.consentEnabled||installation.bindingId!=event.bindingId||installation.generation!=event.generation)return;
  final result=await api.pushOpen(app,event.eventId,MobilePushOpenRequest(bindingId:event.bindingId,bindingGeneration:event.generation),current.key);_check(epoch);
  if(result is MobilePushOpenUnavailable){_hint=null;return;}
  if(navigate){_hint=null;onOpen(result,_owner!);}else{_hint=event;}_notify();
 }
 Future<void> close()async{
  if(_closed)return;_closed=true;_epoch++;_allowFid=false;_cancelWait();WidgetsBinding.instance.removeObserver(this);
  for(final subscription in _subscriptions){await subscription.cancel();}await _intentPersistence;await _tail;await _storageTail;
  try{await native.unregister();}catch(error){errorCode=_code(error);}
  try{await native.clearUpdates();}catch(error){errorCode=_code(error);}
  try{await native.close();}catch(error){errorCode=_code(error);}
  super.dispose();
 }
}
