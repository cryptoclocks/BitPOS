import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/delivery_address_picker_page.dart';

import 'address_route_owner_test.dart' show AddressOwnerFoodApi;
import 'delivery_address_picker_page_test.dart' as fixture;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/account_page.dart';
import 'package:mobile_shared/account_mutation.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'account_reload_test.dart' show ReloadAccountApi;

class AddressLifecycleApi extends ReloadAccountApi {
  MobileAddress? saved;
  final commands = <AccountMutation>[];
  @override
  Future<MobileAddresses> addresses({String? cursor}) async => MobileAddresses(
    addresses: saved == null ? [] : [saved!],
    nextCursor: null,
  );
  @override
  Future<void> submitAccountMutation(AccountMutation mutation) async {
    commands.add(mutation);
    MobileAddressFields fields;
    if (mutation is CreateAddressMutation) {
      fields = mutation.command.address;
    } else if (mutation is UpdateAddressMutation) {
      if (mutation.command.expectedVersion != saved!.version) {
        throw StateError('stale');
      }
      fields = mutation.command.address;
    } else if (mutation is ArchiveAddressMutation) {
      if (mutation.command.expectedVersion != saved!.version) {
        throw StateError('stale');
      }
      saved = null;
      return;
    } else {
      throw StateError('unexpected');
    }
    saved = MobileAddress(
      id: '00000000-0000-4000-8000-000000000070',
      version: saved == null ? '1' : '2',
      address: fields,
      archived: false,
      updatedAt: '2026-10-26T00:00:00Z',
    );
  }
}

class JoinedAddressApi extends AddressOwnerFoodApi {
  final accountStore = AddressLifecycleApi();
  MobileDeliveryQuoteRequest? quotedRequest;
  @override
  Future<MobileFoodQuote> quoteDelivery(
    MobileDeliveryQuoteRequest request,
  ) async {
    quotedRequest = request;
    throw const MobileApiException('QUOTE_CHANGED', 409);
  }

  @override
  Future<MobileProfile> profile() => accountStore.profile();
  @override
  Future<MobileAddresses> addresses({String? cursor}) =>
      accountStore.addresses(cursor: cursor);
  @override
  Future<AccountMutation?> pendingAccountMutation() async => null;
  @override
  Future<void> submitAccountMutation(AccountMutation mutation) =>
      accountStore.submitAccountMutation(mutation);
}

void main() {
  testWidgets('food drops selected address after refreshed archived snapshot', (
    tester,
  ) async {
    final api = JoinedAddressApi();
    api.accountStore.saved = fixture.address(1, label: 'Old Home');
    addTearDown(api.close);
    addTearDown(api.accountStore.close);
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: FoodPage(
              api: api,
              thai: false,
              onAuthenticationRequired: () => fail('auth'),
              onAccount: () async {
                final json = api.accountStore.saved!.toJson()
                  ..['archived'] = true;
                api.accountStore.saved = MobileAddress.fromJson(json);
              },
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    Future<void> tap(String label) async {
      final target = find.text(label);
      await Scrollable.ensureVisible(tester.element(target), alignment: .5);
      await tester.pump();
      await tester.tap(target);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    }

    await tap('Fixture branch');
    await tester.pumpAndSettle();
    await tap('Delivery');
    await tester.pumpAndSettle();
    await tap('Old Home');
    await tester.pumpAndSettle();
    expect(find.byType(DeliveryAddressPickerPage), findsNothing);
    await tap('Old Home');
    await tester.pumpAndSettle();
    await tap('Add a new address');
    await tester.pumpAndSettle();
    expect(find.text('This address is archived'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Choose delivery address'), findsOneWidget);
    expect(find.text('Old Home'), findsNothing);
    expect(api.quotedRequest, isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('food picker editor return uses newly saved address version', (
    tester,
  ) async {
    final api = JoinedAddressApi();
    api.accountStore.saved = fixture.address(1, label: 'Original Home');
    final owner = ValueNotifier(true);
    final navigator = GlobalKey<NavigatorState>();
    addTearDown(api.close);
    addTearDown(api.accountStore.close);
    addTearDown(owner.dispose);
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: navigator,
        home: Scaffold(
          body: SingleChildScrollView(
            child: FoodPage(
              api: api,
              owner: owner,
              thai: false,
              onAuthenticationRequired: () => fail('auth'),
              onAccount: () async {
                await navigator.currentState!.push(
                  MaterialPageRoute<void>(
                    builder: (_) => AccountPage(
                      api: api,
                      owner: owner,
                      thai: false,
                      onAuthenticationRequired: () => fail('auth'),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    Future<void> tap(String label) async {
      final target = find.text(label);
      FocusManager.instance.primaryFocus?.unfocus();
      tester.testTextInput.hide();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await Scrollable.ensureVisible(tester.element(target), alignment: .5);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(target);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    }

    await tap('Fixture branch');
    await tester.pumpAndSettle();
    await tap('Delivery');
    await tester.pumpAndSettle();
    await tap('Add a new address');
    await tester.pumpAndSettle();
    await tap('Edit');
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextFormField &&
            widget.controller?.text == 'Original Home',
      ),
      'Updated Home',
    );
    await tap('Save address');
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(DeliveryAddressPickerPage), findsOneWidget);
    expect(find.text('Updated Home'), findsOneWidget);
    expect(find.text('Original Home'), findsNothing);
    await tap('Updated Home');
    await tester.pumpAndSettle();
    expect(find.byType(DeliveryAddressPickerPage), findsNothing);
    expect(find.text('Updated Home'), findsOneWidget);
    expect(api.accountStore.saved!.version, '2');
    await tester.enterText(find.byType(TextField), '500');
    await tester.pumpAndSettle();
    await tap('Configure / add');
    await tap('Add to cart');
    await tester.pumpAndSettle();
    await tap('Review cart · 1');
    await tester.pumpAndSettle();
    expect(api.quotedRequest!.delivery.addressId, api.accountStore.saved!.id);
    expect(api.quotedRequest!.delivery.addressVersion, '2');

    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'address create edit archive journey preserves separate recipient fields and versions',
    (tester) async {
      final api = AddressLifecycleApi();
      final owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          home: AccountPage(
            api: api,
            owner: owner,
            thai: false,
            onNavigate: (_) {},
            onAuthenticationRequired: () => fail('auth'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      Future<void> tap(String label) async {
        final target = find.text(label);
        FocusManager.instance.primaryFocus?.unfocus();
        tester.testTextInput.hide();
        await tester.pumpAndSettle();
        await Scrollable.ensureVisible(tester.element(target), alignment: 0.5);
        await tester.pumpAndSettle();
        await tester.tap(target);
        await tester.pumpAndSettle();
      }

      await tap('My addresses');
      await tap('Add address');
      final save = find.byKey(const ValueKey('address-save-action'));
      final initialSave = tester.getRect(save);
      expect(initialSave.bottom, lessThanOrEqualTo(844));
      await Scrollable.ensureVisible(
        tester.element(find.byKey(const ValueKey('address-recipient-phone'))),
        alignment: .5,
      );
      await tester.pumpAndSettle();
      expect(tester.getRect(save), initialSave);

      final inputs = find.byType(TextFormField);
      await tester.enterText(inputs.at(0), 'Home');
      await tester.enterText(inputs.at(1), 'Fixture delivery address');
      await tester.enterText(
        find.byKey(const ValueKey('address-recipient-name')),
        'Recipient One',
      );
      await tester.enterText(
        find.byKey(const ValueKey('address-recipient-phone')),
        '0900000001',
      );
      await tap('Save address');
      expect(api.commands, isEmpty);
      expect(find.text('Enter an international phone number'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('address-recipient-phone')),
        '+66900000001',
      );
      await tap('Pin on map');
      await tester.enterText(
        find.byKey(const ValueKey('address-pin-latitude')),
        '13.7563',
      );
      await tester.enterText(
        find.byKey(const ValueKey('address-pin-longitude')),
        '100.5018',
      );
      await tap('Use this location');
      expect(
        tester
            .widget<TextFormField>(
              find.byKey(const ValueKey('address-recipient-name')),
            )
            .controller!
            .text,
        'Recipient One',
      );
      expect(
        tester
            .widget<TextFormField>(
              find.byKey(const ValueKey('address-recipient-phone')),
            )
            .controller!
            .text,
        '+66900000001',
      );
      await tap('Save address');
      expect(api.saved!.address.recipientName, 'Recipient One');
      expect(api.saved!.address.latitudeE7, 137563000);
      expect(api.saved!.address.longitudeE7, 1005018000);
      expect(api.saved!.address.phone, '+66900000001');
      await tap('Edit');
      await tester.enterText(
        find.byKey(const ValueKey('address-recipient-name')),
        'Recipient Two',
      );
      await tester.enterText(
        find.byKey(const ValueKey('address-recipient-phone')),
        '+66900000002',
      );
      await tap('Save address');
      expect(api.saved!.version, '2');
      expect(api.saved!.address.recipientName, 'Recipient Two');
      expect(api.saved!.address.phone, '+66900000002');
      await tap('Remove saved address');
      expect(api.saved, isNull);
      expect(api.commands.map((command) => command.kind), [
        'create',
        'update',
        'archive',
      ]);
      expect(find.text('No saved addresses yet.'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
