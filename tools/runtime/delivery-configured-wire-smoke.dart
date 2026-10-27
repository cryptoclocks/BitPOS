import 'dart:convert';
import 'dart:io';
import '../../packages/mobile_shared/lib/mobile_v1.generated.dart';
void require(bool condition,String message){if(!condition)throw StateError(message);}
void main(List<String> args){
 if(args.length!=1)throw ArgumentError('Pass JSON emitted by delivery-configured-size-smoke.ts');
 final bytes=File(args.single).readAsBytesSync();final value=jsonDecode(utf8.decode(bytes)) as Map<String,dynamic>;
 final request=MobileFoodQuoteRequest.fromJson(value['request']);
 final snapshot=MobileConfiguredFoodSnapshot.fromJson(value['snapshot']);
 final product=MobileProduct.fromJson(value['product']);
 final note=List.filled(300,'ค').join(),name=List.filled(320,'ง').join(),nameEn=List.filled(160,'😁').join(),groupName=List.filled(80,'ก').join(),choiceNameEn=List.filled(40,'🧋').join();
 require(request.items.length==50&&request.items.every((i)=>i.selections.length==200),'Configured request lost selections');
 require(snapshot.lines.length==50&&snapshot.lines.every((l)=>l.selections.length==200),'Snapshot lost frozen selections');
 for(final line in snapshot.lines){require(line.allergyNote==note,'Allergy note altered');require(line.name==name&&line.nameEn==nameEn,'Unicode product name altered');require(line.selections.every((s)=>s.groupName==groupName&&s.choiceNameEn==choiceNameEn),'Unicode option label altered');require(line.lineTotal.amountMinor=='7270','Exact line money changed');}
 require(snapshot.total.amountMinor=='363500','Payable total changed');require(product.options.groups.length==10&&product.options.groups.every((g)=>g.choices.length==20),'Rich product choices lost');
 final receipt={'environment':'native_dart_generated_contract_fixture','assertions':7,'wireBytes':bytes.length,'configuredLines':snapshot.lines.length,'frozenSelections':snapshot.lines.fold<int>(0,(n,l)=>n+l.selections.length),'exactTotalMinor':snapshot.total.amountMinor,'physicalTesting':'deferred_by_user_2026-10-16','limits':['Actual Dart decoding of maximum-count Unicode generated JSON, not mobile HTTP streaming or AVD memory/latency evidence']};
 File('.omp/work/flutter-delivery-20261016/evidence/p1-configured-native-wire.json').writeAsStringSync('${const JsonEncoder.withIndent('  ').convert(receipt)}\n');stdout.writeln(jsonEncode(receipt));
}
