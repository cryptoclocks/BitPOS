import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/merchant_search_empty.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_menu_pages_test.dart' show MenuPagesApi;

class SearchApi extends MenuPagesApi {
  final searches = <(String, String)>[];
  @override
  Future<MobileBranches> branches({
    String? cursor,
    String search = '',
    String serving = 'all',
  }) async {
    searches.add((search, serving));
    return MobileBranches(
      branches: search.isEmpty && serving == 'all' ? [branch] : [],
      nextCursor: null,
    );
  }
}

void main() {
  testWidgets(
    'actual FoodPage resets query and service filter then reloads merchants',
    (tester) async {
      final api = SearchApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('branch-discovery-search')),
        'absent',
      );
      await tester.ensureVisible(
        find.byKey(const ValueKey('branch-mode-delivery')),
      );
      await tester.tap(find.byKey(const ValueKey('branch-mode-delivery')));
      await tester.pumpAndSettle();
      expect(api.searches.last, ('absent', 'delivery'));
      await tester.ensureVisible(find.text('Clear search and filters'));
      await tester.tap(find.text('Clear search and filters'));
      await tester.pumpAndSettle();
      expect(api.searches.last, ('', 'all'));
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('branch-discovery-search')),
            )
            .controller!
            .text,
        isEmpty,
      );
      expect(find.text('Fixture branch'), findsOneWidget);
      expect(find.byType(MerchantSearchEmpty), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'empty search reset is explicit and usable with Thai large text',
    (tester) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var reset = 0;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!,
          ),
          home: Scaffold(
            body: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: MerchantSearchEmpty(
                  thai: true,
                  query: 'กาแฟ',
                  filtered: true,
                  onReset: () => reset++,
                ),
              ),
            ),
          ),
        ),
      );
      expect(reset, 0);
      await tester.tap(find.text('ล้างการค้นหาและตัวกรอง'));
      expect(reset, 1);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('unfiltered empty catalogue does not promise reset results', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: MerchantSearchEmpty(thai: false, query: '', filtered: false),
        ),
      ),
    );
    expect(find.text('Clear search and filters'), findsNothing);
    expect(find.textContaining('refresh the merchant list'), findsOneWidget);
  });
}
