import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/presentation/bitpos_connection.dart';

void main() {
  testWidgets('calm banner appears when the server is unreachable and leaves when reachable', (tester) async {
    var reachable = false;
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
      client: MockClient((request) async {
        if (!reachable) throw http.ClientException('offline', request.url);
        return http.Response('{"error":{"code":"RESOURCE_NOT_FOUND"}}', 404);
      }),
    );
    addTearDown(api.close);
    BitPosConnection.useApi(api);
    addTearDown(() => BitPosConnection.useApi(null));
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => BitPosConnectionHost(child: child),
        home: const Scaffold(body: Text('page')),
      ),
    );
    expect(find.byKey(const ValueKey('bitpos-connection-banner')), findsNothing);
    await tester.runAsync(api.probe);
    await tester.pump();
    expect(find.byKey(const ValueKey('bitpos-connection-banner')), findsOneWidget);
    expect(find.text('page'), findsOneWidget);
    reachable = true;
    await tester.runAsync(api.probe);
    await tester.pump();
    expect(find.byKey(const ValueKey('bitpos-connection-banner')), findsNothing);
    expect(api.reconnects.value, 1);
  });
}
