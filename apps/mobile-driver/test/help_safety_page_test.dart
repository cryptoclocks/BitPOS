import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/support_mutation.dart';
import 'package:mobile_shared/support_page.dart';
import 'package:bitpos_driver/help_safety_page.dart';

import 'driver_earnings_surface_test.dart' show EarningsApi;

class HelpApi extends EarningsApi {
  SupportMutation? submitted;
  @override
  Future<SupportMutation?> pendingSupportMutation() async => null;
  @override
  Future<MobileSupportCases> supportCases({String? cursor}) async =>
      MobileSupportCases(items: [], nextCursor: null);
  @override
  Future<void> submitSupportMutation(SupportMutation mutation) async {
    submitted = mutation;
  }
}

void main() {
  testWidgets(
    'rider earnings enquiry uses shared durable support with no forged customer order',
    (tester) async {
      final api = HelpApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(home: DriverHelpSafetyPage(api: api, thai: false)),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('does not contact emergency services'),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(
        find.text('Earnings and payouts'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Earnings and payouts'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byType(TextField).last,
        'Please review my payout status',
      );
      await tester.ensureVisible(find.text('Send request / message'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Send request / message'));
      await tester.pumpAndSettle();
      final sent = api.submitted as CreateSupportMutation;
      expect(sent.command.subject, 'Earnings and payouts');
      expect(sent.command.order, isNull);
    },
  );
  testWidgets('session retirement closes help and nested support', (
    tester,
  ) async {
    final api = HelpApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => DriverHelpSafetyPage(api: api, thai: false),
                ),
              ),
              child: const Text('Open help'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open help'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Contact support'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Contact support'));
    await tester.pumpAndSettle();
    api.change(null);
    await tester.pumpAndSettle();
    expect(find.byType(SupportPage), findsNothing);
    expect(find.byType(DriverHelpSafetyPage), findsNothing);
    expect(find.text('Open help'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
