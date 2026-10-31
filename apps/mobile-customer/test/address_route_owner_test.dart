import 'dart:async';

import 'package:bitpos_customer/delivery_address_picker_page.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/account_page.dart';
import 'package:bitpos_customer/address_pin_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'account_reload_test.dart' show ReloadAccountApi;
import 'food_menu_pages_test.dart' show MenuPagesApi;
import 'delivery_address_picker_page_test.dart' as address_fixture;

class AddressOwnerFoodApi extends MenuPagesApi {
  AddressOwnerFoodApi() {
    failContinuation = false;
  }
  static final _deliveryBranch = MobileBranch(
    id: 'bb000000-0000-4000-8000-000000000001',
    merchantId: 'bb000000-0000-4000-8000-000000000002',
    merchantName: 'Fixture merchant',
    name: 'Fixture branch',
    nameEn: 'Fixture branch',
    addressLabel: 'Fixture only',
    pickupEnabled: true,
    deliveryEnabled: true,
    version: 1,
        openNow: null,
        nextOpenAt: null,
  );
  @override
  MobileBranch get branch => _deliveryBranch;
  Completer<MobileAddresses>? delayedAddresses;
  @override
  Future<MobileAddresses> addresses({String? cursor}) async =>
      delayedAddresses == null
      ? MobileAddresses(
          addresses: [
            address_fixture.address(1, label: 'Private owner A home'),
          ],
          nextCursor: null,
        )
      : delayedAddresses!.future;
  @override
  Future<MobileCustomerDeliveryPolicy> deliveryPolicy(String branchId) async {
    final zero = MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0');
    return MobileCustomerDeliveryPolicy(
      branchId: branchId,
      policyVersionId: branch.id,
      priceVersionId: branch.id,
      deliveryFee: zero,
      serviceFee: zero,
      originLatitudeE7: 137300000,
      originLongitudeE7: 1005600000,
      southE7: 130000000,
      northE7: 140000000,
      westE7: 1000000000,
      eastE7: 1010000000,
      fixture: true,
    );
  }
}

void main() {
  for (final delayed in [false, true]) {
    testWidgets(
      'real food picker private snapshot retires and late address read stays retired; delayed=$delayed',
      (tester) async {
        tester.view.physicalSize = const Size(1080, 3200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final api = AddressOwnerFoodApi();
        addTearDown(api.close);
        final owner = ValueNotifier(true);
        addTearDown(owner.dispose);
        final navigator = GlobalKey<NavigatorState>();
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: navigator,
            home: Scaffold(
              body: SingleChildScrollView(
                child: FoodPage(
                  api: api,
                  owner: owner,
                  thai: false,
                  onAccount: () async {},
                  onAuthenticationRequired: () {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Fixture branch'));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(ChoiceChip, 'Delivery'));
        await tester.pumpAndSettle();
        expect(find.text('Private owner A home'), findsOneWidget);
        if (delayed) {
          api.delayedAddresses = Completer<MobileAddresses>();
          await tester.tap(find.text('Add a new address'));
          await tester.pump();
        }
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Unrelated destination')),
          ),
        );
        await tester.pumpAndSettle();
        owner.value = false;
        await tester.pumpAndSettle();
        if (delayed) {
          api.delayedAddresses!.complete(
            MobileAddresses(
              addresses: [
                address_fixture.address(2, label: 'Late private address'),
              ],
              nextCursor: null,
            ),
          );
          await tester.pumpAndSettle();
        }
        expect(
          find.byType(DeliveryAddressPickerPage, skipOffstage: false),
          findsNothing,
        );
        expect(
          find.text('Private owner A home', skipOffstage: false),
          findsNothing,
        );
        expect(
          find.text('Late private address', skipOffstage: false),
          findsNothing,
        );
        expect(find.text('Unrelated destination'), findsOneWidget);
      },
    );
  }
  for (final coverWithUnrelatedRoute in [false, true]) {
    testWidgets(
      'private account pin retires on owner loss; unrelated=$coverWithUnrelatedRoute',
      (tester) async {
        tester.view.physicalSize = const Size(1080, 3200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final api = ReloadAccountApi();
        addTearDown(api.close);
        final owner = ValueNotifier(true);
        addTearDown(owner.dispose);
        final navigator = GlobalKey<NavigatorState>();
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: navigator,
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => AccountPage(
                        api: api,
                        owner: owner,
                        thai: false,
                        onAuthenticationRequired: () {},
                      ),
                    ),
                  ),
                  child: const Text('Public home'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Public home'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Edit'));
        await tester.tap(find.text('Edit'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Pin on map'));
        await tester.tap(find.text('Pin on map'));
        // Both taps occur before keyboard-dismissal delay completes.
        await tester.tap(find.text('Pin on map'));
        await tester.pumpAndSettle();
        expect(find.byType(AddressPinPage), findsOneWidget);
        if (coverWithUnrelatedRoute) {
          navigator.currentState!.push(
            MaterialPageRoute<void>(
              builder: (_) =>
                  const Scaffold(body: Text('Unrelated public destination')),
            ),
          );
          await tester.pumpAndSettle();
        }
        owner.value = false;
        await tester.pumpAndSettle();
        expect(find.byType(AddressPinPage, skipOffstage: false), findsNothing);
        expect(find.byType(AccountPage, skipOffstage: false), findsNothing);
        expect(
          find.text(
            coverWithUnrelatedRoute
                ? 'Unrelated public destination'
                : 'Public home',
          ),
          findsOneWidget,
        );
      },
    );
  }
}
