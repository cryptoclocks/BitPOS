import 'dart:async';
import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/mobile_v1.generated.dart';import 'package:bitpos_driver/earnings_page.dart';
const first='00000000-0000-4000-8000-000000000088',second='00000000-0000-4000-8000-000000000089';
const asset={'assetId':'usdc-devnet','symbol':'USDC','displayLabel':'USDC devnet','cluster':'devnet','genesisHash':'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','mint':'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU','tokenProgram':'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','decimals':6,'instructionPolicy':'spl_checked','issuerTestAsset':true};
SettlementDriverPage page({String id=first,String state='AVAILABLE',String? next=second,String? readiness,String settlementState='RESERVED',bool confirmed=false,String at='2026-10-19T01:00:00.000Z'})=>SettlementDriverPage.fromJson({'kind':'DRIVER_EARNINGS','driverId':first,'items':[{'accrualId':id,'driverId':first,'merchantId':first,'orderId':id,'assignmentId':id,'state':state,'version':'2','availableAt':at,'createdAt':at,'money':{'amountMinor':'100','currency':'USD','decimals':2},'payout':{'status':'FROZEN_POLICY_AVAILABLE','payoutMoney':{'amountMinor':'1000000','currency':'USDC','decimals':6},'asset':asset},'eligibilityDecision':null,'settlement':readiness==null?null:{'batchId':first,'state':settlementState,'version':'2','beneficiaryId':first,'beneficiaryVersion':'2','attemptState':confirmed?'CONFIRMED':null,'receiptId':confirmed?second:null,'confirmedAt':confirmed?at:null,'money':{'amountMinor':'100','currency':'USD','decimals':2},'payoutMoney':{'amountMinor':'1000000','currency':'USDC','decimals':6},'asset':asset,'readiness':readiness,'outwardReady':confirmed}}],'nextAfterId':next,'beneficiaries':[],'beneficiaryHistoryLimit':50,'snapshotAt':at,'availabilityIsLiquidity':false});
SettlementDriverPage twoEarnings({String secondCurrency='USD'}) {
 final raw=page(readiness:'PROVIDER_UNAVAILABLE').toJson();
 final original=Map<String,dynamic>.from((raw['items'] as List).single as Map);
 final additional=Map<String,dynamic>.from(original);
 additional['accrualId']=second;additional['orderId']=second;additional['assignmentId']=second;
 additional['state']='RESERVED';additional['settlement']=null;
 additional['money']={'amountMinor':'270','currency':secondCurrency,'decimals':2};
 raw['items']=[original,additional];
 return SettlementDriverPage.fromJson(raw);
}
class EarningsApi extends MobileApi{
 EarningsApi({super.fixture=true}):super(base:Uri.parse('https://example.invalid/api/mobile/v1/'));
 ({String accountId,String sessionId})? owner=(accountId:first,sessionId:first);
 final owners=StreamController<({String accountId,String sessionId})?>.broadcast(sync:true);
 SettlementDriverPage current=page();Completer<SettlementDriverPage>? pending;
 @override bool get signedIn=>owner!=null;
 @override ({String accountId,String sessionId})? get sessionScope=>owner;
 @override Stream<({String accountId,String sessionId})?> get sessionScopes=>owners.stream;
 @override Future<SettlementDriverPage> driverEarnings({String? afterId})=>pending?.future??Future.value(current);
 void change(({String accountId,String sessionId})? value){owner=value;owners.add(value);}
 @override void close(){unawaited(owners.close());super.close();}
}
Future<void> mount(WidgetTester tester,EarningsApi api,{bool thai=false})async{
 tester.view.physicalSize=const Size(800,2800);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);addTearDown(api.close);
 await tester.pumpWidget(MaterialApp(home:DriverEarningsPage(api:api,thai:thai)));await tester.pumpAndSettle();
}
void main(){
 testWidgets('R16 sums only a single denomination and distinguishes earning states',(tester)async{
  final api=EarningsApi()..current=twoEarnings();await mount(tester,api);
  final summary=find.byKey(const ValueKey('driver-earnings-summary'));
  expect(find.descendant(of:summary,matching:find.text('3.70 USD')),findsOneWidget);
  expect(find.text('Eligible 1'),findsOneWidget);
  expect(find.text('Reserved 1'),findsOneWidget);
  expect(find.textContaining('not withdrawable or transferred funds'),findsOneWidget);
 });
 testWidgets('R16 shows separate denominations without a synthetic combined total',(tester)async{
  final api=EarningsApi()..current=twoEarnings(secondCurrency:'THB');await mount(tester,api);
  final summary=find.byKey(const ValueKey('driver-earnings-summary'));
  expect(find.descendant(of:summary,matching:find.text('2')),findsOneWidget);
  expect(find.descendant(of:summary,matching:find.text('3.70 USD')),findsNothing);
  expect(find.text('1.00 USD'),findsWidgets);
  expect(find.text('2.70 THB'),findsWidgets);
  expect(find.textContaining('Mixed denominations'),findsOneWidget);
 });
 testWidgets('R18 never substitutes a different batch after paging and back returns to R17',(tester)async{
  final api=EarningsApi()..current=page(readiness:'PROVIDER_UNAVAILABLE');await mount(tester,api);
  await tester.tap(find.text('Payouts'));await tester.pumpAndSettle();
  await tester.tap(find.text('Referenced payout round'));await tester.pumpAndSettle();
  final raw=page(id:second,readiness:'PROVIDER_UNAVAILABLE',next:null).toJson();
  final replacement=Map<String,dynamic>.from((raw['items'] as List).single as Map);
  final settlement=Map<String,dynamic>.from(replacement['settlement'] as Map);
  settlement['batchId']=second;replacement['settlement']=settlement;raw['items']=[replacement];
  api.current=SettlementDriverPage.fromJson(raw);
  await tester.ensureVisible(find.text('Next page'));
  await tester.tap(find.text('Next page'));await tester.pumpAndSettle();
  expect(find.textContaining('The selected round is not in this loaded page'),findsOneWidget);
  expect(find.text('Earnings referencing this round'),findsNothing);
  await tester.tap(find.text('Back to payouts'));await tester.pumpAndSettle();
  expect(find.text('Payout rounds in loaded entries'),findsOneWidget);
  await tester.tap(find.text('Referenced payout round'));await tester.pumpAndSettle();
  expect(find.text('Earnings referencing this round'),findsOneWidget);
  await tester.tap(find.text('Statement'));await tester.pumpAndSettle();
  expect(find.text('Earnings referencing this round'),findsOneWidget,reason:'Selecting the active statement tab must retain the chosen round');
  await tester.tap(find.byTooltip('Back'));await tester.pumpAndSettle();
  expect(find.text('Payout rounds in loaded entries'),findsOneWidget);
 });
 testWidgets('phone Thai large-text earning exposes full references on explicit expand',(tester)async{
  await tester.binding.setSurfaceSize(const Size(320,900));addTearDown(()=>tester.binding.setSurfaceSize(null));
  final api=EarningsApi();addTearDown(api.close);
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:const TextScaler.linear(1.5)),child:DriverEarningsPage(api:api,thai:true)))));await tester.pumpAndSettle();
  final details=find.text('รายละเอียดรายการรายได้');
  await tester.scrollUntilVisible(details,200,scrollable:find.byType(Scrollable).first);await tester.ensureVisible(details);await tester.pumpAndSettle();
  expect(find.text('ออร์เดอร์: $first'),findsNothing);
  await tester.tap(details);await tester.pumpAndSettle();
  await tester.scrollUntilVisible(find.text('ออร์เดอร์: $first'),150,scrollable:find.byType(Scrollable).first);
  expect(find.text('ออร์เดอร์: $first'),findsOneWidget);
  expect(find.text('งานส่ง: $first'),findsOneWidget);
  expect(tester.takeException(),isNull);
 });
 for(final replacement in <({String accountId,String sessionId})?>[null,(accountId:second,sessionId:second),(accountId:first,sessionId:second)]){
  testWidgets('owner change $replacement clears old and delayed private facts immediately',(tester)async{
   final api=EarningsApi();await mount(tester,api);await tester.tap(find.text('Earning reference details'));await tester.pumpAndSettle();expect(find.text('Order: $first'),findsOneWidget);
   api.change(api.owner);await tester.pump();expect(find.byKey(const ValueKey('driver-earnings-retired')),findsNothing,reason:'A same-session access refresh must not retire financial facts');
   final held=Completer<SettlementDriverPage>();api.pending=held;await tester.ensureVisible(find.text('Next page'));await tester.tap(find.text('Next page'));await tester.pump();
   api.change(replacement);await tester.pump();expect(find.text('Order: $first'),findsNothing);expect(find.byKey(const ValueKey('driver-earnings-retired')),findsOneWidget);
   held.complete(page(id:second,next:null));await tester.pumpAndSettle();expect(find.text('Order: $second'),findsNothing);expect(tester.takeException(),isNull);
  });
 }
 for(final thai in [false,true]){
  testWidgets('page replacement does not relabel old states as a newer snapshot thai=$thai',(tester)async{
   final api=EarningsApi();await mount(tester,api,thai:thai);final oldLabel=thai?'ผ่านเกณฑ์การจ่าย — ไม่ใช่เงินโอนแล้ว':'Eligible — not transferred';expect(find.text(oldLabel),findsOneWidget);
   api.current=page(id:second,state:'SETTLED',next:null,at:'2026-10-19T02:00:00.000Z');await tester.ensureVisible(find.text(thai?'หน้าถัดไป':'Next page'));await tester.tap(find.text(thai?'หน้าถัดไป':'Next page'));await tester.pumpAndSettle();
   expect(find.text(oldLabel),findsNothing);expect(find.text('${thai?'ออร์เดอร์':'Order'}: $first'),findsNothing);await tester.tap(find.text(thai?'รายละเอียดรายการรายได้':'Earning reference details'));await tester.pumpAndSettle();expect(find.text('${thai?'ออร์เดอร์':'Order'}: $second'),findsOneWidget);
   expect(find.text(thai?'ยืนยันการจ่ายขั้นสุดท้ายแล้ว':'Finalized verified settlement'),findsOneWidget);expect(find.textContaining(thai?'ทีละหน้า':'One observed page at a time'),findsOneWidget);
  });
  for(final entry in <String,(String,String)>{'PROVIDER_UNAVAILABLE':('ผู้ให้บริการยังไม่พร้อม','Provider unavailable'),'VERIFIED_FUNDING_REQUIRED':('ต้องมีเงินทุนที่ตรวจสอบแล้ว','Verified funding required'),'FUNDING_RECONCILIATION_REQUIRED':('ต้องตรวจสอบกระทบยอดเงินทุน','Funding reconciliation required'),'SOURCE_RECONCILIATION_REQUIRED':('ต้องตรวจสอบผลจ่ายเดิมที่ขัดแย้ง','Source reconciliation required')}.entries){
   testWidgets('${entry.key} has actionable payout explanation thai=$thai',(tester)async{
    final api=EarningsApi()..current=page(readiness:entry.key);await mount(tester,api,thai:thai);await tester.tap(find.text(thai?'รอบจ่าย':'Payouts'));await tester.pumpAndSettle();
    expect(find.textContaining(thai?entry.value.$1:entry.value.$2),findsOneWidget);expect(find.textContaining(entry.key),findsNothing);expect(find.textContaining(thai?'ยังไม่มีหลักฐานการโอนขั้นสุดท้าย':'No finalized transfer receipt'),findsOneWidget);
   });
  }
 }
  testWidgets('payout opens a truthful embedded-reference statement', (tester) async {
   final api=EarningsApi()..current=page(readiness:'PROVIDER_UNAVAILABLE');
   await mount(tester,api);
   await tester.tap(find.text('Payouts'));await tester.pumpAndSettle();
   await tester.tap(find.text('Referenced payout round'));await tester.pumpAndSettle();
   expect(find.text('Payout statement'),findsWidgets);
   expect(find.text('Earnings referencing this round'),findsOneWidget);
   expect(find.textContaining('Only server-returned references'),findsOneWidget);
   expect(find.textContaining('not withdrawable or transferred funds'),findsOneWidget);
  });
  testWidgets('earnings surface renders dark at 390 and two columns at 1440',(tester)async{
   final api=EarningsApi();
   addTearDown(api.close);
   await tester.binding.setSurfaceSize(const Size(390,844));
   addTearDown(()=>tester.binding.setSurfaceSize(null));
   await tester.pumpWidget(MaterialApp(theme:ThemeData.dark(),home:DriverEarningsPage(api:api,thai:true)));
   await tester.pumpAndSettle();
   expect(find.text('รายได้ของคุณ'),findsOneWidget);
   expect(tester.takeException(),isNull);
   await tester.binding.setSurfaceSize(const Size(1440,900));
   await tester.pumpAndSettle();
   expect(find.text('รายการรายได้'),findsOneWidget);
   expect(tester.takeException(),isNull);
  });
  testWidgets('non-fixture devnet asset identity remains visible through earning payout and statement',(tester)async{
   final api=EarningsApi(fixture:false)..current=page(readiness:'READY_FOR_INITIAL_BROADCAST',settlementState:'CONFIRMED',confirmed:true);
   await mount(tester,api);
   expect(find.textContaining('USDC devnet · devnet · Test asset'),findsOneWidget);
   expect(find.textContaining('LOCAL / AVD FIXTURE'),findsNothing);
   await tester.tap(find.text('Payouts'));await tester.pumpAndSettle();
   expect(find.textContaining('USDC devnet · devnet · Test asset'),findsOneWidget);
   expect(find.text('Verified receipt: $second'),findsOneWidget);
   await tester.tap(find.text('Referenced payout round'));await tester.pumpAndSettle();
   expect(find.textContaining('USDC devnet · devnet · Test asset'),findsWidgets);
   expect(find.text('Verified receipt: $second'),findsOneWidget);
  });
  for(final thai in [false,true]){
   testWidgets('primary navigation keeps complete labels and selects pages at narrow large text thai=$thai',(tester)async{
    final api=EarningsApi();addTearDown(api.close);
    await tester.binding.setSurfaceSize(const Size(320,900));addTearDown(()=>tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:const TextScaler.linear(1.5)),child:DriverEarningsPage(api:api,thai:thai)))));
    await tester.pumpAndSettle();
    final payout=thai?'รอบจ่าย':'Payouts',statement=thai?'รายละเอียด':'Statement';
    expect(find.text(payout),findsOneWidget);expect(find.text(statement),findsOneWidget);
    await tester.tap(find.text(payout));await tester.pumpAndSettle();expect(find.text(thai?'รอบโอนเงิน':'Payouts'),findsWidgets);
    await tester.tap(find.text(statement));await tester.pumpAndSettle();expect(find.text(thai?'รายละเอียดรอบโอน':'Payout statement'),findsWidgets);
    expect(tester.takeException(),isNull);
    await tester.binding.setSurfaceSize(const Size(390,844));
    await tester.pumpWidget(MaterialApp(home:DriverEarningsPage(api:api,thai:thai)));
    await tester.pumpAndSettle();
    expect(find.text(payout),findsOneWidget);expect(find.text(statement),findsOneWidget);
    await tester.tap(find.text(statement));await tester.pumpAndSettle();
    expect(find.text(thai?'รายละเอียดรอบโอน':'Payout statement'),findsWidgets);
    expect(tester.takeException(),isNull);
   });
  }
}
