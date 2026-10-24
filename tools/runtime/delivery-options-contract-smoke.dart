import 'dart:convert';
import 'dart:io';
import '../../packages/mobile_shared/lib/mobile_v1.generated.dart';

String id(int n)=>'00000000-0000-4000-8000-${n.toString().padLeft(12,'0')}';
void require(bool condition,String message){if(!condition)throw StateError(message);}
bool rejected(void Function() action){try{action();return false;}on FormatException{return true;}}
void main(){
 final groups=List.generate(10,(g)=><String,dynamic>{'id':id(100+g),'name':'กลุ่ม','nameEn':'Group','enabled':true,'minSelections':20,'maxSelections':20,'choices':List.generate(20,(c)=><String,dynamic>{'id':id(1000+g*20+c),'name':'ตัวเลือก','nameEn':'Choice','enabled':true,'maxQty':1,'priceDelta':{'currency':'USD','decimals':2,'amountMinor':'35'}})});
 final options=MobileProductOptions.fromJson({'version':id(1),'revision':'1','noteEnabled':true,'groups':groups});
 final selections=options.groups.expand((g)=>g.choices.map((c)=><String,dynamic>{'groupId':g.id,'choiceId':c.id,'qty':1})).toList();
 final input=<String,dynamic>{'lineId':id(2),'productId':id(3),'qty':1,'optionVersion':id(1),'selections':selections,'allergyNote':'ไม่ใส่นม\nNo milk'};
 final cart=MobileConfiguredCartItem.fromJson(input);
 require(cart.selections.length==200&&cart.selections.last.choiceId==id(1199),'All supported selections must remain reachable');
 require(cart.allergyNote=='ไม่ใส่นม\nNo milk','Note text must be preserved');
 require(rejected(()=>MobileConfiguredCartItem.fromJson({...input,'lineId':'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'})),'Mixed-case UUID aliases must be refused at the boundary');
 require(rejected(()=>MobileConfiguredCartItem.fromJson({...input,'selections':[...selections,selections.first]})),'Over-cap selection array must be refused');
 require(rejected(()=>MobileConfiguredCartItem.fromJson({...input,'selections':[{...selections.first,'priceDelta':'0'}]})),'Client delta injection must be refused');
 final encoded=cart.toJson();require(encoded['selections'].length==200&&encoded['lineId']==id(2),'Canonical request serialization must not drop supported tuples');
 final receipt={'environment':'deterministic_generated_dart_fixture','assertions':6,'maximumSelectionTuples':200,'canonicalUuidPolicy':'lowercase_hyphenated_rfc_or_nil_max','limits':['Generated Dart parser/serializer only; no UI, GPS, payment or provider evidence'],'physicalTesting':'deferred_by_user_2026-10-16'};
 File('.omp/work/flutter-delivery-20261016/evidence/p1-options-dart-contract.json').writeAsStringSync('${const JsonEncoder.withIndent('  ').convert(receipt)}\n');
 print(jsonEncode(receipt));
}
