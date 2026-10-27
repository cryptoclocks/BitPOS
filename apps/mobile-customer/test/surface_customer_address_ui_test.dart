import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_customer/account_page.dart';
import 'package:bitpos_customer/address_pin_page.dart';
import 'package:bitpos_customer/delivery_address_picker_page.dart';
import 'package:bitpos_customer/presentation/saved_address_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'account_reload_test.dart' show ReloadAccountApi;
import 'delivery_address_picker_page_test.dart' as fixture;

class AddressSurfaceApi extends ReloadAccountApi {
  bool empty = false, fail = false;
  Completer<void>? loading;
  @override
  bool get signedIn => true;
  @override
  Future<MobileAddresses> addresses({String? cursor}) async {
    await loading?.future;
    if (fail) throw const MobileApiException('NETWORK', 503);
    return MobileAddresses(
      addresses: empty
          ? []
          : [
              fixture.address(1, label: 'Home'),
              fixture.address(2, label: 'Office'),
            ],
      nextCursor: null,
    );
  }
}

void main() => registerAddressSurfaceTests();

void registerAddressSurfaceTests({bool native = false}) {
  if (native) {
    _registerNativeAddressSurfaceTests();
    return;
  }
  for (final variant in [
    (thai: true, dark: false, width: 390.0, scale: 1.0),
    (thai: false, dark: false, width: 390.0, scale: 1.0),
    (thai: true, dark: true, width: 320.0, scale: 1.5),
    (thai: false, dark: true, width: 390.0, scale: 1.5),
  ]) {
    final name =
        '${variant.thai ? 'th' : 'en'}-${variant.dark ? 'dark' : 'light'}-${variant.width.toInt()}-${variant.scale}';
    testWidgets('U12 U13 U14 real address surfaces $name', (tester) async {
      if (!native) {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(variant.width, 844);
        addTearDown(tester.view.reset);
        for (final family in ['NotoSansThai', 'Inter']) {
          await (FontLoader('packages/mobile_shared/$family')..addFont(
                rootBundle.load(
                  'packages/mobile_shared/assets/fonts/$family-Variable.ttf',
                ),
              ))
              .load();
        }
        await (FontLoader(
          'MaterialIcons',
        )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
      }
      void stage(String name) => debugPrint('BITPOS_ADDRESS_STAGE $name');

      try {
        final boundary = GlobalKey();
        Future<void> mount(Widget child, {bool tracePumps = false}) async {
          await tester.pumpWidget(
            RepaintBoundary(
              key: boundary,
              child: MaterialApp(
                debugShowCheckedModeBanner: false,
                theme: variant.dark ? BitPosTheme.dark() : BitPosTheme.light(),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context).copyWith(
                    textScaler: TextScaler.linear(variant.scale),
                    padding: native
                        ? MediaQuery.of(context).padding
                        : const EdgeInsets.only(top: 44, bottom: 24),
                    viewPadding: native
                        ? MediaQuery.of(context).viewPadding
                        : const EdgeInsets.only(top: 44, bottom: 24),
                  ),
                  child: child!,
                ),
                home: child,
              ),
            ),
          );
          if (tracePumps) stage('PUMP_WIDGET_DONE');
          if (tracePumps) stage('PUMP_SETTLE_BEGIN');
          await tester.pumpAndSettle();
          if (tracePumps) stage('PUMP_SETTLE_DONE');
        }

        Map<String, double> rect(Finder f) {
          final r = tester.getRect(f.first);
          return {'x': r.left, 'y': r.top, 'w': r.width, 'h': r.height};
        }

        var nativeScreenshotReady = false;

        Future<void> capture(
          String screen,
          Map<String, dynamic> geometry,
        ) async {
          await tester.pump();
          expect(tester.takeException(), isNull, reason: '$screen $name');
          const directory = String.fromEnvironment('BITPOS_UI_CAPTURE_DIR');
          final record = {
            'screen': screen,
            'variant': name,
            'native': native,
            'viewport': {
              'w':
                  tester.view.physicalSize.width / tester.view.devicePixelRatio,
              'h':
                  tester.view.physicalSize.height /
                  tester.view.devicePixelRatio,
              'insets': {
                'top':
                    tester.view.viewInsets.top / tester.view.devicePixelRatio,
                'right':
                    tester.view.viewInsets.right / tester.view.devicePixelRatio,
                'bottom':
                    tester.view.viewInsets.bottom /
                    tester.view.devicePixelRatio,
                'left':
                    tester.view.viewInsets.left / tester.view.devicePixelRatio,
              },
            },
            ...geometry,
          };
          debugPrint('BITPOS_ADDRESS_GEOMETRY ${jsonEncode(record)}');
          if (native) {
            final binding = IntegrationTestWidgetsFlutterBinding.instance;
            if (!nativeScreenshotReady) {
              await binding.convertFlutterSurfaceToImage();
              await tester.pump();
              nativeScreenshotReady = true;
            }
            await binding.takeScreenshot('customer-address-$screen-$name');
            debugPrint('BITPOS_ADDRESS_CAPTURE $screen-$name');
          } else {
            if (directory.isNotEmpty) {
              await tester.runAsync(() async {
                final image =
                    await (boundary.currentContext!.findRenderObject()
                            as RenderRepaintBoundary)
                        .toImage(pixelRatio: 1);
                final data = await image.toByteData(
                  format: ui.ImageByteFormat.png,
                );
                await File('$directory/$screen-$name.png')
                    .writeAsBytes(data!.buffer.asUint8List());
                await File('$directory/$screen-$name.json')
                    .writeAsString(jsonEncode(record));
                image.dispose();
              });
            }
          }
        }

        Future<void> tap(Finder f) async {
          await tester.ensureVisible(f.first);
          await tester.pumpAndSettle();
          await tester.tap(f.first);
          await tester.pumpAndSettle();
        }

        final home = fixture.address(1, label: 'Home');
        final outside = fixture.address(2, label: 'Office');
        await mount(
          DeliveryAddressPickerPage(
            addresses: [home, outside],
            selected: null,
            thai: variant.thai,
            isEligible: (a) => a.id == home.id,
            onAddAddress: () async => [home, outside],
            hasMore: () => false,
            onLoadMore: () async => [home, outside],
            onNavigate: (_) async {},
          ),
        );
        final card = find.byKey(ValueKey('delivery-address-${home.id}'));
        await capture('U12-selection', {
          'firstCard': rect(card),
          'add': rect(find.widgetWithIcon(OutlinedButton, Icons.add)),
        });
        stage('U12_ASSERTIONS_BEGIN');
        expect(tester.getRect(card).left, 24);
        if (variant.scale == 1) {
          final expectedCardTop = native
              ? tester
                        .getRect(
                          find.descendant(
                            of: find.byType(DeliveryAddressPickerPage),
                            matching: find.byType(ListView),
                          ),
                        )
                        .top +
                    27
              : 139.0;
          expect(tester.getRect(card).top, closeTo(expectedCardTop, .01));
          // InkWell includes its own12dp trailing gap, not extra visible card height.
          expect(tester.getRect(card).height - 12, closeTo(82, .01));
        }
        stage('U12_ASSERTIONS_DONE');
        stage('U12_TAP_OUTSIDE_BEGIN');
        await tap(find.byKey(ValueKey('delivery-address-${outside.id}')));
        stage('U12_TAP_OUTSIDE_DONE');
        expect(find.byType(DeliveryAddressPickerPage), findsOneWidget);

        final api = AddressSurfaceApi();
        final owner = ValueNotifier(true);
        addTearDown(api.close);
        addTearDown(owner.dispose);
        stage('MOUNT_ACCOUNT_BEGIN');
        await mount(
          AccountPage(
            api: api,
            owner: owner,
            thai: variant.thai,
            onAuthenticationRequired: () {},
            onNavigate: (_) {},
          ),
          tracePumps: true,
        );
        await tap(find.text(variant.thai ? 'ที่อยู่ของฉัน' : 'My addresses'));
        await capture('U12-saved', {
          'firstCard': rect(find.byType(SavedAddressCard)),
        });
        await tap(find.text(variant.thai ? 'แก้ไข' : 'Edit'));
        final fields = find.byType(TextFormField);
        expect(fields, findsNWidgets(5));
        await capture('U13', {
          'place': rect(fields.at(0)),
          'address': rect(fields.at(1)),
          'recipient': rect(fields.at(2)),
          'phone': rect(fields.at(3)),
          'instructions': rect(fields.at(4)),
        });
        // No input field is horizontally clipped; accessibility text may grow vertically.
        for (var i = 0; i < 5; i++) {
          expect(tester.getRect(fields.at(i)).left, 24);
          final right = native
              ? tester.view.physicalSize.width / tester.view.devicePixelRatio -
                    24
              : variant.width - 24;
          expect(tester.getRect(fields.at(i)).right, closeTo(right, .01));
        }
        await tap(
          find.widgetWithIcon(OutlinedButton, Icons.location_on_outlined),
        );
        expect(find.byType(AddressPinPage), findsOneWidget);
        await capture('U14-unconfigured', {
          'sheet': rect(find.byKey(const ValueKey('address-pin-sheet'))),
          'confirm': rect(find.byKey(const ValueKey('address-pin-confirm'))),
        });
        expect(
          tester
              .getRect(find.byKey(const ValueKey('address-pin-longitude')))
              .bottom,
          lessThanOrEqualTo(
            tester
                    .getRect(find.byKey(const ValueKey('address-pin-confirm')))
                    .top -
                12,
          ),
        );
        expect(
          find.text(
            variant.thai ? 'แผนที่ยังไม่พร้อมใช้งาน' : 'Map is unavailable',
          ),
          findsOneWidget,
        );
        if (native) {
          await tap(find.byKey(const ValueKey('address-pin-latitude')));
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 500)),
          );
          await tester.pumpAndSettle();
          final pinContext = tester.element(find.byType(AddressPinPage));
          final inset = MediaQuery.viewInsetsOf(pinContext).bottom;
          await capture('U14-native-input', {
            'keyboardInset': inset,
            'confirm': rect(find.byKey(const ValueKey('address-pin-confirm'))),
          });
        }
        await tester.enterText(
          find.byKey(const ValueKey('address-pin-latitude')),
          '91',
        );
        if (!native) {
          tester.view.viewInsets = const FakeViewPadding(bottom: 300);
          await tester.pumpAndSettle();
          final confirm = find.byKey(const ValueKey('address-pin-confirm'));
          expect(tester.getRect(confirm).bottom, lessThanOrEqualTo(544));
          await capture('U14-keyboard-inset', {'confirm': rect(confirm)});
          tester.view.resetViewInsets();
          await tester.pumpAndSettle();
        }
        await tester.enterText(
          find.byKey(const ValueKey('address-pin-longitude')),
          '100.5',
        );
        await tap(find.byKey(const ValueKey('address-pin-confirm')));
        expect(find.byType(AddressPinPage), findsOneWidget);
        expect(
          find.text(
            variant.thai ? 'ระบุพิกัดที่ถูกต้อง' : 'Enter a valid coordinate',
          ),
          findsOneWidget,
        );
        await tester.enterText(
          find.byKey(const ValueKey('address-pin-latitude')),
          '13.7563',
        );
        await tester.enterText(
          find.byKey(const ValueKey('address-pin-longitude')),
          '100.5018',
        );
        await tap(find.byKey(const ValueKey('address-pin-confirm')));
        expect(find.byType(AddressPinPage), findsNothing);
        // Returning coordinates edits only local input; it must not send an address mutation.
        expect(api.submitted, isEmpty);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      } catch (error, stackTrace) {
        stage('FAILURE');
        Error.throwWithStackTrace(error, stackTrace);
      } finally {
        stage('FINALLY');
      }
    });
  }

  testWidgets('U12 loading empty error and reload recover without fake rows', (
    tester,
  ) async {
    final api = AddressSurfaceApi()..loading = Completer<void>();
    final owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: AccountPage(
          api: api,
          owner: owner,
          thai: false,
          onAuthenticationRequired: () {},
        ),
      ),
    );
    await tester.pump();
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    api.empty = true;
    api.loading!.complete();
    await tester.pumpAndSettle();
    expect(find.text('No saved addresses yet.'), findsOneWidget);
    expect(find.byType(SavedAddressCard), findsNothing);
    api.fail = true;
    await tester.ensureVisible(find.text('Reload server details'));
    await tester.tap(find.text('Reload server details'));
    await tester.pumpAndSettle();
    expect(find.byType(SavedAddressCard), findsNothing);
    api.fail = false;
    api.empty = false;
    await tester.tap(find.text('Reload server details'));
    await tester.pumpAndSettle();
    final second = find.byKey(ValueKey(fixture.address(2, label: 'Office').id));
    await tester.scrollUntilVisible(
      second,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Office'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
}

void _registerNativeAddressSurfaceTests() {
  for (final thai in [true, false]) {
    final locale = thai ? 'th' : 'en';
    final name = 'native-$locale-light-scale1.0';
    final home = fixture.address(1, label: 'Home');
    final outside = fixture.address(2, label: 'Office');

    testWidgets('U12 selection $name', (tester) async {
      await _nativeMount(
        tester,
        DeliveryAddressPickerPage(
          addresses: [home, outside],
          selected: null,
          thai: thai,
          isEligible: (address) => address.id == home.id,
          onAddAddress: () async => [home, outside],
          hasMore: () => false,
          onLoadMore: () async => [home, outside],
          onNavigate: (_) async {},
        ),
      );
      final card = find.byKey(ValueKey('delivery-address-${home.id}'));
      expect(tester.getRect(card).left, 24);
      final list = find.descendant(
        of: find.byType(DeliveryAddressPickerPage),
        matching: find.byType(ListView),
      );
      expect(
        tester.getRect(card).top,
        closeTo(tester.getRect(list).top + 27, .01),
      );
      expect(tester.getRect(card).height - 12, closeTo(82, .01));
      await _nativeTap(
        tester,
        find.byKey(ValueKey('delivery-address-${outside.id}')),
      );
      expect(find.byType(DeliveryAddressPickerPage), findsOneWidget);
      await _nativeCapture(tester, 'U12-selection', name, {
        'firstCard': _rect(tester, card),
        'add': _rect(tester, find.widgetWithIcon(OutlinedButton, Icons.add)),
      });
    });

    testWidgets('U12 saved $name', (tester) async {
      await _nativeOpenAddresses(tester, thai);
      final card = find.byType(SavedAddressCard);
      expect(card, findsNWidgets(2));
      await _nativeCapture(tester, 'U12-saved', name, {
        'firstCard': _rect(tester, card),
      });
    });

    testWidgets('U13 editor $name', (tester) async {
      await _nativeOpenAddresses(tester, thai);
      await _nativeTap(tester, find.text(thai ? 'แก้ไข' : 'Edit'));
      final fields = find.byType(TextFormField);
      expect(fields, findsNWidgets(5));
      for (var i = 0; i < 5; i++) {
        expect(tester.getRect(fields.at(i)).left, 24);
        expect(
          tester.getRect(fields.at(i)).right,
          closeTo(
            tester.view.physicalSize.width / tester.view.devicePixelRatio - 24,
            .01,
          ),
        );
      }
      await _nativeCapture(tester, 'U13', name, {
        'place': _rect(tester, fields.at(0)),
        'address': _rect(tester, fields.at(1)),
        'recipient': _rect(tester, fields.at(2)),
        'phone': _rect(tester, fields.at(3)),
        'instructions': _rect(tester, fields.at(4)),
      });
    });

    testWidgets('U14 unconfigured $name', (tester) async {
      await _nativeOpenEditor(tester, thai);
      await _nativeTap(
        tester,
        find.widgetWithIcon(OutlinedButton, Icons.location_on_outlined),
      );
      expect(find.byType(AddressPinPage), findsOneWidget);
      final confirm = find.byKey(const ValueKey('address-pin-confirm'));
      expect(
        tester
            .getRect(find.byKey(const ValueKey('address-pin-longitude')))
            .bottom,
        lessThanOrEqualTo(tester.getRect(confirm).top - 12),
      );
      expect(
        find.text(thai ? 'แผนที่ยังไม่พร้อมใช้งาน' : 'Map is unavailable'),
        findsOneWidget,
      );
      await _nativeCapture(tester, 'U14-unconfigured', name, {
        'sheet': _rect(tester, find.byKey(const ValueKey('address-pin-sheet'))),
        'confirm': _rect(tester, confirm),
      });
    });

    testWidgets('U14 native confirmation $name', (tester) async {
      final api = await _nativeOpenEditor(tester, thai);
      await _nativeTap(
        tester,
        find.widgetWithIcon(OutlinedButton, Icons.location_on_outlined),
      );
      await tester.enterText(
        find.byKey(const ValueKey('address-pin-latitude')),
        '91',
      );
      await tester.enterText(
        find.byKey(const ValueKey('address-pin-longitude')),
        '100.5',
      );
      await _nativeTap(
        tester,
        find.byKey(const ValueKey('address-pin-confirm')),
      );
      expect(find.byType(AddressPinPage), findsOneWidget);
      expect(
        find.text(thai ? 'ระบุพิกัดที่ถูกต้อง' : 'Enter a valid coordinate'),
        findsOneWidget,
      );
      await tester.enterText(
        find.byKey(const ValueKey('address-pin-latitude')),
        '13.7563',
      );
      await tester.enterText(
        find.byKey(const ValueKey('address-pin-longitude')),
        '100.5018',
      );
      await _nativeTap(
        tester,
        find.byKey(const ValueKey('address-pin-confirm')),
      );
      expect(find.byType(AddressPinPage), findsNothing);
      expect(api.submitted, isEmpty);
    });

    testWidgets('U14 native input $name', (tester) async {
      await _nativeOpenEditor(tester, thai);
      await _nativeTap(
        tester,
        find.widgetWithIcon(OutlinedButton, Icons.location_on_outlined),
      );
      await _nativeTap(
        tester,
        find.byKey(const ValueKey('address-pin-latitude')),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 500)),
      );
      await tester.pumpAndSettle();
      final pinContext = tester.element(find.byType(AddressPinPage));
      final inset = MediaQuery.viewInsetsOf(pinContext).bottom;
      final confirm = find.byKey(const ValueKey('address-pin-confirm'));
      final logicalHeight =
          tester.view.physicalSize.height / tester.view.devicePixelRatio;
      expect(inset, greaterThan(0));
      expect(
        tester.getRect(confirm).bottom,
        lessThanOrEqualTo(logicalHeight - inset),
      );
      await _nativeCapture(tester, 'U14-native-input', name, {
        'keyboardInset': inset,
        'confirm': _rect(tester, confirm),
      });
    });
  }
}

Future<void> _nativeMount(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: BitPosTheme.light(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(1)),
        child: child!,
      ),
      home: child,
    ),
  );
  await tester.pumpAndSettle();
}

Future<AddressSurfaceApi> _nativeOpenAddresses(
  WidgetTester tester,
  bool thai,
) async {
  final api = AddressSurfaceApi();
  final owner = ValueNotifier(true);
  addTearDown(api.close);
  addTearDown(owner.dispose);
  debugPrint('BITPOS_ADDRESS_STAGE MOUNT_ACCOUNT_BEGIN');
  await _nativeMount(
    tester,
    AccountPage(
      api: api,
      owner: owner,
      thai: thai,
      onAuthenticationRequired: () {},
      onNavigate: (_) {},
    ),
  );
  debugPrint('BITPOS_ADDRESS_STAGE PUMP_WIDGET_DONE');
  await _nativeTap(tester, find.text(thai ? 'ที่อยู่ของฉัน' : 'My addresses'));
  return api;
}

Future<AddressSurfaceApi> _nativeOpenEditor(
  WidgetTester tester,
  bool thai,
) async {
  final api = await _nativeOpenAddresses(tester, thai);
  await _nativeTap(tester, find.text(thai ? 'แก้ไข' : 'Edit'));
  expect(find.byType(TextFormField), findsNWidgets(5));
  return api;
}

Future<void> _nativeTap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder.first);
  await tester.pumpAndSettle();
  await tester.tap(finder.first);
  await tester.pumpAndSettle();
}

Map<String, double> _rect(WidgetTester tester, Finder finder) {
  final rect = tester.getRect(finder.first);
  return {'x': rect.left, 'y': rect.top, 'w': rect.width, 'h': rect.height};
}

Future<void> _nativeCapture(
  WidgetTester tester,
  String screen,
  String name,
  Map<String, dynamic> geometry,
) async {
  await tester.pump();
  expect(tester.takeException(), isNull, reason: '$screen $name');
  final record = {
    'screen': screen,
    'variant': name,
    'native': true,
    'viewport': {
      'w': tester.view.physicalSize.width / tester.view.devicePixelRatio,
      'h': tester.view.physicalSize.height / tester.view.devicePixelRatio,
      'insets': {
        'top': tester.view.viewInsets.top / tester.view.devicePixelRatio,
        'right': tester.view.viewInsets.right / tester.view.devicePixelRatio,
        'bottom': tester.view.viewInsets.bottom / tester.view.devicePixelRatio,
        'left': tester.view.viewInsets.left / tester.view.devicePixelRatio,
      },
    },
    ...geometry,
  };
  debugPrint('BITPOS_ADDRESS_GEOMETRY ${jsonEncode(record)}');
  final binding = IntegrationTestWidgetsFlutterBinding.instance;
  await binding.convertFlutterSurfaceToImage();
  await tester.pump();
  await binding.takeScreenshot('customer-address-$screen-$name');
  debugPrint('BITPOS_ADDRESS_CAPTURE $screen-$name');
}
