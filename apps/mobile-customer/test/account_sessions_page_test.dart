import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/mobile_v1.generated.dart';import 'package:bitpos_customer/account_sessions_page.dart';
const one='00000000-0000-4000-8000-000000000001',two='00000000-0000-4000-8000-000000000002';
class SessionsApi extends MobileApi{
 SessionsApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 bool removed=false,loseResponse=false;int revokes=0;
 @override Future<MobileAccountSessions> accountSessions({String? cursor})async=>MobileAccountSessions(sessions:[MobileAccountSession(id:one,current:true,createdAt:'2026-10-20T00:00:00Z',expiresAt:'2026-10-21T00:00:00Z'),if(!removed)MobileAccountSession(id:two,current:false,createdAt:'2026-10-19T00:00:00Z',expiresAt:'2026-10-21T00:00:00Z')],nextCursor:null);
 @override Future<MobileSessionRevoked> revokeAccountSession(String sessionId)async{expect(sessionId,two);revokes++;removed=true;if(loseResponse)throw const MobileApiException('RESPONSE_UNAVAILABLE',503);return MobileSessionRevoked(sessionId:sessionId,revoked:true);}
}
void main(){
 testWidgets('other session revokes once and current session has no revoke action',(tester)async{
  final api=SessionsApi(),owner=ValueNotifier(true);addTearDown(api.close);addTearDown(owner.dispose);
  await tester.pumpWidget(MaterialApp(home:AccountSessionsPage(api:api,owner:owner,thai:false,onAuthenticationRequired:(){})));await tester.pumpAndSettle();
  expect(find.text('Current session'),findsOneWidget);expect(find.text('Revoke session'),findsOneWidget);
  await tester.tap(find.text('Revoke session'));await tester.pumpAndSettle();expect(api.revokes,1);expect(find.text('Other session'),findsNothing);
 });
 testWidgets('lost revoke response retains uncertainty until real refresh',(tester)async{
  final api=SessionsApi()..loseResponse=true,owner=ValueNotifier(true);addTearDown(api.close);addTearDown(owner.dispose);
  await tester.pumpWidget(MaterialApp(home:AccountSessionsPage(api:api,owner:owner,thai:false,onAuthenticationRequired:(){})));await tester.pumpAndSettle();await tester.tap(find.text('Revoke session'));await tester.pumpAndSettle();
  expect(find.text('Other session'),findsOneWidget);expect(find.textContaining('Request did not complete.'),findsOneWidget);
  await tester.tap(find.text('Refresh'));await tester.pumpAndSettle();expect(find.text('Other session'),findsNothing);expect(api.revokes,1);
 });
 testWidgets('owner retirement removes private session route',(tester)async{
  final api=SessionsApi(),owner=ValueNotifier(true);addTearDown(api.close);addTearDown(owner.dispose);
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()=>Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>AccountSessionsPage(api:api,owner:owner,thai:false,onAuthenticationRequired:(){}))),child:const Text('Open sessions'))))));
  await tester.tap(find.text('Open sessions'));await tester.pumpAndSettle();owner.value=false;await tester.pumpAndSettle();expect(find.text('Current session'),findsNothing);expect(find.text('Open sessions'),findsOneWidget);
 });
}
