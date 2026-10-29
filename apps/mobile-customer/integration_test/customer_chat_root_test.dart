import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:bitpos_customer/food_page.dart';

import '../test/food_history_test.dart' as history_fixture;
import '../test/food_root_navigation_test.dart' show RootChatApi;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('U29 customer order tracking opens the FigCraft chat grid', (
    tester,
  ) async {
    final api = RootChatApi();
    addTearDown(api.close);
    final navigation = FoodPageNavigation();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          body: SingleChildScrollView(
            child: FoodPage(
              api: api,
              thai: false,
              navigation: navigation,
              onAuthenticationRequired: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final history = navigation.showOrders();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    await tester.tap(
      find.byKey(ValueKey('customer-order-card.${history_fixture.id(1)}')),
    );
    await tester.pumpAndSettle();
    await history;
    await tester.ensureVisible(find.text('Track delivery'));
    await tester.tap(find.text('Track delivery'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Chat with rider'));
    await tester.tap(find.text('Chat with rider'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('food-chat-assignment-header')),
      findsOneWidget,
    );
    expect(
      find.textContaining('Rider fixture: order received.'),
      findsOneWidget,
    );
    expect(find.textContaining('Thank you.'), findsOneWidget);
    final riderBubble = tester.getRect(
      find
          .ancestor(
            of: find.textContaining('Rider fixture: order received.'),
            matching: find.byType(Container),
          )
          .first,
    );
    final customerBubble = tester.getRect(
      find
          .ancestor(
            of: find.textContaining('Thank you.'),
            matching: find.byType(Container),
          )
          .first,
    );
    final messageTime = tester.getRect(find.text('09:49'));
    final header = tester.getRect(
      find.byKey(const ValueKey('food-chat-assignment-header')),
    );
    final backButton = tester.getRect(
      find.byKey(const ValueKey('food-chat-back-visual')),
    );
    final chatTitle = tester.getRect(find.text('Chat with rider'));
    final field = tester.getRect(
      find.descendant(
        of: find.byKey(const ValueKey('food-chat-composer')),
        matching: find.byType(TextField),
      ),
    );
    final send = tester.getRect(find.byTooltip('Send message'));
    debugPrint(
      'BITPOS_U29_ROOT_AVD_GEOMETRY:${backButton.toString()},${chatTitle.toString()},${header.toString()},${field.toString()},${send.toString()}',
    );
    debugPrint(
      'BITPOS_U29_MESSAGE_GEOMETRY:${riderBubble.toString()},${customerBubble.toString()},${messageTime.toString()}',
    );
    debugPrint('BITPOS_U29_ROOT_AVD_VISIBLE');
    expect(header.left, closeTo(24, 1));
    expect(header.top, closeTo(132, 1));
    expect(header.width, closeTo(342, 1));
    expect(header.height, closeTo(82, 1));
    expect(backButton.left, closeTo(18, 1));
    expect(backButton.top, closeTo(52, 1));
    expect(backButton.width, closeTo(44, 1));
    expect(backButton.height, closeTo(44, 1));
    expect(chatTitle.left, closeTo(76, 1));
    expect(field.left, closeTo(24, 1));
    expect(field.top, closeTo(651, 1));
    expect(field.width, closeTo(282, 1));
    expect(field.height, closeTo(52, 1));
    expect(send.left, closeTo(320, 1));
    expect(send.top, closeTo(651, 1));
    expect(send.width, closeTo(46, 1));
    expect(send.height, closeTo(52, 1));
    expect(riderBubble.left, closeTo(24, 1));
    expect(riderBubble.top, closeTo(246, 1));
    expect(riderBubble.width, closeTo(277, 1));
    expect(riderBubble.height, closeTo(78, 1));
    expect(customerBubble.right, closeTo(366, 1));
    expect(customerBubble.top, closeTo(354, 1));
    expect(customerBubble.height, closeTo(77, 1));
    expect(messageTime.left, closeTo(24, 1));
    expect(messageTime.top, closeTo(468, 1));
    await tester.pump(const Duration(seconds: 2));
    expect(tester.takeException(), isNull);
  });
}
