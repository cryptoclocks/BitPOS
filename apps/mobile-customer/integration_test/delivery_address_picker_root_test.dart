import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/delivery_address_picker_page.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/presentation/food_product_card.dart';
import 'package:bitpos_customer/presentation/merchant_branch_card.dart';
import 'package:bitpos_customer/presentation/saved_address_card.dart';

import '../test/notification_owner_test.dart' show PushNative;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('root delivery address create edit archive and selection flow', (
    tester,
  ) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
      throw StateError('Local fixture only');
    }
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': utf8.decode(
        base64Decode(
          const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'),
        ),
      ),
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
    });
    final preflight = MobileApi(
      base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
      fixture: true,
    );
    await tester.runAsync(preflight.restore);
    expect(preflight.signedIn, isTrue);
    final restoredAccount = await tester.runAsync(preflight.account);
    expect(restoredAccount, isNotNull);
    expect(restoredAccount!.locale, 'en');
    debugPrint('BITPOS_ADDRESS_ACCOUNT_PREFLIGHT_PASS');

    final branches = await tester.runAsync(() => preflight.branches());
    MobileBranch? branch;
    for (final candidate in branches!.branches) {
      if (!candidate.deliveryEnabled) continue;
      final menu = await tester.runAsync(() => preflight.menu(candidate.id));
      if (menu!.products.isNotEmpty) {
        branch = candidate;
        break;
      }
    }
    if (branch == null) throw StateError('No delivery-enabled fixture branch');
    preflight.close();
    final api = MobileApi(
      base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
      fixture: true,
    );
    addTearDown(api.close);

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: CustomerSessionPage(api: api, pushNative: PushNative()),
      ),
    );
    Future<void> ready(bool Function() predicate) async {
      for (var i = 0; i < 100 && !predicate(); i++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
      }
      if (!predicate()) {
        final visibleText = find
            .byType(Text)
            .evaluate()
            .take(20)
            .map((element) => (element.widget as Text).data ?? '[rich]')
            .toList();
        debugPrint(
          'BITPOS_ADDRESS_READY_DIAGNOSTIC '
          'signedIn=${api.signedIn} '
          'root=${find.byType(CustomerSessionPage).evaluate().length} '
          'food=${find.byType(FoodPage).evaluate().length} '
          'cards=${find.byType(MerchantBranchCard).evaluate().length} '
          'signIn=${find.text('Sign in').evaluate().length} '
          'connectionError=${find.text('Connection failed. Check your network and retry').evaluate().length} '
          'requestError=${find.text('Request failed').evaluate().length} '
          'merchants=${find.text('Available merchants').evaluate().length} '
          'retry=${find.text('Retry loading merchants').evaluate().length} '
          'texts=$visibleText',
        );
      }
      expect(predicate(), isTrue);
    }

    await ready(() => find.byType(MerchantBranchCard).evaluate().isNotEmpty);
    final branchCard = find.byWidgetPredicate(
      (widget) =>
          widget is MerchantBranchCard && widget.branch.id == branch!.id,
    );
    await tester.ensureVisible(branchCard);
    await tester.tap(branchCard);
    await ready(() => find.byType(FoodProductCard).evaluate().isNotEmpty);
    await ready(
      () => find.widgetWithText(ChoiceChip, 'Delivery').evaluate().isNotEmpty,
    );
    await tester.tap(find.widgetWithText(ChoiceChip, 'Delivery'));
    await ready(
      () => find.byType(DeliveryAddressPickerPage).evaluate().isNotEmpty,
    );
    await tester.pumpAndSettle();
    expect(find.text('Delivery addresses'), findsOneWidget);
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Office'), findsOneWidget);
    expect(find.text('Add a new address'), findsOneWidget);
    debugPrint('BITPOS_U12_ROOT_ADDRESS_PICKER_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );

    final seededAddresses = await tester.runAsync(() => api.addresses());
    final initialHome = seededAddresses!.addresses.firstWhere(
      (address) => address.address.label == 'Home',
    );
    await tester.tap(
      find.byKey(ValueKey('delivery-address-${initialHome.id}')),
    );
    await ready(
      () => find.byType(DeliveryAddressPickerPage).evaluate().isEmpty,
    );
    expect(find.text('Home'), findsOneWidget);
    await tester.tap(find.text('Home'));
    await ready(
      () => find.byType(DeliveryAddressPickerPage).evaluate().isNotEmpty,
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add a new address'));
    await ready(() => find.text('My addresses').evaluate().isNotEmpty);
    await tester.pumpAndSettle();
    await tester.tap(find.text('My addresses'));
    await ready(() => find.text('Add address').evaluate().isNotEmpty);
    Future<void> enterField(String label, String value) async {
      final field = find.byKey(
        ValueKey(switch (label) {
          'Place name' => 'address-place-name',
          'Address' => 'address-street',
          'Recipient name' => 'address-recipient-name',
          'Recipient phone' => 'address-recipient-phone',
          'Additional details' => 'address-instructions',
          _ => throw StateError('Unknown address field: $label'),
        }),
      );
      expect(field, findsOneWidget, reason: 'Missing address field: $label');
      await tester.ensureVisible(field);
      await tester.enterText(field, value);
    }

    await tester.ensureVisible(find.text('Add address'));
    await tester.tap(find.text('Add address'));
    await ready(() => find.text('Add a new address').evaluate().isNotEmpty);
    await enterField('Place name', 'Fresh address');
    await enterField('Address', 'Fresh fixture address');
    await enterField('Recipient name', 'Fixture Customer');
    await enterField('Recipient phone', '+66812345678');
    await enterField('Additional details', 'Blue gate');
    await tester.ensureVisible(find.text('Pin on map'));
    await tester.tap(find.text('Pin on map'));
    await ready(() => find.text('Map is unavailable').evaluate().isNotEmpty);
    debugPrint('BITPOS_U14_ADDRESS_PIN_UNAVAILABLE_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.enterText(
      find.byKey(const ValueKey('address-pin-latitude')),
      '13.75',
    );
    await tester.enterText(
      find.byKey(const ValueKey('address-pin-longitude')),
      '100.5',
    );
    await tester.tap(find.text('Use this location'));
    await ready(() => find.text('Pin on map').evaluate().isNotEmpty);
    final saveAddress = find.ancestor(
      of: find.text('Save address'),
      matching: find.byType(FilledButton),
    );
    tester.binding.focusManager.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.ensureVisible(saveAddress);
    await tester.tap(saveAddress);
    await ready(() => find.text('Fresh address').evaluate().isNotEmpty);
    await tester.pumpAndSettle();
    final createdCard = find.ancestor(
      of: find.text('Fresh address'),
      matching: find.byType(SavedAddressCard),
    );
    expect(createdCard, findsOneWidget);
    final editCreated = find.descendant(
      of: createdCard,
      matching: find.text('Edit'),
    );
    await tester.ensureVisible(editCreated);
    await tester.pumpAndSettle();
    await tester.tap(editCreated);
    await ready(() => find.text('Edit address').evaluate().isNotEmpty);
    await tester.ensureVisible(find.text('Edit address'));
    await tester.pumpAndSettle();
    debugPrint('BITPOS_U13_EDIT_ADDRESS_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await enterField('Place name', 'Fresh edited');
    final saveEditedAddress = find.ancestor(
      of: find.text('Save address'),
      matching: find.byType(FilledButton),
    );
    tester.binding.focusManager.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.ensureVisible(saveEditedAddress);
    await tester.tap(saveEditedAddress);
    await ready(() => find.text('Fresh edited').evaluate().isNotEmpty);
    await tester.pumpAndSettle();

    final officeCard = find.ancestor(
      of: find.text('Office'),
      matching: find.byType(SavedAddressCard),
    );
    expect(officeCard, findsOneWidget);
    final archiveOffice = find.descendant(
      of: officeCard,
      matching: find.text('Remove saved address'),
    );
    await tester.ensureVisible(archiveOffice);
    await tester.pumpAndSettle();
    await tester.tap(archiveOffice);
    await ready(() => find.text('Office').evaluate().isEmpty);

    await tester.tap(find.byTooltip('Back to account'));
    await ready(() => find.text('Your account').evaluate().isNotEmpty);
    await tester.tap(find.byTooltip('Back'));
    await ready(
      () => find.byType(DeliveryAddressPickerPage).evaluate().isNotEmpty,
    );
    await ready(() => find.text('Fresh edited').evaluate().isNotEmpty);
    expect(find.text('Office'), findsNothing);
    final refreshed = await tester.runAsync(() => api.addresses());
    final fresh = refreshed!.addresses.firstWhere(
      (address) => address.address.label == 'Fresh edited',
    );
    await tester.tap(find.byKey(ValueKey('delivery-address-${fresh.id}')));
    await ready(
      () => find.byType(DeliveryAddressPickerPage).evaluate().isEmpty,
    );
    expect(find.text('Fresh edited'), findsOneWidget);

    await tester.tap(find.text('Fresh edited'));
    await ready(
      () => find.byType(DeliveryAddressPickerPage).evaluate().isNotEmpty,
    );
    await tester.pumpAndSettle();
    final addresses = await tester.runAsync(() => api.addresses());
    final home = addresses!.addresses.firstWhere(
      (address) => address.address.label == 'Home',
    );
    await tester.tap(find.byKey(ValueKey('delivery-address-${home.id}')));
    await ready(
      () => find.byType(DeliveryAddressPickerPage).evaluate().isEmpty,
    );
    expect(find.text('Home'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
}
