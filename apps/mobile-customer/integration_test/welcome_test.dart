import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/main.dart';
void main(){IntegrationTestWidgetsFlutterBinding.ensureInitialized();testWidgets('native root welcome language and explicit sign-in entry',(tester)async{
 if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Local fixture only');
 FlutterSecureStorage.setMockInitialValues({});
 final api=MobileApi(base:Uri.parse('http://10.0.2.2:3041/api/mobile/v1/'),fixture:true);
 await tester.pumpWidget(MaterialApp(debugShowCheckedModeBanner:false,theme:BitPosTheme.light(),home:CustomerSessionPage(api:api)));
 for(var n=0;n<100&&find.byKey(const ValueKey('customer-welcome-start')).evaluate().isEmpty;n++){await tester.pump();await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:100)));}
 expect(find.byKey(const ValueKey('customer-welcome-start')),findsOneWidget);await tester.pumpAndSettle();
 final imageContext=tester.element(find.byKey(const ValueKey('customer-welcome-start')));
 await tester.runAsync(()async{await precacheImage(const AssetImage('assets/design/bitpos-logo.png'),imageContext);await precacheImage(const AssetImage('assets/design/welcome-coffee.jpg'),imageContext);});
 await tester.pump();await tester.pump(const Duration(milliseconds:100));
 debugPrint('BITPOS_WELCOME_ROOT_VISIBLE');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:2)));
 await tester.tap(find.text('English'));await tester.pumpAndSettle();expect(find.text('Good food, at your pace'),findsOneWidget);
 final start=find.byKey(const ValueKey('customer-welcome-start'));await tester.ensureVisible(start);await tester.tap(start);await tester.pumpAndSettle();
 expect(find.text('Welcome back'),findsOneWidget);expect(find.byType(TextFormField),findsOneWidget);
 debugPrint('BITPOS_LOGIN_ROOT_VISIBLE');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:2)));
 expect(tester.takeException(),isNull);await tester.pumpWidget(const SizedBox.shrink());await tester.pumpAndSettle();
});}
