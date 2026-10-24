import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';

class ObservedApi extends MobileApi {
 ObservedApi(FlutterSecureStorage storage):super(base:Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),fixture:true,storage:storage);
 final first=Completer<FoodCustomerRealtimeSnapshot>(),recovered=Completer<FoodCustomerRealtimeSnapshot>();
 bool disconnected=false;int snapshots=0;
 @override Stream<FoodRealtimeState<FoodCustomerRealtimeSnapshot>> watchFoodDelivery(String orderId)=>super.watchFoodDelivery(orderId).map((state){
  if(state is FoodRealtimeDisconnected&&first.isCompleted)disconnected=true;
  final value=state.snapshot;
  if(value!=null){snapshots++;if(!first.isCompleted)first.complete(value);if(disconnected&&!recovered.isCompleted)recovered.complete(value);}
  return state;
 });
}
void main(){
 final binding=IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('actual API restart clears tracking then recovers same persisted shipment',(tester) async {
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit local fixture required');
  const orderId=String.fromEnvironment('BITPOS_TEST_ORDER_ID');
  if(!RegExp(r'^[0-9a-f-]{36}$').hasMatch(orderId))throw StateError('Fixture order required');
  final storage=FlutterSecureStorage(aOptions:AndroidOptions(storageNamespace:'bitpos_realtime_fixture_${DateTime.now().microsecondsSinceEpoch}'));
  final api=ObservedApi(storage);await api.restore();await api.verifyOtp('+66900000001','123456');
  try{
   await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:FoodDeliveryPage(api:api,orderId:orderId,thai:false,onAuthenticationRequired:()=>throw StateError('Unexpected fixture auth loss'))));
   Future<void> until(bool Function() ready) async {final deadline=DateTime.now().add(const Duration(seconds:40));while(!ready()&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}expect(ready(),true);}
   await until(()=>api.first.isCompleted);await tester.pumpAndSettle();final before=await api.first.future;
   expect(find.text('Shipment: ${before.work.state}'),findsOneWidget);
   // Host runner observes this non-secret marker and restarts only its own API.
   debugPrint('BITPOS_REALTIME_RESTART_READY');
   await until(()=>api.disconnected);await tester.pumpAndSettle();
   expect(find.text('Shipment: ${before.work.state}'),findsNothing);
   expect(find.text('No current confirmed snapshot'),findsOneWidget);
   debugPrint('BITPOS_REALTIME_UI_CLEARED');
   await until(()=>api.recovered.isCompleted);await tester.pumpAndSettle();final after=await api.recovered.future;
   expect(api.disconnected,true);expect(after.work.shipmentId,before.work.shipmentId);expect(after.work.state,before.work.state);
   expect(find.text('Shipment: ${after.work.state}'),findsOneWidget);
   final receipt={'status':'PASS_BOUNDED_AVD_REAL_API_RESTART','fixture':true,'orderId':orderId,'shipmentId':after.work.shipmentId,'state':after.work.state,'liveSnapshots':api.snapshots,'transportDisconnectedObserved':api.disconnected,'uiSnapshotCleared':true,'isolatedStorageNamespace':true,'physicalTesting':'deferred_by_user_2026-10-16','limits':['Terminal assignment-free shipment; active location/proof removal covered separately','No actual map/provider/GPS or physical evidence','Fixture authentication only; no SMS/payment/payout','Not complete platform or full fidelity acceptance']};
   binding.reportData=receipt;
   await File('${Directory.systemTemp.path}/bitpos-realtime069.json').writeAsString(jsonEncode(receipt),flush:true);
   debugPrint('BITPOS_REALTIME_RECOVERED');
   await tester.pump(const Duration(seconds:2));
  }finally{
   await tester.pumpWidget(const MaterialApp(home:SizedBox()));await tester.pumpAndSettle();
   if(api.signedIn)await api.logout();api.close();await storage.deleteAll();
  }
 });
}
