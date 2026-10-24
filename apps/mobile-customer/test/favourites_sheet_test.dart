import 'package:bitpos_customer/presentation/favourite_branch_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/favourites_sheet.dart';

const id = '00000000-0000-4000-8000-000000000001';
MobileFavourites empty() => MobileFavourites(items: [], nextCursor: null);
MobileFavourites saved() => MobileFavourites.fromJson({
  'items': [
    {
      'merchantId': id,
      'branchId': id,
      'createdAt': '2026-10-19T00:00:00Z',
      'branch': null,
    },
  ],
  'nextCursor': null,
});
MobileFavourites availableBranches() => MobileFavourites.fromJson({
  'items': List.generate(3, (i) {
    final branchId =
        '00000000-0000-4000-8000-${(i + 1).toString().padLeft(12, '0')}';
    return {
      'merchantId': id,
      'branchId': branchId,
      'createdAt': '2026-10-19T00:00:00Z',
      'branch': {
        'id': branchId,
        'merchantId': id,
        'merchantName': [
          'BitPOS Coffee House',
          'Morning Bake',
          'Matcha & More',
        ][i],
        'name': ['BitPOS Coffee House', 'Morning Bake', 'Matcha & More'][i],
        'nameEn': ['BitPOS Coffee House', 'Morning Bake', 'Matcha & More'][i],
        'addressLabel': 'Bangkok',
        'pickupEnabled': true,
        'deliveryEnabled': true,
        'version': 1,
      },
    };
  }),
  'nextCursor': null,
});

class FavouriteApi extends MobileApi {
  FavouriteApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  bool fail = false;
  int writes = 0;
  @override
  Future<MobileFavourites> favourites({String? cursor}) async => empty();
  @override
  Future<MobileFavouriteReceipt> setFavourite(
    String branchId,
    bool favourite,
  ) async {
    writes++;
    if (fail) throw const MobileApiException('RESPONSE_UNAVAILABLE', 503);
    return MobileFavouriteReceipt(branchId: branchId, favourite: favourite);
  }
}

void main() {
  testWidgets('U28 favourites follows the 390px FigCraft page and row grid', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = FavouriteApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(
            padding: EdgeInsets.only(top: 24),
            viewPadding: EdgeInsets.only(top: 24),
          ),
          child: FavouritesSheet(
            api: api,
            firstPage: availableBranches(),
            thai: false,
            onAuthenticationRequired: () {},
            onNavigate: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final cards = find.byType(FavouriteBranchCard);
    expect(tester.getRect(cards.first), const Rect.fromLTWH(24, 279, 342, 82));
    expect(tester.getRect(cards.at(1)), const Rect.fromLTWH(24, 375, 342, 82));
    expect(tester.getRect(cards.at(2)), const Rect.fromLTWH(24, 471, 342, 82));
    expect(
      tester.getRect(
        find.byKey(
          const ValueKey(
            'favourite-branch-image.00000000-0000-4000-8000-000000000001',
          ),
        ),
      ),
      const Rect.fromLTWH(36, 290, 60, 60),
    );
    expect(
      tester.getRect(find.byType(TextField)),
      const Rect.fromLTWH(24, 132, 342, 52),
    );
    expect(
      tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
      2,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'unavailable narrow Thai large-text favourite retains separate remove action',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      var removed = 0, opened = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
            child: Scaffold(
              body: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: FavouriteBranchCard(
                    item: saved().items.first,
                    thai: true,
                    onOpen: () => opened++,
                    onRemove: () => removed++,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      expect(find.text('ร้านนี้ยังไม่เปิดให้บริการ'), findsOneWidget);
      expect(opened, 0);
      await tester.tap(find.byTooltip('นำออกจากร้านโปรด'));
      expect(removed, 1);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'unavailable saved merchant remains removable with actual reload',
    (tester) async {
      final api = FavouriteApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FavouritesSheet(
              api: api,
              firstPage: saved(),
              thai: false,
              onAuthenticationRequired: () {},
            ),
          ),
        ),
      );
      expect(find.text('Merchant currently unavailable'), findsOneWidget);
      await tester.tap(find.byTooltip('Remove favourite'));
      await tester.pumpAndSettle();
      expect(api.writes, 1);
      expect(find.textContaining('No favourites yet.'), findsOneWidget);
    },
  );
  testWidgets(
    'failed removal retains server entry and provides refresh recovery',
    (tester) async {
      final api = FavouriteApi()..fail = true;
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FavouritesSheet(
              api: api,
              firstPage: saved(),
              thai: false,
              onAuthenticationRequired: () {},
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('Remove favourite'));
      await tester.pumpAndSettle();
      expect(find.text('Merchant currently unavailable'), findsOneWidget);
      expect(find.textContaining('Could not load or save.'), findsOneWidget);
      await tester.tap(find.text('Refresh'));
      await tester.pumpAndSettle();
      expect(find.textContaining('No favourites yet.'), findsOneWidget);
    },
  );
  testWidgets(
    'full page keeps selected tab and search usable with keyboard on narrow phone',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = FavouriteApi();
      addTearDown(api.close);
      int? destination;
      await tester.pumpWidget(
        MaterialApp(
          home: FavouritesSheet(
            api: api,
            firstPage: saved(),
            thai: false,
            onAuthenticationRequired: () {},
            onNavigate: (index) => destination = index,
          ),
        ),
      );
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        2,
      );
      await tester.tap(find.text('Account'));
      await tester.pump();
      expect(destination, 3);
      await tester.tap(find.byType(TextField));
      await tester.enterText(find.byType(TextField), 'unavailable');
      tester.view.viewInsets = const FakeViewPadding(bottom: 320);
      addTearDown(tester.view.resetViewInsets);
      await tester.pump();
      expect(find.byType(NavigationBar), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('Clear search'));
      await tester.pump();
      expect(find.text('Merchant currently unavailable'), findsOneWidget);
    },
  );
}
