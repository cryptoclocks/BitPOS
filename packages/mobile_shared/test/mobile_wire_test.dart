import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

void main() {
 final decoders=<String,Map<String,dynamic> Function(Map<String,dynamic>)>{
  'MobileMoney':(json)=>MobileMoney.fromJson(json).toJson(),
  'MobileFoodQuoteRequest':(json)=>MobileFoodQuoteRequest.fromJson(json).toJson(),
  'MobileBranches':(json)=>MobileBranches.fromJson(json).toJson(),
  'MobileMenu':(json)=>MobileMenu.fromJson(json).toJson(),
  'FoodMerchantRider':(json)=>FoodMerchantRider.fromJson(json).toJson(),
  'FoodMerchantAssignment':(json)=>FoodMerchantAssignment.fromJson(json).toJson(),
  'FoodPreparationEstimate':(json)=>FoodPreparationEstimate.fromJson(json).toJson(),
  'FoodMerchantAcceptanceCommand':(json)=>FoodMerchantAcceptanceCommand.fromJson(json).toJson(),
 };
 final fixtures=jsonDecode(File('../openapi/fixtures/mobile-wire.json').readAsStringSync()) as Map<String,dynamic>;
 for(final raw in fixtures['cases'] as List) {
  final fixture=raw as Map<String,dynamic>;
  test('mobile wire: ${fixture['name']}',(){
   final decode=decoders[fixture['model']]!;
   final value=fixture['value'] as Map<String,dynamic>;
   if(fixture['valid'] as bool) {
    expect(decode(value),value,reason:'Nested fields and string minor units survive decoding');
   } else {
    expect(()=>decode(value),throwsFormatException);
   }
  });
 }
}
