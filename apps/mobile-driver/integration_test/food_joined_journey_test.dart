import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/main.dart';
import 'package:bitpos_driver/food_work_page.dart';
import 'package:bitpos_driver/presentation/driver_food_offer_card.dart';
import 'package:bitpos_driver/presentation/driver_food_custody_card.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('same owned food assignment through actual rider root UI', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) throw StateError('Local fixture required');
    const stage = String.fromEnvironment('BITPOS_TEST_DRIVER_STAGE');
    const orderId = String.fromEnvironment('BITPOS_TEST_ORDER_ID');
    const assignmentId = String.fromEnvironment('BITPOS_TEST_ASSIGNMENT_ID');
    expect(['CLAIM', 'PICKUP', 'DELIVERY'], contains(stage));
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))),
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
    });
    final api = MobileApi(base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')), fixture: true);
    addTearDown(api.close);
    await tester.runAsync(api.restore);
    expect(api.signedIn, isTrue);
    addTearDown(() async {
      final session = await api.storage.read(key: 'bitpos.mobileSession');
      if (session != null) {
        await File('${Directory.systemTemp.path}/bitpos-joined-session.json').writeAsString(session, flush: true);
        debugPrint('BITPOS_JOINED_SESSION_EXPORTED');
      }
    });
    // Observe the real transport independently; never inject its data into UI.
    var offerReceived = false;
    final observation = api.watchFoodWork().listen((state) {
      debugPrint('BITPOS_JOINED_DRIVER_STREAM ${state.runtimeType} offers=${state.snapshot?.work.offers.length} assignment=${state.snapshot?.work.assignment?.runtimeType}');
      offerReceived = offerReceived || (state.snapshot?.work.offers.isNotEmpty ?? false);
    });
    addTearDown(observation.cancel);
    Future<void> wait(bool Function() predicate) async {
      for (var n = 0; n < 450 && !predicate(); n++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      }
      expect(predicate(), isTrue, reason: 'Expected current native journey state; visible fixture UI: ${tester.widgetList<Text>(find.byType(Text)).map((text) => text.data).whereType<String>().take(50).join(' | ')}');
    }
    Future<void> tap(Finder finder) async {
      for (var attempt = 0; attempt < 60 && finder.evaluate().isEmpty; attempt++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
        final scrollable = find.descendant(of: find.byType(FoodWorkPage), matching: find.byType(Scrollable));
        if (finder.evaluate().isEmpty && scrollable.evaluate().isNotEmpty) {
          await tester.drag(scrollable.first, const Offset(0, -200));
        }
      }
      await wait(() => finder.evaluate().isNotEmpty);
      await tester.ensureVisible(finder.first);await tester.pump();
      await wait(() {
        final widget = tester.widget(finder.first);
        return widget is! FilledButton || widget.onPressed != null;
      });
      await tester.tap(finder.first);await tester.pump();
    }
    await tester.pumpWidget(MaterialApp(debugShowCheckedModeBanner: false, theme: BitPosTheme.light(), home: DriverSessionPage(api: api)));
    await wait(() => find.text('บัญชี').evaluate().length >= 2);
    await tap(find.text('บัญชี').last);
    await tester.pump(const Duration(seconds: 1));
    await wait(() => find.text('English').evaluate().isNotEmpty);
    await tap(find.text('English'));
    await wait(() => find.byType(NavigationBar).evaluate().isNotEmpty && tester.widget<NavigationBar>(find.byType(NavigationBar)).onDestinationSelected != null);
    await tap(find.text('Work'));
    await wait(() => find.byType(FoodWorkPage).evaluate().isNotEmpty);
    if (stage == 'CLAIM') {
      var offerId = const String.fromEnvironment('BITPOS_TEST_OFFER_ID');
      final initial = await tester.runAsync(api.foodDriverWork);
      if (initial!.assignment case final FoodDriverAssignment recovered) {
        expect(recovered.id, assignmentId);
        expect(recovered.orderId, orderId);
        expect(recovered.state, anyOf('ACCEPTED', 'AT_PICKUP'));
      } else {
      await tap(find.widgetWithText(FilledButton, 'View your offers'));
      await wait(() => find.text('No current offers').evaluate().isNotEmpty);
      debugPrint('BITPOS_JOINED_DRIVER_READY');
      await wait(() => offerReceived);
      // Offers are lazy ListView children below the route panel; reveal them as
      // a user would, rather than waiting for an offscreen widget to build.
      await tester.scrollUntilVisible(
        find.byType(DriverFoodOfferCard),
        250,
        scrollable: find.descendant(of: find.byType(FoodWorkPage), matching: find.byType(Scrollable)).first,
        maxScrolls: 40,
      );
      await wait(() => find.byType(DriverFoodOfferCard).evaluate().isNotEmpty);
      final offers = await tester.runAsync(api.foodDriverWork);
      expect(offers!.offers, hasLength(1));
      offerId = offers.offers.single.id;
      await tap(find.descendant(of: find.byKey(ValueKey('food-offer.$offerId')), matching: find.widgetWithText(FilledButton, 'Accept this offer')));
      }
      final claimed = await tester.runAsync(api.foodDriverWork);
      expect(claimed!.assignment, isA<FoodDriverAssignment>());
      expect((claimed.assignment as FoodDriverAssignment).orderId, orderId);
      if ((claimed.assignment as FoodDriverAssignment).state == 'ACCEPTED') {
      // Offer acceptance leaves the lazy work list scrolled below navigation.
      // Return to the top before looking for the newly mounted arrival card.
      final workScroll = find.descendant(of: find.byType(FoodWorkPage), matching: find.byType(Scrollable)).first;
      tester.state<ScrollableState>(workScroll).position.jumpTo(0);
      await tester.pump();
      await tap(find.widgetWithText(FilledButton, 'Arrived at store'));
      }
      // After arrival the rider screen first shows the job details; custody needs "Continue navigation".
      for (var n = 0; n < 30 && find.byType(DriverFoodCustodyCard).evaluate().isEmpty; n++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      }
      if (find.byType(DriverFoodCustodyCard).evaluate().isEmpty) {
        await tap(find.byKey(const ValueKey('food-assigned-continue-navigation')));
      }
      await wait(() => find.byType(DriverFoodCustodyCard).evaluate().isNotEmpty);
      final work = await tester.runAsync(api.foodDriverWork);
      final assignment = work!.assignment as FoodDriverAssignment;
      expect(assignment.orderId, orderId);expect(assignment.state, 'AT_PICKUP');
      await File('${Directory.systemTemp.path}/bitpos-joined-driver.json').writeAsString(jsonEncode({'assignmentId': assignment.id, 'offerId': offerId}), flush: true);
    } else {
      final work = await tester.runAsync(api.foodDriverWork);
      final assignment = work!.assignment as FoodDriverAssignment;
      expect(assignment.id, assignmentId);expect(assignment.orderId, orderId);
      final pickup = stage == 'PICKUP';
      expect(assignment.state, pickup ? anyOf('AT_PICKUP', 'PICKED_UP', 'AT_DROPOFF') : 'AT_DROPOFF');
      final secret = pickup ? const String.fromEnvironment('BITPOS_TEST_PICKUP_SECRET') : const String.fromEnvironment('BITPOS_TEST_DELIVERY_SECRET');
      expect(secret.length, 43);
      if (!pickup || assignment.state == 'AT_PICKUP') {
      await tap(find.byKey(ValueKey('food-custody-${pickup ? 'PICKUP' : 'DELIVERY'}')));
      final input = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField));
      await wait(() => input.evaluate().isNotEmpty);
      await tester.enterText(input, secret);
      await tap(find.widgetWithText(FilledButton, 'Confirm'));
      await wait(() => find.byType(AlertDialog).evaluate().isEmpty);
      }
      if (pickup) {
        if (assignment.state != 'AT_DROPOFF') {
          final workScroll = find.descendant(of: find.byType(FoodWorkPage), matching: find.byType(Scrollable)).first;
          tester.state<ScrollableState>(workScroll).position.jumpTo(0);
          await tester.pump();
          await tap(find.widgetWithText(FilledButton, 'Arrived at destination'));
        }
        // After arrival the rider screen first shows the job details; custody needs "Continue navigation".
        for (var n = 0; n < 30 && find.byType(DriverFoodCustodyCard).evaluate().isEmpty; n++) {
          await tester.pump(const Duration(milliseconds: 100));
          await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
        }
        if (find.byType(DriverFoodCustodyCard).evaluate().isEmpty) {
          await tap(find.byKey(const ValueKey('food-assigned-continue-navigation')));
        }
        await wait(() => find.byType(DriverFoodCustodyCard).evaluate().isNotEmpty);
        final current = (await tester.runAsync(api.foodDriverWork))!.assignment as FoodDriverAssignment;
        expect(current.id, assignmentId);expect(current.state, 'AT_DROPOFF');
      } else {
        await wait(() => find.byKey(const ValueKey('food-delivery-confirmed')).evaluate().isNotEmpty);
        final current = await tester.runAsync(api.foodDriverWork);expect(current!.assignment, isNull);
      }
    }
    expect(await api.pendingFoodDispatch(), isNull);
    expect(tester.takeException(), isNull);
    debugPrint('BITPOS_JOINED_DRIVER_${stage}_PASS');
  });
}
