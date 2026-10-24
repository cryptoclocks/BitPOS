import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

/// Private discovery is opt-in and never shares the assignment GPS stream/epoch.
/// Caller must stop this controller before accepting an assignment or going offline.
class FoodIdleLocationController extends ChangeNotifier {
 FoodIdleLocationController(this.api);
 final MobileApi api;
 StreamSubscription<Position>? _positions;
 StreamSubscription<ServiceStatus>? _services;
 Timer? _consentDeadline;DateTime? _expiresAt;
 int _epoch=0;bool _disposed=false,_sending=false;
 String? _revision;BigInt _sequence=BigInt.zero;
 DateTime? _lastAttempt,lastCapturedAt,lastReceivedAt;
 FoodDiscoveryLocationCommand? _unconfirmed;
 bool sharing=false;String? error;
 void _notify(){if(!_disposed)notifyListeners();}
 Future<void> start(String revision) async {
  final teardown=stop(),epoch=_epoch;await teardown;if(_disposed||epoch!=_epoch)return;
  if(!await Geolocator.isLocationServiceEnabled())throw const MobileApiException('LOCATION_SERVICE_DISABLED',409);
  var permission=await Geolocator.checkPermission();if(permission==LocationPermission.denied)permission=await Geolocator.requestPermission();
  if(permission==LocationPermission.denied||permission==LocationPermission.deniedForever)throw MobileApiException(permission==LocationPermission.deniedForever?'LOCATION_PERMISSION_SETTINGS_REQUIRED':'LOCATION_PERMISSION_DENIED',403);
  if(_disposed||epoch!=_epoch)return;
  final snapshot=await api.foodDiscovery();if(_disposed||epoch!=_epoch)return;final consent=snapshot.consent;
  if(consent==null||!consent.enabled||!consent.ownedBySession||consent.revision!=revision||!DateTime.parse(consent.expiresAt).isAfter(DateTime.now()))throw const MobileApiException('ASSIGNMENT_CHANGED',409);
  _revision=revision;_sequence=BigInt.parse(consent.location?.sequence??'0');lastCapturedAt=consent.location==null?null:DateTime.parse(consent.location!.capturedAt);lastReceivedAt=consent.location==null?null:DateTime.parse(consent.location!.receivedAt);
  _expiresAt=DateTime.parse(consent.expiresAt);_consentDeadline=Timer(_expiresAt!.difference(DateTime.now()),(){if(epoch==_epoch){error='LOCATION_CONSENT_EXPIRED';unawaited(stop(preserveError:true));}});
  sharing=true;error=null;
  final LocationSettings settings=switch(defaultTargetPlatform){
   TargetPlatform.android=>AndroidSettings(forceLocationManager:true,accuracy:LocationAccuracy.high,distanceFilter:5,intervalDuration:const Duration(seconds:10),foregroundNotificationConfig:const ForegroundNotificationConfig(notificationTitle:'BitPOS private food matching location',notificationText:'Opted-in matching only. Open BitPOS Driver to stop.',notificationChannelName:'Private food matching',enableWakeLock:true,setOngoing:true)),
   TargetPlatform.iOS||TargetPlatform.macOS=>AppleSettings(accuracy:LocationAccuracy.bestForNavigation,distanceFilter:5,activityType:ActivityType.automotiveNavigation,pauseLocationUpdatesAutomatically:false,showBackgroundLocationIndicator:true,allowBackgroundLocationUpdates:true),
   _=>const LocationSettings(accuracy:LocationAccuracy.high,distanceFilter:5),
  };
  _positions=Geolocator.getPositionStream(locationSettings:settings).listen((position)=>unawaited(_upload(position,epoch)),onError:(Object failure){if(epoch==_epoch){error='LOCATION_CAPTURE_UNAVAILABLE';unawaited(stop(preserveError:true));}});
  _services=Geolocator.getServiceStatusStream().listen((status){if(epoch==_epoch&&status==ServiceStatus.disabled){error='LOCATION_SERVICE_DISABLED';unawaited(stop(preserveError:true));}},onError:(Object failure){if(epoch==_epoch){error='LOCATION_SERVICE_UNAVAILABLE';unawaited(stop(preserveError:true));}});_notify();
 }
 Future<void> _upload(Position point,int epoch) async {
  if(epoch!=_epoch||!sharing||_sending)return;final now=DateTime.now();if(_lastAttempt!=null&&now.difference(_lastAttempt!)<const Duration(seconds:10))return;
  if(_expiresAt==null||!now.isBefore(_expiresAt!)){error='LOCATION_CONSENT_EXPIRED';await stop(preserveError:true);return;}
  if(!point.latitude.isFinite||!point.longitude.isFinite||!point.accuracy.isFinite||point.accuracy<0||point.accuracy>100){error='LOCATION_ACCURACY_UNAVAILABLE';_notify();return;}
  if(_unconfirmed==null&&lastCapturedAt!=null&&!point.timestamp.isAfter(lastCapturedAt!))return;
  final command=_unconfirmed??FoodDiscoveryLocationCommand(revision:_revision!,sequence:(_sequence+BigInt.one).toString(),capturedAt:point.timestamp.toUtc().toIso8601String(),latitudeE7:(point.latitude*10000000).round(),longitudeE7:(point.longitude*10000000).round(),accuracyMm:(point.accuracy*1000).round());
  _sending=true;_lastAttempt=now;_unconfirmed=command;
  try{final receipt=await api.uploadFoodIdleLocation(command);if(epoch!=_epoch)return;_sequence=BigInt.parse(receipt.sequence);lastCapturedAt=DateTime.parse(command.capturedAt);lastReceivedAt=DateTime.parse(receipt.receivedAt);_unconfirmed=null;error=null;}
  on MobileApiException catch(failure){if(epoch!=_epoch)return;error=failure.code;if(!['LOCATION_RATE_LIMITED'].contains(failure.code)){await stop(preserveError:true);}}
  catch(_){if(epoch==_epoch)error='LOCATION_UPLOAD_UNCONFIRMED';}
  finally{if(epoch==_epoch){_sending=false;_notify();}}
 }
 Future<void> stop({bool preserveError=false}) async {
  _consentDeadline?.cancel();_consentDeadline=null;_expiresAt=null;
  final epoch=++_epoch;final positions=_positions,services=_services;_positions=null;_services=null;sharing=false;_revision=null;_sequence=BigInt.zero;_sending=false;_lastAttempt=null;_unconfirmed=null;lastCapturedAt=null;lastReceivedAt=null;if(!preserveError)error=null;_notify();
  try{await Future.wait<void>([if(positions!=null)positions.cancel(),if(services!=null)services.cancel()]);}
  catch(_){if(epoch==_epoch){error='LOCATION_STOP_UNCONFIRMED';_notify();}}
 }
 @override void dispose(){_disposed=true;unawaited(stop());super.dispose();}
}
