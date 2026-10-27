import 'package:bitpos_customer/account_data_copy_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

const _id = '00000000-0000-4000-8000-000000000001';

MobileAccountExport _copy({bool truncated = false}) =>
    MobileAccountExport.fromJson({
      'generatedAt': '2026-10-26T10:00:00Z',
      'profile': {
        'id': _id,
        'displayName': 'Fixture',
        'locale': 'en',
        'version': '1',
      },
      'addresses': [
        {
          'id': _id,
          'version': '1',
          'address': {
            'label': 'Home',
            'recipientName': 'Me',
            'phone': '+66000000001',
            'addressText': '1 Test Road',
            'instructions': '',
            'latitudeE7': null,
            'longitudeE7': null,
          },
          'archived': false,
          'updatedAt': '2026-10-20T00:00:00Z',
        },
      ],
      'favourites': [],
      'orders': [],
      'supportCases': [
        {
          'id': _id,
          'subject': 'Late order',
          'state': 'OPEN',
          'createdAt': '2026-10-21T00:00:00Z',
          'orderId': null,
        },
      ],
      'truncated': truncated,
    });

class _Api extends MobileApi {
  _Api()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  int reads = 0;
  Object? failure;
  bool truncated = false;
  @override
  Future<MobileAccountExport> accountExport() async {
    reads++;
    if (failure != null) throw failure!;
    return _copy(truncated: truncated);
  }
}

Widget _app(
  _Api api,
  ValueNotifier<bool> owner, {
  bool thai = false,
  VoidCallback? onAuth,
}) => MaterialApp(
  home: AccountDataCopyPage(
    key: ValueKey(api),
    api: api,
    owner: owner,
    thai: thai,
    onAuthenticationRequired: onAuth ?? () {},
  ),
);

void main() {
  testWidgets(
    'shows counts, states it is not a deletion and copies JSON text only on tap',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final api = _Api(), owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      String? clipboard;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData')
            clipboard = (call.arguments as Map)['text'] as String;
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await tester.pumpWidget(_app(api, owner));
      await tester.pumpAndSettle();
      expect(api.reads, 1);
      expect(find.textContaining('is not a deletion request'), findsOneWidget);
      expect(find.text('Fixture · en'), findsOneWidget);
      expect(find.byKey(const ValueKey('data-copy-truncated')), findsNothing);
      expect(clipboard, isNull, reason: 'opening the page never copies');
      await tester.tap(find.text('Copy as JSON text'));
      await tester.pumpAndSettle();
      expect(clipboard, contains('"displayName": "Fixture"'));
      expect(clipboard, contains('1 Test Road'));
      expect(find.text('Copied'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'truncation is stated, failure offers retry and auth loss is delegated',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final owner = ValueNotifier(true);
      addTearDown(owner.dispose);
      final truncated = _Api()..truncated = true;
      addTearDown(truncated.close);
      await tester.pumpWidget(_app(truncated, owner, thai: true));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('data-copy-truncated')), findsOneWidget);
      final failing = _Api()
        ..failure = const MobileApiException('RESPONSE_UNAVAILABLE', 503);
      addTearDown(failing.close);
      await tester.pumpWidget(_app(failing, owner));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Could not load your data copy'),
        findsOneWidget,
      );
      expect(
        find.text('Copy as JSON text'),
        findsNothing,
        reason: 'nothing to copy before a successful read',
      );
      failing.failure = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Fixture · en'), findsOneWidget);
      var auth = 0;
      final denied = _Api()
        ..failure = const MobileApiException('AUTH_REQUIRED', 401);
      addTearDown(denied.close);
      await tester.pumpWidget(_app(denied, owner, onAuth: () => auth++));
      await tester.pumpAndSettle();
      expect(auth, 1);
    },
  );
  testWidgets('owner loss removes the private route', (tester) async {
    final api = _Api(), owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => AccountDataCopyPage(
                    api: api,
                    owner: owner,
                    thai: false,
                    onAuthenticationRequired: () {},
                  ),
                ),
              ),
              child: const Text('Open copy'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open copy'));
    await tester.pumpAndSettle();
    expect(find.text('My data copy'), findsOneWidget);
    owner.value = false;
    await tester.pumpAndSettle();
    expect(find.text('My data copy'), findsNothing);
    expect(find.text('Open copy'), findsOneWidget);
  });
}
