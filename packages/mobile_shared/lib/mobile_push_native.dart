import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class MobilePushNativeException implements Exception {
 const MobilePushNativeException(this.code);
 final String code;
 @override String toString()=>code;
}
enum MobilePushPermission {
 notDetermined,denied,authorized,provisional;
 static MobilePushPermission fromSystem(AuthorizationStatus status,{bool? notificationsEnabled,bool? channelEnabled}){
  if(status==AuthorizationStatus.notDetermined)return notDetermined;
  if(status==AuthorizationStatus.denied||notificationsEnabled==false||channelEnabled==false)return denied;
  return status==AuthorizationStatus.provisional?provisional:authorized;
 }
}
class MobilePushEnvelope {
 const MobilePushEnvelope({required this.eventId,required this.bindingId,required this.generation,required this.app});
 final String eventId,bindingId,generation,app;
 static MobilePushEnvelope? parse(Map<String,dynamic> data){
  final eventId=data['eventId'],bindingId=data['bindingId'],generation=data['bindingGeneration'],app=data['app'];
  if(data.length!=4||eventId is! String||bindingId is! String||generation is! String||app is! String)return null;
  final uuid=RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$');
  if(!uuid.hasMatch(eventId)||!uuid.hasMatch(bindingId)||!RegExp(r'^[1-9][0-9]{0,18}$').hasMatch(generation)||!['CUSTOMER','DRIVER'].contains(app))return null;
  return MobilePushEnvelope(eventId:eventId,bindingId:bindingId,generation:generation,app:app);
 }
}
class MobilePushConfiguration {
 const MobilePushConfiguration._(this.options);
 final FirebaseOptions? options;
 static MobilePushConfiguration fromEnvironment(){
  const apiKey=String.fromEnvironment('BITPOS_PUSH_FIREBASE_API_KEY'),appId=String.fromEnvironment('BITPOS_PUSH_FIREBASE_APP_ID'),senderId=String.fromEnvironment('BITPOS_PUSH_FIREBASE_SENDER_ID'),projectId=String.fromEnvironment('BITPOS_PUSH_FIREBASE_PROJECT_ID'),bundleId=String.fromEnvironment('BITPOS_PUSH_FIREBASE_IOS_BUNDLE_ID');
  if([apiKey,appId,senderId,projectId,bundleId].every((value)=>value.isEmpty))return const MobilePushConfiguration._(null);
  if(!RegExp(r'^[0-9]+$').hasMatch(senderId)||!RegExp(r'^AIza[A-Za-z0-9_-]{35}$').hasMatch(apiKey)||!RegExp(r'^1:[0-9]+:(android|ios):[0-9a-f]+$').hasMatch(appId)||!appId.startsWith('1:$senderId:')||!RegExp(r'^[a-z][a-z0-9-]{4,61}[a-z0-9]$').hasMatch(projectId)||(defaultTargetPlatform==TargetPlatform.iOS&&bundleId.isEmpty))throw const MobilePushNativeException('PUSH_CONFIGURATION_INVALID');
  final platform=defaultTargetPlatform==TargetPlatform.android?'android':defaultTargetPlatform==TargetPlatform.iOS?'ios':null;
  if(platform==null||!appId.contains(':$platform:'))throw const MobilePushNativeException('PUSH_PLATFORM_UNAVAILABLE');
  return MobilePushConfiguration._(FirebaseOptions(apiKey:apiKey,appId:appId,messagingSenderId:senderId,projectId:projectId,iosBundleId:bundleId.isEmpty?null:bundleId));
 }
}
abstract interface class MobilePushNative {
 bool get configured;
 Stream<String> get registrations;
 Stream<void> get unregistrations;
 Stream<MobilePushEnvelope> get opened;
 Stream<MobilePushEnvelope> get foreground;
 Future<Map<String,dynamic>> environment();
 Future<void> openSettings();
 Future<void> clearUpdates();
 Future<MobilePushEnvelope?> initialize();
 Future<MobilePushPermission> permission({bool request=false});
 Future<void> register();
 Future<void> unregister();
 Future<void> close();
}
/// No Firebase initialization or registration when configuration is absent. OS display contains generic text only.
class FirebaseMobilePushNative implements MobilePushNative {
 FirebaseMobilePushNative(this.configuration,{required this.app});
 final MobilePushConfiguration configuration;
 final String app;
 FirebaseMessaging? _messaging;
 final _registrations=StreamController<String>.broadcast(),_unregistrations=StreamController<void>.broadcast(),_opened=StreamController<MobilePushEnvelope>.broadcast(),_foreground=StreamController<MobilePushEnvelope>.broadcast();
 final List<StreamSubscription<dynamic>> _subscriptions=[];
 bool _closed=false;
 @override bool get configured=>configuration.options!=null;
 @override Stream<String> get registrations=>_registrations.stream;
 @override Stream<void> get unregistrations=>_unregistrations.stream;
 @override Stream<MobilePushEnvelope> get opened=>_opened.stream;
 @override Stream<MobilePushEnvelope> get foreground=>_foreground.stream;
 static const _channel=MethodChannel('bitpos/mobile_push');
 @override Future<Map<String,dynamic>> environment()async=>Map<String,dynamic>.from(await _channel.invokeMapMethod<String,dynamic>('environment')??(throw const MobilePushNativeException('PUSH_NATIVE_UNAVAILABLE')));
 @override Future<void> openSettings()=>_channel.invokeMethod<void>('openSettings');
 @override Future<void> clearUpdates()=>_channel.invokeMethod<void>('clearUpdates');
 @override Future<MobilePushEnvelope?> initialize()async{
  if(_closed)throw const MobilePushNativeException('PUSH_CLOSED');
  final options=configuration.options;if(options==null)throw const MobilePushNativeException('PUSH_CONFIGURATION_REQUIRED');
  final native=await environment(),android=defaultTargetPlatform==TargetPlatform.android;
  final expected=android?(app=='CUSTOMER'?'com.bitpos.bitpos_customer':'com.bitpos.bitpos_driver'):(app=='CUSTOMER'?'com.bitpos.bitposCustomer':'com.bitpos.bitposDriver');
  if(!['CUSTOMER','DRIVER'].contains(app)||native['applicationId']!=expected||(!android&&options.iosBundleId!=expected))throw const MobilePushNativeException('PUSH_APP_IDENTITY_MISMATCH');
  if(android&&native['playServicesStatus']!=0)throw const MobilePushNativeException('PUSH_PLAY_SERVICES_UNAVAILABLE');
  if(android)await _channel.invokeMethod<void>('ensureUpdateChannel',{'name':PlatformDispatcher.instance.locale.languageCode=='th'?'ข้อมูลอัปเดต BitPOS':'BitPOS updates'});
  if(_messaging!=null)return null;
  try{
   final app=Firebase.apps.isEmpty?await Firebase.initializeApp(options:options):Firebase.app();
   if(app.options.appId!=options.appId||app.options.projectId!=options.projectId)throw const MobilePushNativeException('PUSH_CONFIGURATION_MISMATCH');
   final messaging=FirebaseMessaging.instance;
   await messaging.setAutoInitEnabled(false);
   await messaging.setForegroundNotificationPresentationOptions(alert:false,badge:false,sound:false);
   if(_closed)throw const MobilePushNativeException('PUSH_CLOSED');
   _messaging=messaging;
   _subscriptions.add(messaging.onRegistered.listen((fid){if(!_closed)_registrations.add(fid);},onError:(Object error){if(!_closed)_registrations.addError(const MobilePushNativeException('PUSH_REGISTRATION_UNAVAILABLE'));}));
   _subscriptions.add(messaging.onUnregistered.listen((_){if(!_closed)_unregistrations.add(null);},onError:(Object error){if(!_closed)_unregistrations.addError(const MobilePushNativeException('PUSH_UNREGISTRATION_UNAVAILABLE'));}));
   void emit(RemoteMessage message,StreamController<MobilePushEnvelope> target){final value=MobilePushEnvelope.parse(message.data);if(!_closed&&value!=null)target.add(value);}
   _subscriptions.add(FirebaseMessaging.onMessageOpenedApp.listen((message)=>emit(message,_opened)));
   _subscriptions.add(FirebaseMessaging.onMessage.listen((message)=>emit(message,_foreground)));
   return MobilePushEnvelope.parse((await messaging.getInitialMessage())?.data??{});
  }on MobilePushNativeException{rethrow;}catch(_){throw const MobilePushNativeException('PUSH_NATIVE_UNAVAILABLE');}
 }
 FirebaseMessaging get _ready=>_messaging??(throw const MobilePushNativeException('PUSH_NOT_INITIALIZED'));
 @override Future<MobilePushPermission> permission({bool request=false})async{
  try{final settings=request?await _ready.requestPermission(alert:true,badge:true,sound:true,provisional:false):await _ready.getNotificationSettings();final native=await environment();return MobilePushPermission.fromSystem(settings.authorizationStatus,notificationsEnabled:native['notificationsEnabled'] as bool?,channelEnabled:native['channelEnabled'] as bool?);}catch(_){throw const MobilePushNativeException('PUSH_PERMISSION_UNAVAILABLE');}
 }
 @override Future<void> register()async{
  if(![MobilePushPermission.authorized,MobilePushPermission.provisional].contains(await permission()))throw const MobilePushNativeException('PUSH_PERMISSION_REQUIRED');
  try{
   if(defaultTargetPlatform==TargetPlatform.iOS){
    await _channel.invokeMethod<void>('requestApnsRegistration',{'consent':true});
    String? token;
    for(var attempt=0;attempt<10;attempt++){if(_closed)throw const MobilePushNativeException('PUSH_CLOSED');if((await environment())['apnsFailed']==true)throw const MobilePushNativeException('PUSH_APNS_UNAVAILABLE');token=await _ready.getAPNSToken();if(token!=null)break;await Future<void>.delayed(const Duration(milliseconds:500));}
    if(token==null)throw const MobilePushNativeException('PUSH_APNS_UNAVAILABLE');
   }
   await _ready.register();
  }on MobilePushNativeException{rethrow;}catch(_){throw const MobilePushNativeException('PUSH_REGISTRATION_UNAVAILABLE');}
 }
 @override Future<void> unregister()async{try{if(defaultTargetPlatform==TargetPlatform.iOS)await _channel.invokeMethod<void>('stopApnsRegistration');if(_messaging!=null){await _ready.setAutoInitEnabled(false);await _ready.unregister();}}catch(_){throw const MobilePushNativeException('PUSH_UNREGISTRATION_UNAVAILABLE');}}
 @override Future<void> close()async{_closed=true;for(final subscription in _subscriptions){await subscription.cancel();}await Future.wait([_registrations.close(),_unregistrations.close(),_opened.close(),_foreground.close()]);}
}
