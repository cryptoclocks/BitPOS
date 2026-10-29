import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/account_mutation.dart';
import 'package:bitpos_customer/account_page.dart';

class ReloadAccountApi extends MobileApi {
  ReloadAccountApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  String version = '1';
  final submitted = <String>[];
  MobileAddressFields? savedAddress;
  @override
  Future<AccountMutation?> pendingAccountMutation() async => null;
  @override
  Future<MobileProfile> profile() async => MobileProfile(
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Fixture',
    locale: 'en',
    version: '1',
  );
  @override
  Future<MobileAddresses> addresses({String? cursor}) async => MobileAddresses(
    addresses: [
      MobileAddress(
        id: '00000000-0000-4000-8000-000000000002',
        version: version,
        address: MobileAddressFields(
          label: 'Home v$version',
          recipientName: 'Fixture',
          phone: '+66900000001',
          addressText: 'Synthetic address',
          instructions: '',
          latitudeE7: null,
          longitudeE7: null,
        ),
        archived: false,
        updatedAt: '2026-10-16T00:00:00.000Z',
      ),
    ],
    nextCursor: null,
  );
  @override
  Future<void> submitAccountMutation(AccountMutation mutation) async {
    final command = (mutation as UpdateAddressMutation).command;
    savedAddress = command.address;
    submitted.add(command.expectedVersion);
    if (command.expectedVersion != version)
      throw const MobileApiException('VERSION_CONFLICT', 409);
  }
}

void main() {
  testWidgets(
    'reload discards stale editor then fresh edit uses current version',
    (tester) async {
      final api = ReloadAccountApi();
      addTearDown(api.close);
      tester.view.physicalSize = const Size(1080, 3200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final owner = ValueNotifier(true);
      addTearDown(owner.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: AccountPage(
            api: api,
            owner: owner,
            thai: false,
            onAuthenticationRequired: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Edit'));
      await tester.tap(find.text('Edit'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('address-recipient-name')),
        'Updated recipient',
      );
      await tester.enterText(
        find.byKey(const ValueKey('address-recipient-phone')),
        '+66812345678',
      );
      api.version = '2';
      await tester.ensureVisible(find.text('Save address'));
      await tester.tap(find.text('Save address'));
      await tester.pumpAndSettle();
      expect(api.submitted, ['1']);
      expect(api.savedAddress?.recipientName, 'Updated recipient');
      expect(api.savedAddress?.phone, '+66812345678');
      await tester.ensureVisible(find.text('Reload server details'));
      await tester.tap(find.text('Reload server details'));
      await tester.pumpAndSettle();
      expect(find.text('Edit address'), findsNothing);
      await tester.ensureVisible(find.text('Edit'));
      await tester.tap(find.text('Edit'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Save address'));
      await tester.tap(find.text('Save address'));
      await tester.pumpAndSettle();
      expect(api.submitted, ['1', '2']);
      expect(find.text('Details changed. Reload before saving.'), findsNothing);
    },
  );
}
