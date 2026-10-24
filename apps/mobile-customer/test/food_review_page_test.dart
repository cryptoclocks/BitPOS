import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/review_mutation.dart';
import 'package:bitpos_customer/food_review_page.dart';

const order = '00000000-0000-4000-8000-000000000041';

class ReviewApi extends MobileApi {
  ReviewApi({bool eligible = true})
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true) {
    snapshot = MobileFoodReviewSnapshot(
      orderId: order,
      eligible: eligible,
      canRateDriver: false,
      review: null,
    );
  }
  late MobileFoodReviewSnapshot snapshot;
  Completer<MobileFoodReviewSnapshot>? delayed;
  ReviewMutation? submitted;
  @override
  Future<ReviewMutation?> pendingReviewMutation() async => null;
  @override
  Future<MobileFoodReviewSnapshot> foodReview(String orderId) async =>
      delayed == null ? snapshot : await delayed!.future;
  @override
  Future<MobileFoodReview> submitReviewMutation(ReviewMutation mutation) async {
    submitted = mutation;
    final r = MobileFoodReview(
      id: '00000000-0000-4000-8000-000000000042',
      orderId: order,
      stars: mutation.command.stars!,
      driverStars: null,
      body: mutation.command.body,
      state: 'PENDING',
      version: '1',
      feedback: '',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
    );
    snapshot = MobileFoodReviewSnapshot(
      orderId: order,
      eligible: true,
      canRateDriver: false,
      review: r,
    );
    return r;
  }
}

void main() {
  testWidgets(
    'phone viewport scrolls through meal rating and explicit review submit',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final api = ReviewApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: FoodReviewPage(
            api: api,
            orderId: order,
            thai: false,
            owner: null,
            onAuthenticationRequired: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byTooltip('4 / 5'),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byTooltip('4 / 5'));
      await tester.pump();
      await tester.scrollUntilVisible(
        find.byType(TextField),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.enterText(find.byType(TextField), 'Phone viewport review');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Submit review'),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Submit review'));
      await tester.pumpAndSettle();
      expect(api.submitted?.command.stars, 4);
      expect(api.submitted?.command.body, 'Phone viewport review');
      await tester.scrollUntilVisible(
        find.text('Awaiting moderation'),
        -150,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Published'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('ineligible meal cannot receive stars or a submitted review', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final api = ReviewApi(eligible: false);
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: FoodReviewPage(
          api: api,
          orderId: order,
          thai: false,
          owner: null,
          onAuthenticationRequired: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('Reviews open after your meal is complete'),
      findsOneWidget,
    );
    await tester.tap(find.byTooltip('4 / 5'));
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Submit review'),
          )
          .onPressed,
      isNull,
    );
    expect(api.submitted, isNull);
  });
  testWidgets(
    'review requires explicit stars and submission remains pending moderation',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final api = ReviewApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: FoodReviewPage(
            api: api,
            orderId: order,
            thai: false,
            owner: null,
            onAuthenticationRequired: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Submit review'),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byTooltip('4 / 5'));
      await tester.enterText(find.byType(TextField), 'Meal review');
      await tester.ensureVisible(find.text('Submit review'));
      await tester.tap(find.text('Submit review'));
      await tester.pumpAndSettle();
      expect(api.submitted!.command.stars, 4);
      expect(api.submitted!.command.expectedVersion, '0');
      expect(api.submitted!.command.body, 'Meal review');
      expect(find.text('Awaiting moderation'), findsOneWidget);
      expect(find.text('Published'), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Update review'),
            )
            .onPressed,
        isNull,
      );
      await tester.enterText(find.byType(TextField), 'Edited meal review');
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Update review'),
            )
            .onPressed,
        isNotNull,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'server-eligible delivered order opens U21 review and receipt actions',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final api = ReviewApi();
      addTearDown(api.close);
      var receipt = 0, selected = -1;
      await tester.pumpWidget(
        MaterialApp(
          home: FoodReviewPage(
            api: api,
            orderId: order,
            thai: false,
            owner: null,
            onAuthenticationRequired: () {},
            deliveryCompleteScreen: true,
            orderTotal: MobileMoney(
              currency: 'THB',
              decimals: 2,
              amountMinor: '20500',
            ),
            onViewReceipt: () => receipt++,
            onNavigationSelected: (value) => selected = value,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Enjoy your meal'), findsOneWidget);
      expect(find.textContaining('205.00'), findsOneWidget);
      expect(find.text('Delivered to you'), findsOneWidget);
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        1,
      );
      await tester.tap(find.text('Orders'));
      expect(selected, 1);
      await tester.tap(find.byTooltip('4 / 5'));
      await tester.enterText(find.byType(TextField), 'Delivered review');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Submit review'));
      await tester.tap(find.text('Submit review'));
      await tester.pumpAndSettle();
      expect(api.submitted?.command.stars, 4);
      expect(api.submitted?.command.body, 'Delivered review');
      await tester.ensureVisible(find.text('View receipt'));
      await tester.tap(find.text('View receipt'));
      expect(receipt, 1);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('late review response cannot reopen a retired owner route', (
    tester,
  ) async {
    final api = ReviewApi()..delayed = Completer<MobileFoodReviewSnapshot>();
    addTearDown(api.close);
    final owner = ValueNotifier(true);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => FoodReviewPage(
                    api: api,
                    orderId: order,
                    thai: false,
                    owner: owner,
                    onAuthenticationRequired: () {},
                  ),
                ),
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    owner.value = false;
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    api.delayed!.complete(api.snapshot);
    await tester.pump();
    expect(find.byType(FoodReviewPage), findsNothing);
    expect(find.text('Open'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
