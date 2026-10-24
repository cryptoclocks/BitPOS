import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/account_mutation.dart';
import 'package:bitpos_customer/account_page.dart';

class AccountOwnerApi extends MobileApi {
 AccountOwnerApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 final result=Completer<MobileProfile>();
 @override Future<AccountMutation?> pendingAccountMutation() async=>null;
 @override Future<MobileProfile> profile()=>result.future;
 @override Future<MobileAddresses> addresses({String? cursor}) async=>MobileAddresses(addresses:[],nextCursor:null);
}
void main(){
 testWidgets('account route invalidated before mounting is removed',(tester) async {
  final api=AccountOwnerApi();addTearDown(api.close);
  final owner=ValueNotifier(true);addTearDown(owner.dispose);
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:(){
   Navigator.of(context).push(MaterialPageRoute<void>(builder:(context)=>AccountPage(api:api,owner:owner,thai:false,onAuthenticationRequired:(){})));
   owner.value=false;
  },child:const Text('Open account'))))));
  await tester.tap(find.text('Open account'));await tester.pump();await tester.pump(const Duration(milliseconds:400));
  expect(find.byType(AccountPage),findsNothing);
  expect(find.text('Open account'),findsOneWidget);
  expect(tester.takeException(),isNull);
 });
 for(final invalidateBeforeResponse in [true,false]){
  testWidgets('owned account route closes on invalidation before response=$invalidateBeforeResponse',(tester) async {
   final api=AccountOwnerApi();addTearDown(api.close);
   final owner=ValueNotifier(true);addTearDown(owner.dispose);
   await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()=>Navigator.of(context).push(MaterialPageRoute<void>(builder:(context)=>AccountPage(api:api,owner:owner,thai:false,onAuthenticationRequired:(){}))),child:const Text('Open account'))))));
   await tester.tap(find.text('Open account'));await tester.pump();await tester.pump(const Duration(milliseconds:400));
   if(invalidateBeforeResponse)owner.value=false;
   api.result.complete(MobileProfile(id:'00000000-0000-4000-8000-000000000001',displayName:'Private A fixture',locale:'en',version:'1'));
   await tester.pump();await tester.pump(const Duration(milliseconds:400));
   if(!invalidateBeforeResponse){expect(find.text('Private A fixture'),findsOneWidget);owner.value=false;await tester.pump();await tester.pump(const Duration(milliseconds:400));}
   expect(find.byType(AccountPage),findsNothing);
   expect(find.text('Private A fixture'),findsNothing);
   expect(find.text('Open account'),findsOneWidget);
   expect(tester.takeException(),isNull);
  });
 }
}
