import 'dart:io';

import 'package:mobile_shared/mobile_api.dart';

import 'package:bitpos_customer/main.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'notification_owner_test.dart' show PushNative;

import 'dart:async';

import 'package:bitpos_customer/presentation/merchant_search_controls.dart';
import 'package:bitpos_customer/presentation/merchant_search_empty.dart';

import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/food_page.dart';

import 'food_menu_pages_test.dart' show MenuPagesApi;
import 'customer_onboarding_ui_test.dart' show loadFonts;

class DiscoveryApi extends MenuPagesApi {
  DiscoveryApi() : super(productCount: 2);
  final requests = <(String, String)>[];
  @override
  Future<MobileBranches> branches({
    String? cursor,
    String search = '',
    String serving = 'all',
  }) async {
    requests.add((search, serving));
    return MobileBranches(branches: [branch], nextCursor: null);
  }
}

class PagedDiscoveryApi extends DiscoveryApi {
  final pages = <(String?, String, String)>[];
  bool failNext = true;
  @override
  Future<MobileBranches> branches({
    String? cursor,
    String search = '',
    String serving = 'all',
  }) async {
    pages.add((cursor, search, serving));
    if (cursor != null && failNext) {
      failNext = false;
      throw Exception('local offline fixture');
    }
    final next = MobileBranch(
      id: '00000000-0000-4000-8000-000000000099',
      merchantId: branch.merchantId,
      merchantName: branch.merchantName,
      name: 'สาขาหน้าสอง',
      nameEn: 'Second page branch',
      addressLabel: 'Local fixture',
      pickupEnabled: true,
      deliveryEnabled: false,
      version: 1,
    );
    return MobileBranches(
      branches: cursor == null ? [branch] : [branch, next],
      nextCursor: cursor == null
          ? '00000000-0000-4000-8000-000000000088'
          : null,
    );
  }
}

class GatedDiscoveryApi extends DiscoveryApi {
  final gate = Completer<MobileBranches>();
  int loads = 0;
  @override
  Future<MobileBranches> branches({
    String? cursor,
    String search = '',
    String serving = 'all',
  }) async {
    loads++;
    if (loads == 1) return gate.future;
    return MobileBranches(branches: [branch], nextCursor: null);
  }
}

class SessionDiscoveryApi extends DiscoveryApi {
  SessionDiscoveryApi(this.thai);
  final bool thai;
  @override
  bool get signedIn => true;
  @override
  ({String accountId, String sessionId}) get sessionScope => (
    accountId: '00000000-0000-4000-8000-000000000050',
    sessionId: '00000000-0000-4000-8000-000000000051',
  );
  @override
  Stream<({String accountId, String sessionId})?> get sessionScopes =>
      const Stream.empty();
  @override
  Future<void> restore() async {}
  @override
  Future<MobileAccount> account() async => MobileAccount(
    id: sessionScope.accountId,
    displayName: 'Local fixture',
    locale: thai ? 'th' : 'en',
  );
  @override
  Future<MobilePushStatus> pushStatus(
    MobilePushApp app,
    String installationKey,
  ) async => MobilePushStatus(
    installation: MobilePushUnregistered(kind: 'UNREGISTERED', revision: '0'),
    endpointEncryptionAvailable: true,
  );
}

class TwoMerchantApi extends DiscoveryApi {
  bool failOther = false;
  final opens = <String>[];
  MobileBranch get other => MobileBranch(
    id: '00000000-0000-4000-8000-000000000098',
    merchantId: '00000000-0000-4000-8000-000000000097',
    merchantName: 'Other fixture merchant',
    name: 'ร้านอื่น',
    nameEn: 'Other fixture branch',
    addressLabel: 'Local other fixture',
    pickupEnabled: true,
    deliveryEnabled: false,
    version: 1,
  );
  @override
  Future<MobileBranches> branches({
    String? cursor,
    String search = '',
    String serving = 'all',
  }) async => MobileBranches(branches: [branch, other], nextCursor: null);
  @override
  Future<MobileMenu> menu(
    String branchId, {
    String? cursor,
    String? menuVersion,
  }) async {
    opens.add(branchId);
    if (branchId == other.id && failOther)
      throw Exception('local other merchant offline');
    final result = await super.menu(
      branchId,
      cursor: cursor,
      menuVersion: menuVersion,
    );
    return branchId == other.id
        ? MobileMenu.fromJson({...result.toJson(), 'branch': other.toJson()})
        : result;
  }
}

void main() {
  testWidgets(
    'change merchant cancel and failed load preserve original cart; confirmed load replaces it',
    (tester) async {
      final api = TwoMerchantApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () => fail('auth'),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      Future<void> tap(Finder target) async {
        await tester.ensureVisible(target);
        await tester.tap(target);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        if (find.byType(AlertDialog).evaluate().isEmpty)
          await tester.pumpAndSettle();
      }

      await tap(find.text('Fixture branch'));
      await tester.ensureVisible(find.text('Configure / add').first);
      await tester.tap(find.text('Configure / add').first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.enterText(find.byType(TextField).last, 'Keep original cart');
      await tap(find.text('Add to cart'));
      await tap(find.text('Merchants'));
      await tap(find.text('Other fixture branch'));
      expect(find.text('Change merchant?'), findsOneWidget);
      await tap(find.text('Keep current cart'));
      expect(api.opens.where((id) => id == api.other.id), isEmpty);
      await tap(find.text('Fixture branch'));
      expect(find.textContaining('Keep original cart'), findsOneWidget);
      await tap(find.text('Merchants'));
      api.failOther = true;
      await tap(find.text('Other fixture branch'));
      await tap(find.widgetWithText(FilledButton, 'Change merchant'));
      await tap(find.text('Fixture branch'));
      expect(find.text('Review cart · 1'), findsOneWidget);
      expect(find.textContaining('Keep original cart'), findsOneWidget);
      await tap(find.text('Merchants'));
      api.failOther = false;
      await tap(find.text('Other fixture branch'));
      await tap(find.widgetWithText(FilledButton, 'Change merchant'));
      expect(find.text('Other fixture branch'), findsOneWidget);
      expect(find.text('Review cart · 0'), findsOneWidget);
      expect(find.textContaining('Keep original cart'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('same merchant reopen and refresh retain configured draft note', (
    tester,
  ) async {
    final api = DiscoveryApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: FoodPage(
              api: api,
              thai: false,
              onAuthenticationRequired: () => fail('auth'),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fixture branch'));
    await tester.pumpAndSettle();
    final add = find.text('Configure / add').first;
    await tester.ensureVisible(add);
    await tester.tap(add);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.enterText(
      find.byType(TextField).last,
      'No onions local draft',
    );
    await tester.ensureVisible(find.text('Add to cart'));
    await tester.tap(find.text('Add to cart'));
    await tester.pumpAndSettle();
    expect(find.text('Review cart · 1'), findsOneWidget);
    await tester.ensureVisible(find.text('Refresh menu; keep cart'));
    await tester.tap(find.text('Refresh menu; keep cart'));
    await tester.pumpAndSettle();
    expect(find.text('Review cart · 1'), findsOneWidget);
    await tester.ensureVisible(find.text('Merchants'));
    await tester.tap(find.text('Merchants'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('discovery-return-to-cart')),
    );
    await tester.tap(find.byKey(const ValueKey('discovery-return-to-cart')));
    await tester.pumpAndSettle();
    expect(find.text('Review cart · 1'), findsOneWidget);
    expect(find.textContaining('No onions local draft'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  for (final variant in [
    (true, 390.0, 1.0, false),
    (false, 390.0, 1.0, false),
    (true, 320.0, 1.5, true),
  ]) {
    final thai = variant.$1;
    testWidgets(
      'CustomerSessionPage owns one store toolbar and returns to discovery thai=$thai width=${variant.$2}',
      (tester) async {
        await loadFonts(tester);
        await tester.binding.setSurfaceSize(Size(variant.$2, 844));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        FlutterSecureStorage.setMockInitialValues({});
        final api = SessionDiscoveryApi(thai);
        addTearDown(api.close);
        final rootBoundary = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: rootBoundary,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: variant.$4 ? BitPosTheme.dark() : BitPosTheme.light(),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(variant.$3)),
                child: child!,
              ),
              home: CustomerSessionPage(api: api, pushNative: PushNative()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final name = thai ? 'ร้านทดสอบ' : 'Fixture branch';
        await tester.ensureVisible(find.text(name));
        await tester.tap(find.text(name));
        await tester.pumpAndSettle();
        expect(find.byType(AppBar), findsOneWidget);
        expect(
          tester
              .getSize(find.byKey(const ValueKey('merchant-detail-hero')))
              .height,
          208,
        );
        expect(
          find.descendant(of: find.byType(AppBar), matching: find.text(name)),
          findsOneWidget,
        );
        expect(find.text(thai ? 'เมนู1' : 'Searchable food 1'), findsOneWidget);
        final out = Platform.environment['BITPOS_DS04_CAPTURE_DIR'];
        if (out != null) {
          final render =
              rootBoundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final image = await render.toImage(pixelRatio: 1);
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final file = File('$out/session-store-$thai-${variant.$2}.png');
            await file.create(exclusive: true);
            await file.writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }

        await tester.tap(find.byTooltip(thai ? 'ร้านอาหาร' : 'Merchants'));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('branch-discovery-search')),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      },
    );
  }

  testWidgets(
    'initial discovery loading failure is not empty and retry restores merchants',
    (tester) async {
      final api = GatedDiscoveryApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () => fail('Unexpected auth'),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.byType(MerchantDiscoveryLoading), findsOneWidget);
      expect(find.byType(MerchantSearchEmpty), findsNothing);
      api.gate.completeError(Exception('local discovery unavailable'));
      await tester.pumpAndSettle();
      expect(find.byType(MerchantDiscoveryLoading), findsNothing);
      expect(find.byType(MerchantSearchEmpty), findsNothing);
      final retry = find.text('Retry loading merchants');
      await tester.ensureVisible(retry);
      await tester.tap(retry);
      await tester.pumpAndSettle();
      expect(api.loads, 2);
      expect(find.text('Fixture branch'), findsOneWidget);
      expect(find.byType(MerchantSearchEmpty), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'discovery pagination failure keeps results and exact query then deduplicates retry',
    (tester) async {
      final api = PagedDiscoveryApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () => fail('Unexpected auth'),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('branch-discovery-search')),
        'Coffee',
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('branch-mode-pickup')),
      );
      await tester.tap(find.byKey(const ValueKey('branch-mode-pickup')));
      await tester.pumpAndSettle();
      final more = find.text('More merchants');
      await tester.ensureVisible(more);
      await tester.tap(more);
      await tester.pumpAndSettle();
      expect(api.pages.last, (
        '00000000-0000-4000-8000-000000000088',
        'Coffee',
        'pickup',
      ));
      expect(find.text('Fixture branch'), findsOneWidget);
      expect(find.text('Second page branch'), findsNothing);
      expect(find.text('No merchants match this search.'), findsNothing);
      expect(more, findsOneWidget);
      await tester.ensureVisible(more);
      await tester.tap(more);
      await tester.pumpAndSettle();
      expect(api.pages.last, (
        '00000000-0000-4000-8000-000000000088',
        'Coffee',
        'pickup',
      ));
      expect(find.text('Fixture branch'), findsOneWidget);
      expect(find.text('Second page branch'), findsOneWidget);
      expect(more, findsNothing);
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('branch-discovery-search')),
            )
            .controller!
            .text,
        'Coffee',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final variant in [
    (true, 390.0, 1.0, false),
    (false, 390.0, 1.0, false),
    (true, 320.0, 1.5, true),
  ]) {
    testWidgets(
      'actual discovery store back keeps search ${variant.$1}-${variant.$2}',
      (tester) async {
        await loadFonts(tester);
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(variant.$2, 1000);
        addTearDown(tester.view.reset);
        final api = DiscoveryApi();
        addTearDown(api.close);
        final boundary = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: boundary,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: variant.$4 ? BitPosTheme.dark() : BitPosTheme.light(),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: TextScaler.linear(variant.$3)),
                child: child!,
              ),
              home: Scaffold(
                body: SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: FoodPage(
                      api: api,
                      thai: variant.$1,
                      onAuthenticationRequired: () =>
                          fail('Unexpected auth refusal'),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        Future<void> reveal(Finder target) async {
          await tester.ensureVisible(target);
          await tester.pumpAndSettle();
        }

        Future<void> capture(String name) async {
          final out = Platform.environment['BITPOS_DS04_CAPTURE_DIR'];
          if (out == null) return;
          final render =
              boundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final image = await render.toImage(pixelRatio: 1);
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final file = File('$out/$name-${variant.$1}-${variant.$2}.png');
            await file.create(exclusive: true);
            await file.writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }

        final search = find.byKey(const ValueKey('branch-discovery-search'));
        await tester.enterText(search, 'Fixture');
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        final submit = find.byKey(const ValueKey('branch-discovery-submit'));
        await reveal(submit);
        await tester.tap(submit);
        await tester.pumpAndSettle();
        expect(api.requests.last, ('Fixture', 'all'));
        await tester.ensureVisible(
          find.byKey(const ValueKey('branch-discovery-filter')),
        );
        await tester.tap(find.byKey(const ValueKey('branch-discovery-filter')));
        await tester.pumpAndSettle();
        await capture('filters');
        await tester.tap(
          find.byKey(const ValueKey('branch-filter-draft-pickup')),
        );
        await tester.pump();
        await tester.ensureVisible(
          find.byKey(const ValueKey('branch-filter-apply')),
        );
        await tester.tap(find.byKey(const ValueKey('branch-filter-apply')));
        await tester.pumpAndSettle();
        expect(api.requests.last, ('Fixture', 'pickup'));

        final branch = find.text(variant.$1 ? 'ร้านทดสอบ' : 'Fixture branch');
        await reveal(branch);
        await capture('discovery');
        await tester.tap(branch);
        await tester.pumpAndSettle();
        expect(
          find.text(variant.$1 ? 'เมนู1' : 'Searchable food 1'),
          findsOneWidget,
        );
        final back = find.widgetWithText(
          TextButton,
          variant.$1 ? 'ร้านอาหาร' : 'Merchants',
        );
        await reveal(back);
        await capture('store');
        await tester.tap(back);
        await tester.pumpAndSettle();
        expect(tester.widget<TextField>(search).controller!.text, 'Fixture');
        expect(api.requests.last, ('Fixture', 'pickup'));
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}
