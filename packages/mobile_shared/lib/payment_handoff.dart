import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/services.dart';
import 'mobile_api.dart';

/// Opens the existing scoped checkout, which owns payment-attempt journaling.
/// Navigation and wallet callbacks never mutate payment state in the app.
class PaymentHandoff {
 PaymentHandoff({required this.fixture,required this.destinationOrigin});
 final bool fixture;
 final String destinationOrigin;
 static const _sourceOrigin='https://pay.cashlessthailand.com';
 Uri destination(String capability){
  final source=Uri.tryParse(capability);
  if(source==null||source.scheme!='https'||!source.hasAuthority||source.origin!=_sourceOrigin||source.hasQuery||source.hasFragment||source.userInfo.isNotEmpty||!RegExp(r'^/pay/[A-Za-z0-9_-]{43}$').hasMatch(source.path)){
   throw const MobileApiException('PAYMENT_DESTINATION_INVALID',503);
  }
  final target=Uri.tryParse(destinationOrigin);
  if(target==null||!['https','http'].contains(target.scheme)||!target.hasAuthority||target.userInfo.isNotEmpty||target.hasQuery||target.hasFragment||!(target.path.isEmpty||target.path=='/')){
   throw const MobileApiException('PAYMENT_CONFIGURATION_REQUIRED',503);
  }
  if(fixture){
   if(target.scheme!='http'||!['127.0.0.1','localhost','10.0.2.2'].contains(target.host)||target.port!=4321){
    throw const MobileApiException('PAYMENT_CONFIGURATION_REQUIRED',503);
   }
  }else if(target.origin!=_sourceOrigin){
   throw const MobileApiException('PAYMENT_CONFIGURATION_REQUIRED',503);
  }
  return target.replace(path:source.path);
 }
 Future<void> open(String capability) async {
  final target=destination(capability);
  try{
   if(!await launchUrl(target,mode:LaunchMode.externalApplication)){
    throw const MobileApiException('PAYMENT_APP_UNAVAILABLE',503);
   }
  }on PlatformException{
   throw const MobileApiException('PAYMENT_APP_UNAVAILABLE',503);
  }
 }
}
