import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'customer_onboarding_ui_test.dart' show loadFonts;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/product_options_sheet.dart';

class _PhotoClient implements HttpClient {
  _PhotoClient(this.bytes);
  final List<int> bytes;
  @override
  bool autoUncompress = true;
  @override
  Future<HttpClientRequest> getUrl(Uri url) async => _PhotoRequest(bytes);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _PhotoRequest implements HttpClientRequest {
  _PhotoRequest(this.bytes);
  final List<int> bytes;
  @override
  HttpHeaders get headers => _PhotoHeaders();
  @override
  Future<HttpClientResponse> close() async => _PhotoResponse(bytes);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _PhotoHeaders implements HttpHeaders {
  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _PhotoResponse extends Stream<List<int>> implements HttpClientResponse {
  _PhotoResponse(this.bytes);
  final List<int> bytes;
  @override
  int get statusCode => 200;
  @override
  int get contentLength => bytes.length;
  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;
  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => Stream<List<int>>.value(bytes).listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

String id(int n) => 'aa000000-0000-4000-8000-${n.toString().padLeft(12, '0')}';
MobileProduct product() => MobileProduct(
  id: id(1),
  name: 'กาแฟ',
  nameEn: 'Coffee',
  category: '',
  description: '',
  imageUrl: '',
  available: 3,
  unitPrice: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270'),
  basePrice: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270'),
  options: options(),
);
MobileProductOptions options() => MobileProductOptions(
  version: id(2),
  revision: '1',
  noteEnabled: true,
  groups: [
    MobileOptionGroup(
      id: id(3),
      name: 'นม',
      nameEn: 'Milk',
      enabled: true,
      minSelections: 1,
      maxSelections: 1,
      choices: [
        MobileOptionChoice(
          id: id(4),
          name: 'โอ๊ต',
          nameEn: 'Oat',
          enabled: true,
          maxQty: 1,
          priceDelta: MobileMoney(
            currency: 'USD',
            decimals: 2,
            amountMinor: '35',
          ),
        ),
        MobileOptionChoice(
          id: id(5),
          name: 'ถั่ว',
          nameEn: 'Soy',
          enabled: true,
          maxQty: 1,
          priceDelta: MobileMoney(
            currency: 'USD',
            decimals: 2,
            amountMinor: '0',
          ),
        ),
      ],
    ),
  ],
);
void main() {
  testWidgets('required error scrolls into view when fixed action is pressed', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProductOptionsSheet(
            product: product(),
            options: options(),
            lineId: id(6),
            thai: false,
            maximumQuantity: 3,
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('product-detail-submit')));
    await tester.pumpAndSettle();
    final error = find.text('Choose 1–1 Milk per item.');
    expect(error, findsOneWidget);
    final bounds = tester.getRect(error);
    expect(bounds.top, greaterThanOrEqualTo(68));
    expect(
      bounds.bottom,
      lessThan(
        tester.getRect(find.byKey(const ValueKey('product-detail-submit'))).top,
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('catalogue hero renders supplied image at canonical238px', (
    tester,
  ) async {
    final bytes = File('assets/design/welcome-coffee.jpg').readAsBytesSync();
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await HttpOverrides.runZoned(() async {
      final json = product().toJson()
        ..['imageUrl'] = 'https://fixture.invalid/catalogue-hero.jpg';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ProductOptionsSheet(
              product: MobileProduct.fromJson(json),
              options: options(),
              lineId: id(6),
              thai: false,
              maximumQuantity: 3,
            ),
          ),
        ),
      );
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await tester.pumpAndSettle();
      final hero = find.byKey(const ValueKey('product-detail-hero'));
      expect(tester.getSize(hero), const Size(390, 238));
      expect(
        find.descendant(of: hero, matching: find.byType(RawImage)),
        findsOneWidget,
      );
      expect(
        tester
            .widget<RawImage>(
              find.descendant(of: hero, matching: find.byType(RawImage)),
            )
            .image,
        isNotNull,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, createHttpClient: (_) => _PhotoClient(bytes));
  });

  testWidgets(
    'entire exclusive option row selects and blank locale falls back',
    (tester) async {
      final data = options().toJson();
      final group = (data['groups'] as List).single as Map;
      group['nameEn'] = ' ';
      ((group['choices'] as List).first as Map)['nameEn'] = ' ';
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ProductOptionsSheet(
              product: product(),
              options: MobileProductOptions.fromJson(data),
              lineId: id(6),
              thai: false,
              maximumQuantity: 3,
            ),
          ),
        ),
      );
      expect(find.text('นม'), findsOneWidget);
      await tester.ensureVisible(find.text('โอ๊ต'));
      await tester.tap(find.text('โอ๊ต'));
      await tester.pump();
      expect(find.byTooltip('Decrease โอ๊ต'), findsOneWidget);
      await tester.tap(find.text('โอ๊ต'));
      await tester.pump();
      expect(find.byTooltip('Increase โอ๊ต'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  for (final thai in [true, false]) {
    testWidgets('compact chips narrow large text thai=$thai', (tester) async {
      await loadFonts(tester);
      await tester.binding.setSurfaceSize(const Size(320, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final json = options().toJson();
      for (final choice
          in ((json['groups'] as List).single as Map)['choices'] as List) {
        (choice as Map)['priceDelta'] = {
          'currency': 'USD',
          'decimals': 2,
          'amountMinor': '0',
        };
      }
      final boundary = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            theme: BitPosTheme.dark(),
            debugShowCheckedModeBanner: false,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: const TextScaler.linear(1.5)),
              child: child!,
            ),
            home: Scaffold(
              body: ProductOptionsSheet(
                product: product(),
                options: MobileProductOptions.fromJson(json),
                lineId: id(6),
                thai: thai,
                maximumQuantity: 3,
              ),
            ),
          ),
        ),
      );
      final chip = find.byKey(ValueKey('product-choice-${id(4)}'));
      await tester.ensureVisible(chip);
      await tester.tap(chip);
      await tester.pumpAndSettle();
      expect(tester.getSize(chip).height, greaterThanOrEqualTo(48));
      final out = Platform.environment['BITPOS_DS05_CAPTURE_DIR'];
      if (out != null) {
        final render =
            boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await render.toImage(pixelRatio: 1);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final f = File('$out/compact-$thai.png');
          await f.create(exclusive: true);
          await f.writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets(
    'zero-price exclusive groups use compact chips and retain required selection',
    (tester) async {
      final json = options().toJson();
      final choices =
          ((json['groups'] as List).single as Map)['choices'] as List;
      for (final choice in choices) {
        (choice as Map)['priceDelta'] = {
          'currency': 'USD',
          'decimals': 2,
          'amountMinor': '0',
        };
      }
      final compact = MobileProductOptions.fromJson(json);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ProductOptionsSheet(
              product: product(),
              options: compact,
              lineId: id(6),
              thai: false,
              maximumQuantity: 3,
            ),
          ),
        ),
      );
      await tester.ensureVisible(
        find.byKey(ValueKey('product-choice-${id(4)}')),
      );
      await tester.tap(find.byKey(ValueKey('product-choice-${id(4)}')));
      await tester.pump();
      expect(
        tester
            .widget<ChoiceChip>(find.byKey(ValueKey('product-choice-${id(4)}')))
            .selected,
        isTrue,
      );
      await tester.tap(find.byKey(ValueKey('product-choice-${id(5)}')));
      await tester.pump();
      expect(
        tester
            .widget<ChoiceChip>(find.byKey(ValueKey('product-choice-${id(4)}')))
            .selected,
        isFalse,
      );
      expect(
        tester
            .widget<ChoiceChip>(find.byKey(ValueKey('product-choice-${id(5)}')))
            .selected,
        isTrue,
      );
      await tester.tap(find.byKey(ValueKey('product-choice-${id(5)}')));
      await tester.pump();
      await tester.tap(find.text('Add to cart'));
      await tester.pump();
      expect(find.text('Choose 1–1 Milk per item.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('mixed denomination selection never displays a summed estimate', (
    tester,
  ) async {
    final group = options().groups.single;
    final invalid = MobileProductOptions(
      version: id(2),
      revision: '1',
      noteEnabled: false,
      groups: [
        MobileOptionGroup(
          id: group.id,
          name: group.name,
          nameEn: group.nameEn,
          enabled: true,
          minSelections: 1,
          maxSelections: 1,
          choices: [
            MobileOptionChoice(
              id: id(4),
              name: 'โอ๊ต',
              nameEn: 'Oat',
              enabled: true,
              maxQty: 1,
              priceDelta: MobileMoney(
                currency: 'USDG',
                decimals: 6,
                amountMinor: '350000',
              ),
            ),
          ],
        ),
      ],
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProductOptionsSheet(
            product: product(),
            options: invalid,
            lineId: id(6),
            thai: false,
            maximumQuantity: 3,
          ),
        ),
      ),
    );
    await tester.ensureVisible(find.byTooltip('Increase Oat'));
    await tester.tap(find.byTooltip('Increase Oat'));
    await tester.pump();
    expect(find.text('Estimate unavailable'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('product-detail-submit')),
          )
          .onPressed,
      isNull,
    );
    expect(tester.takeException(), isNull);
  });
  for (final variant in [
    (true, 390.0, 1.0, false),
    (false, 390.0, 1.0, false),
    (true, 320.0, 1.5, true),
    (false, 320.0, 1.5, true),
  ]) {
    testWidgets(
      'configured product visuals and keyboard action ${variant.$1}-${variant.$2}',
      (tester) async {
        await loadFonts(tester);
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(variant.$2, 844);
        addTearDown(tester.view.reset);
        final boundary = GlobalKey();
        final longPrice = !variant.$1 && variant.$2 == 320;
        final data = product().toJson();
        if (longPrice) {
          data['unitPrice'] = {
            'currency': 'USD',
            'decimals': 2,
            'amountMinor': '1234567890123456',
          };
          data['basePrice'] = data['unitPrice'];
        }
        final configuredProduct = MobileProduct.fromJson(data);

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
                body: ProductOptionsSheet(
                  product: configuredProduct,
                  options: options(),
                  lineId: id(6),
                  thai: variant.$1,
                  maximumQuantity: 3,
                ),
              ),
            ),
          ),
        );
        await tester.pump();
        final choice = find.byTooltip(
          variant.$1 ? 'เพิ่ม โอ๊ต' : 'Increase Oat',
        );
        await tester.ensureVisible(choice);
        await tester.tap(choice);
        await tester.pump();
        await tester.ensureVisible(
          find.byKey(const ValueKey('product-options-estimated-total')),
        );
        await tester.pumpAndSettle();
        final out = Platform.environment['BITPOS_DS05_CAPTURE_DIR'];
        if (out != null) {
          final render =
              boundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final image = await render.toImage(pixelRatio: 1);
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final file = File('$out/options-${variant.$1}-${variant.$2}.png');
            await file.create(exclusive: true);
            await file.writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
        expect(
          tester.getRect(find.byKey(const ValueKey('product-detail-back'))).top,
          greaterThanOrEqualTo(0),
        );
        expect(
          find.byKey(const ValueKey('product-detail-action-estimate')),
          findsOneWidget,
        );
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pump();
        final submit = find.byKey(const ValueKey('product-detail-submit'));
        expect(tester.getRect(submit).bottom, lessThanOrEqualTo(544));
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'estimate includes per-item selected additions and quantity without committing',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ProductOptionsSheet(
              product: product(),
              options: options(),
              lineId: id(6),
              thai: false,
              maximumQuantity: 3,
            ),
          ),
        ),
      );
      final estimate = find.byKey(
        const ValueKey('product-options-estimated-total'),
      );
      expect(tester.widget<Text>(estimate).data, contains('2.70'));
      await tester.ensureVisible(find.byTooltip('Increase Oat'));
      await tester.tap(find.byTooltip('Increase Oat'));
      await tester.pump();
      expect(tester.widget<Text>(estimate).data, contains('3.05'));
      await tester.ensureVisible(find.byTooltip('Increase product quantity'));
      await tester.tap(find.byTooltip('Increase product quantity'));
      await tester.pump();
      expect(tester.widget<Text>(estimate).data, contains('6.10'));
      await tester.ensureVisible(find.byTooltip('Increase Soy'));
      await tester.tap(find.byTooltip('Increase Soy'));
      await tester.pump();
      expect(tester.widget<Text>(estimate).data, contains('5.40'));
      expect(find.byType(ProductOptionsSheet), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'required selection blocks commit and latest exclusive choice replaces its peer',
    (tester) async {
      MobileConfiguredCartItem? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await showModalBottomSheet<MobileConfiguredCartItem>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => ProductOptionsSheet(
                      product: product(),
                      options: options(),
                      lineId: id(6),
                      thai: false,
                      maximumQuantity: 3,
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Add to cart'));
      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();
      expect(result, isNull);
      expect(find.byType(ProductOptionsSheet), findsOneWidget);
      await tester.ensureVisible(find.byTooltip('Increase Oat'));
      await tester.tap(find.byTooltip('Increase Oat'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Increase Soy'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Increase Oat'), findsOneWidget);
      expect(find.byTooltip('Decrease Soy'), findsOneWidget);
      await tester.ensureVisible(find.byTooltip('Increase product quantity'));
      await tester.tap(find.byTooltip('Increase product quantity'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Add to cart'));
      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();
      expect(result!.qty, 2);
      expect(result!.lineId, id(6));
      expect(result!.selections.single.choiceId, id(5));
      expect(result!.selections.single.qty, 1);
    },
  );
  testWidgets(
    'editing preserves line identity and a stale option version requires reselection',
    (tester) async {
      MobileConfiguredCartItem? result;
      final initial = MobileConfiguredCartItem(
        lineId: id(7),
        productId: id(1),
        qty: 2,
        optionVersion: id(99),
        selections: [
          MobileOptionSelection(groupId: id(3), choiceId: id(4), qty: 1),
        ],
        allergyNote: 'No dairy',
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await showModalBottomSheet<MobileConfiguredCartItem>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => ProductOptionsSheet(
                      product: product(),
                      options: options(),
                      lineId: id(8),
                      thai: false,
                      maximumQuantity: 3,
                      initial: initial,
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Save item'));
      await tester.tap(find.text('Save item'));
      await tester.pumpAndSettle();
      expect(result, isNull);
      await tester.ensureVisible(find.byTooltip('Increase Soy'));
      await tester.tap(find.byTooltip('Increase Soy'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Save item'));
      await tester.tap(find.text('Save item'));
      await tester.pumpAndSettle();
      expect(result!.lineId, id(7));
      expect(result!.optionVersion, id(2));
      expect(result!.allergyNote, 'No dairy');
      expect(result!.selections.single.choiceId, id(5));
      expect(result!.qty, 2);
    },
  );
  testWidgets(
    'optional exclusive choice can be deselected at narrow enlarged text',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final group = options().groups.single;
      final optional = MobileProductOptions(
        version: id(2),
        revision: '1',
        noteEnabled: false,
        groups: [
          MobileOptionGroup(
            id: group.id,
            name: group.name,
            nameEn: group.nameEn,
            enabled: true,
            minSelections: 0,
            maxSelections: 1,
            choices: group.choices,
          ),
        ],
      );
      MobileConfiguredCartItem? result;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(1.5)),
            child: child!,
          ),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await showModalBottomSheet<MobileConfiguredCartItem>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => ProductOptionsSheet(
                      product: product(),
                      options: optional,
                      lineId: id(6),
                      thai: false,
                      maximumQuantity: 3,
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Increase Oat'));
      await tester.tap(find.byTooltip('Increase Oat'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Decrease Oat'));
      await tester.tap(find.byTooltip('Decrease Oat'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Increase Oat'), findsOneWidget);
      await tester.ensureVisible(find.text('Add to cart'));
      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();
      expect(result!.selections, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'binary choices and repeatable steppers share the group quantity limit',
    (tester) async {
      final group = options().groups.single;
      final mixed = MobileProductOptions(
        version: id(2),
        revision: '1',
        noteEnabled: false,
        groups: [
          MobileOptionGroup(
            id: group.id,
            name: group.name,
            nameEn: group.nameEn,
            enabled: true,
            minSelections: 0,
            maxSelections: 2,
            choices: [
              ...group.choices,
              MobileOptionChoice(
                id: id(9),
                name: 'เพิ่ม',
                nameEn: 'Extra',
                enabled: true,
                maxQty: 2,
                priceDelta: MobileMoney(
                  currency: 'USD',
                  decimals: 2,
                  amountMinor: '10',
                ),
              ),
            ],
          ),
        ],
      );
      MobileConfiguredCartItem? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await showModalBottomSheet<MobileConfiguredCartItem>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => ProductOptionsSheet(
                      product: product(),
                      options: mixed,
                      lineId: id(6),
                      thai: false,
                      maximumQuantity: 3,
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Increase Extra'));
      await tester.tap(find.byTooltip('Increase Extra'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Increase Extra'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Increase Extra'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Increase Oat'));
      await tester.tap(find.byTooltip('Increase Oat'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Decrease Extra'));
      await tester.tap(find.byTooltip('Decrease Extra'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Increase Oat'));
      await tester.tap(find.byTooltip('Increase Oat'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Increase Soy'));
      await tester.tap(find.byTooltip('Increase Soy'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Decrease Oat'));
      await tester.tap(find.byTooltip('Decrease Oat'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Increase Soy'));
      await tester.tap(find.byTooltip('Increase Soy'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Add to cart'));
      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();
      expect(
        result!.selections.map((s) => s.choiceId),
        unorderedEquals([id(5), id(9)]),
      );
      expect(result!.selections.map((s) => s.qty), everyElement(1));
    },
  );
}
