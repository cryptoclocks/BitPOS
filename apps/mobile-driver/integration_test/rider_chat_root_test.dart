import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/food_work_page.dart';

import '../test/food_chat_route_test.dart' as route_fixture;
import '../test/food_realtime_lifecycle_test.dart' as work_fixture;

class RiderRootChatApi extends route_fixture.ChatWorkApi {
  @override
  Future<FoodChatPage> foodChat(
    String assignmentId, {
    String afterSequence = '0',
    String? beforeSequence,
  }) async => FoodChatPage(
    assignmentId: assignmentId,
    myRole: 'DRIVER',
    items: [
      FoodChatMessage(
        attachments: const [],
        id: work_fixture.third,
        assignmentId: assignmentId,
        commandId: work_fixture.third,
        sequence: '1',
        senderRole: 'CUSTOMER',
        mine: false,
        body: 'Rider fixture: order received.\nETA about 10 minutes.',
        createdAt: '2026-10-20T02:49:00Z',
      ),
      FoodChatMessage(
        attachments: const [],
        id: '44444444-4444-4444-8444-444444444444',
        assignmentId: assignmentId,
        commandId: '55555555-5555-4555-8555-555555555555',
        sequence: '2',
        senderRole: 'DRIVER',
        mine: true,
        body: 'Thank you.\nPlease leave it by the door.',
        createdAt: '2026-10-20T02:49:00Z',
      ),
    ],
    nextAfterSequence: null,
    nextBeforeSequence: null,
    latestSequence: '2',
  );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('R19 opens chat from the current rider assignment', (
    tester,
  ) async {
    final previous = GeolocatorPlatform.instance;
    final native = work_fixture.ActiveNative();
    GeolocatorPlatform.instance = native;
    addTearDown(() {
      native.close();
      GeolocatorPlatform.instance = previous;
    });
    final api = RiderRootChatApi();
    addTearDown(api.close);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: FoodWorkPage(api: api, thai: false),
      ),
    );
    await tester.pumpAndSettle();
    final openChat = find.text('Chat with customer');
    await tester.scrollUntilVisible(
      openChat,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(openChat.hitTestable());
    await tester.pumpAndSettle();

    for (
      var i = 0;
      i < 100 &&
          find.textContaining('Rider fixture: order received.').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    expect(find.text('Work'), findsOneWidget);
    expect(find.text('History'), findsOneWidget);
    expect(find.text('Earnings'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    expect(
      find.textContaining('Rider fixture: order received.'),
      findsOneWidget,
    );
    expect(find.textContaining('Thank you.'), findsOneWidget);
    final inbound = tester.getRect(
      find
          .ancestor(
            of: find.textContaining('Rider fixture: order received.'),
            matching: find.byType(Container),
          )
          .first,
    );
    final outbound = tester.getRect(
      find
          .ancestor(
            of: find.textContaining('Thank you.'),
            matching: find.byType(Container),
          )
          .first,
    );
    final composer = tester.getRect(
      find.descendant(
        of: find.byKey(const ValueKey('food-chat-composer')),
        matching: find.byType(TextField),
      ),
    );
    expect(inbound.left, closeTo(24, 1));
    expect(inbound.top, closeTo(246, 1));
    expect(inbound.width, closeTo(277, 1));
    expect(inbound.height, closeTo(78, 1));
    expect(outbound.right, closeTo(366, 1));
    expect(outbound.top, closeTo(354, 1));
    expect(outbound.height, closeTo(77, 1));
    expect(composer.left, closeTo(24, 1));
    expect(composer.top, closeTo(651, 1));
    expect(composer.width, closeTo(282, 1));
    expect(composer.height, closeTo(52, 1));
    debugPrint(
      'BITPOS_R19_ROOT_GEOMETRY:${inbound.toString()},${outbound.toString()},${composer.toString()}',
    );
    debugPrint('BITPOS_R19_ROOT_AVD_VISIBLE');
    await tester.pump(const Duration(seconds: 2));
    expect(tester.takeException(), isNull);
  });
}
