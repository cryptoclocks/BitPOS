import 'dart:async';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/mobile_push_native.dart';import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/main.dart';
import 'food_owner_test.dart' as food;import 'food_history_test.dart' as fixture;
class PushApi extends food.DeliveryOwnerApi{
 PushOwnerRecord? owner=(accountId:fixture.id(50),sessionId:fixture.id(51));final scopes=StreamController<PushOwnerRecord?>.broadcast(sync:true);
 @override bool get signedIn=>owner!=null;@override PushOwnerRecord? get sessionScope=>owner;@override Stream<PushOwnerRecord?> get sessionScopes=>scopes.stream;
 @override Future<void> restore()async{}@override Future<MobileAccount> account()async=>MobileAccount(id:fixture.id(50),displayName:'Synthetic account',locale:'en');
 @override Future<MobilePushStatus> pushStatus(MobilePushApp app,String installationKey)async=>MobilePushStatus(installation:MobilePushRegistered(kind:'REGISTERED',installationId:fixture.id(87),bindingId:fixture.id(88),revision:'1',generation:'1',boundToCurrentSession:true,consentEnabled:true,capability:'authorized',endpointRegistered:true),endpointEncryptionAvailable:true);
 @override Future<MobilePushOpenResult> pushOpen(MobilePushApp app,String eventId,MobilePushOpenRequest command,String key)async=>MobilePushOpenCustomerOrder(kind:'CUSTOMER_ORDER',orderId:fixture.id(1));
 @override Future<MobileFoodOrder> foodOrder(String id)async=>(await foodEvents(id)).order;
 @override Future<String?> activeFoodOrderId()async=>null;
 @override Future<void> close()async{super.close();await scopes.close();}
}
typedef PushOwnerRecord=({String accountId,String sessionId});
class PushNative implements MobilePushNative{
 final events=StreamController<MobilePushEnvelope>.broadcast(sync:true);@override bool get configured=>false;
 @override Stream<String> get registrations=>const Stream.empty();@override Stream<void> get unregistrations=>const Stream.empty();@override Stream<MobilePushEnvelope> get opened=>events.stream;@override Stream<MobilePushEnvelope> get foreground=>const Stream.empty();
 @override Future<Map<String,dynamic>> environment()async=>{};@override Future<void> clearUpdates()async{}@override Future<void> openSettings()async{}@override Future<MobilePushEnvelope?> initialize()async=>null;@override Future<MobilePushPermission> permission({bool request=false})async=>MobilePushPermission.authorized;@override Future<void> register()async{}@override Future<void> unregister()async{}@override Future<void> close()async{await events.close();}
}
void main(){testWidgets('populated pushed order disappears on logical session loss, not same-owner token rotation',(tester)async{
 // Persisted owner consent permits an opaque open, without configured Firebase or real delivery.
 FlutterSecureStorage.setMockInitialValues({});
 final api=PushApi(),native=PushNative();await api.storage.write(key:'bitpos.privatePush.customer.v1',value:'{"keys":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],"desiredOwner":{"accountId":"${fixture.id(50)}","sessionId":"${fixture.id(51)}"},"pending":null}');
 await tester.pumpWidget(MaterialApp(home:CustomerSessionPage(api:api,pushNative:native)));await tester.pumpAndSettle();
 native.events.add(MobilePushEnvelope(eventId:fixture.id(89),bindingId:fixture.id(88),generation:'1',app:'CUSTOMER'));await tester.pumpAndSettle();
 expect(find.text('Latest order'),findsOneWidget);expect(find.textContaining('Synthetic destination'),findsWidgets);
 api.scopes.add(api.owner);await tester.pumpAndSettle();expect(find.text('Latest order'),findsOneWidget);
 api.owner=null;api.scopes.add(null);await tester.pumpAndSettle();expect(find.text('Latest order'),findsNothing);expect(find.textContaining('Synthetic destination'),findsNothing);
 await tester.pumpWidget(const SizedBox.shrink());await tester.pumpAndSettle();expect(tester.takeException(),isNull);
});}
