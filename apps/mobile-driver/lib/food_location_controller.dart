import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

const foodDriverAuthorityDenials=<String>{'DRIVER_SUSPENDED','DRIVER_VERIFICATION_REQUIRED','DRIVER_DOCUMENT_EXPIRED','DRIVER_UNAVAILABLE','INCIDENT'};

/// Native location callbacks, not a simulated route. Android foreground service
/// and iOS background location continue only while this explicit assignment owns
/// the stream. Server fences remain authoritative after suspension/disconnect.
class FoodLocationController extends ChangeNotifier {
 FoodLocationController(this.api);final MobileApi api;
 StreamSubscription<Position>? _positions;StreamSubscription<ServiceStatus>? _service;
 // Detaching callbacks fences uploads; only native cancellation confirms capture
 // stopped. Repeated lifecycle/SSE stops must not erase a failed cancellation.
 Future<void>? _stopping;bool _stopUnconfirmed=false;
 FoodDriverAssignment? _assignment;BigInt _sequence=BigInt.zero;int _epoch=0;bool _sending=false,_disposed=false;
 DateTime? _lastAttempt;DateTime? lastReceivedAt;DateTime? lastCapturedAt;String? error;bool sharing=false;bool? backgroundAuthorized;bool? serviceEnabled;int _permissionIntent=0;
 bool get acknowledgedFixStale {final captured=lastCapturedAt,received=lastReceivedAt;if(captured==null||received==null)return true;final now=DateTime.now();return now.difference(captured)>const Duration(seconds:30)||now.difference(received)>const Duration(seconds:30);}
 void _notify(){if(!_disposed)notifyListeners();}
 Future<void> start(FoodDriverAssignment assignment) async {
  final teardown=stop();final epoch=_epoch;await teardown;if(epoch!=_epoch||_disposed)return;
  if(_stopUnconfirmed)throw const MobileApiException('LOCATION_STOP_UNCONFIRMED',409);
  if(!await Geolocator.isLocationServiceEnabled())throw const MobileApiException('LOCATION_SERVICE_DISABLED',409);
  var permission=await Geolocator.checkPermission();if(permission==LocationPermission.denied)permission=await Geolocator.requestPermission();
  if(permission==LocationPermission.denied||permission==LocationPermission.deniedForever)throw MobileApiException(permission==LocationPermission.deniedForever?'LOCATION_PERMISSION_SETTINGS_REQUIRED':'LOCATION_PERMISSION_DENIED',403);
  if(epoch!=_epoch||_disposed)return;
  final tracking=await api.foodTracking(assignment.shipmentId),fence=tracking.assignment;
  if(fence==null||fence.assignmentId!=assignment.id||fence.generation!=assignment.generation||fence.leaseGeneration!=assignment.leaseGeneration)throw const MobileApiException('ASSIGNMENT_CHANGED',409);
  if(epoch!=_epoch||_disposed)return;
  _assignment=assignment;_sequence=BigInt.parse(fence.location?.sequence??'0');lastReceivedAt=fence.location==null?null:DateTime.parse(fence.location!.receivedAt);lastCapturedAt=fence.location==null?null:DateTime.parse(fence.location!.capturedAt);
  backgroundAuthorized=permission==LocationPermission.always;serviceEnabled=true;error=null;sharing=true;
  final LocationSettings settings=switch(defaultTargetPlatform){
   // Android's native location manager also works without Google Play Services.
   TargetPlatform.android=>AndroidSettings(forceLocationManager:true,accuracy:LocationAccuracy.high,distanceFilter:5,intervalDuration:const Duration(seconds:5),foregroundNotificationConfig:const ForegroundNotificationConfig(notificationTitle:'BitPOS assigned delivery location',notificationText:'Sharing with assigned participants. Open BitPOS Driver to stop.',notificationChannelName:'Assigned delivery tracking',enableWakeLock:true,setOngoing:true)),
   TargetPlatform.iOS||TargetPlatform.macOS=>AppleSettings(accuracy:LocationAccuracy.bestForNavigation,distanceFilter:5,activityType:ActivityType.automotiveNavigation,pauseLocationUpdatesAutomatically:false,showBackgroundLocationIndicator:true,allowBackgroundLocationUpdates:true),
   _=>const LocationSettings(accuracy:LocationAccuracy.high,distanceFilter:5),
  };
  _positions=Geolocator.getPositionStream(locationSettings:settings).listen((position){unawaited(_upload(position,epoch));},onError:(Object failure){if(epoch!=_epoch)return;error=failure.toString();_notify();unawaited(stop(preserveError:true));});
  _service=Geolocator.getServiceStatusStream().listen((status){if(epoch!=_epoch)return;if(status==ServiceStatus.disabled){error='LOCATION_SERVICE_DISABLED';_notify();unawaited(stop(preserveError:true));}});_notify();
 }
 Future<void> _upload(Position position,int epoch) async {
  final assignment=_assignment,now=DateTime.now();if(epoch!=_epoch||assignment==null||_sending||!sharing)return;
  if(_lastAttempt!=null&&now.difference(_lastAttempt!)<const Duration(seconds:5))return;
  if(!position.accuracy.isFinite||position.accuracy<0||position.accuracy>100||!position.latitude.isFinite||!position.longitude.isFinite){error='LOCATION_ACCURACY_UNAVAILABLE';_notify();return;}
  if(lastCapturedAt!=null&&!position.timestamp.isAfter(lastCapturedAt!))return;
  _sending=true;_lastAttempt=now;final next=_sequence+BigInt.one;
  final command=FoodLocationCommand(generation:assignment.generation,leaseGeneration:assignment.leaseGeneration,sequence:next.toString(),capturedAt:position.timestamp.toUtc().toIso8601String(),latitudeE7:(position.latitude*10000000).round(),longitudeE7:(position.longitude*10000000).round(),accuracyMm:(position.accuracy*1000).round(),headingMdeg:position.heading.isFinite&&position.heading>=0?(position.heading*1000).round()%360000:null,speedMmS:position.speed.isFinite&&position.speed>=0?math.min((position.speed*1000).round(),100000):null);
  try{
   final result=await api.uploadFoodLocation(assignment.id,command);if(epoch!=_epoch)return;
   _sequence=next;lastCapturedAt=position.timestamp;lastReceivedAt=DateTime.parse(result.receivedAt);error=null;
  }on MobileApiException catch(failure){
   if(epoch!=_epoch)return;error=failure.code;
   if(foodDriverAuthorityDenials.contains(failure.code)||['ASSIGNMENT_CHANGED','RESOURCE_NOT_FOUND','AUTH_REQUIRED','SESSION_EXPIRED'].contains(failure.code)){await stop(preserveError:true);}
   else if(failure.code=='LOCATION_SEQUENCE_CONFLICT'){await _recoverSequence(assignment,epoch);}
  }catch(failure){if(epoch==_epoch){error='LOCATION_UPLOAD_UNCONFIRMED';
   // The HTTP result may have been lost. Recover the authoritative sequence
   // before accepting another native sample rather than overwriting seqN.
   await _recoverSequence(assignment,epoch);
  }}finally{if(epoch==_epoch){_sending=false;_notify();}}
 }
 Future<void> _recoverSequence(FoodDriverAssignment assignment,int epoch) async {
  try{final latest=await api.foodTracking(assignment.shipmentId);if(epoch!=_epoch)return;
   final active=latest.assignment;if(active==null||active.assignmentId!=assignment.id||active.generation!=assignment.generation||active.leaseGeneration!=assignment.leaseGeneration){await stop(preserveError:true);return;}
   _sequence=BigInt.parse(active.location?.sequence??'0');lastCapturedAt=active.location==null?null:DateTime.parse(active.location!.capturedAt);
  }catch(_){if(epoch==_epoch)await stop(preserveError:true);}
 }
 Future<void> refreshPermissions() async {final epoch=_epoch,intent=++_permissionIntent;backgroundAuthorized=null;serviceEnabled=null;_notify();
  try{final enabled=await Geolocator.isLocationServiceEnabled(),permission=await Geolocator.checkPermission();if(epoch!=_epoch||intent!=_permissionIntent||_disposed)return;serviceEnabled=enabled;backgroundAuthorized=permission==LocationPermission.always;_notify();}catch(_){if(epoch==_epoch&&intent==_permissionIntent)_notify();}
 }
 Future<void> stop({bool preserveError=false}) {
  ++_epoch;_permissionIntent++;
  final pending=_stopping;if(pending!=null)return pending;
  final positions=_positions,service=_service;_positions=null;_service=null;
  final completion=Completer<void>();_stopping=completion.future;
  sharing=false;_assignment=null;_sending=false;_lastAttempt=null;lastCapturedAt=null;lastReceivedAt=null;backgroundAuthorized=null;serviceEnabled=null;
  if(!_stopUnconfirmed&&!preserveError)error=null;_notify();
  unawaited(()async{
   try{await Future.wait<void>([if(positions!=null)positions.cancel(),if(service!=null)service.cancel()]);}
   catch(_){_stopUnconfirmed=true;error='LOCATION_STOP_UNCONFIRMED';_notify();}
   finally{_stopping=null;completion.complete();}
  }());
  return completion.future;
 }
 @override void dispose(){_disposed=true;unawaited(stop());super.dispose();}
}
