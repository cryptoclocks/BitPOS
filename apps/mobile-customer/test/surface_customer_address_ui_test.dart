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
  for (final variant
      in native
          ? [(thai: true, dark: false, width: 390.0, scale: 1.0)]
          : [
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
      final boundary = GlobalKey();
      Future<void> mount(Widget child) async {
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
        await tester.pumpAndSettle();
      }

      Map<String, double> rect(Finder f) {
        final r = tester.getRect(f.first);
        return {'x': r.left, 'y': r.top, 'w': r.width, 'h': r.height};
      }

      Future<void> capture(String screen, Map<String, dynamic> geometry) async {
        await tester.pump();
        expect(tester.takeException(), isNull, reason: '$screen $name');
        final record = {
          'screen': screen,
          'variant': name,
          'native': native,
          'viewport': {
            'w': tester.view.physicalSize.width / tester.view.devicePixelRatio,
            'h': tester.view.physicalSize.height / tester.view.devicePixelRatio,
          },
          ...geometry,
        };
        debugPrint('BITPOS_ADDRESS_GEOMETRY ${jsonEncode(record)}');
        if (native) {
          debugPrint('BITPOS_ADDRESS_CAPTURE $screen-$name');
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(seconds: 3)),
          );
        } else {
          const directory = String.fromEnvironment('BITPOS_UI_CAPTURE_DIR');
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
      expect(tester.getRect(card).left, 24);
      if (variant.scale == 1) {
        expect(tester.getRect(card).top, closeTo(139, .01));
        // InkWell includes its own12dp trailing gap, not extra visible card height.
        expect(tester.getRect(card).height - 12, closeTo(82, .01));
      }
      await tap(find.byKey(ValueKey('delivery-address-${outside.id}')));
      expect(find.byType(DeliveryAddressPickerPage), findsOneWidget);

      final api = AddressSurfaceApi();
      final owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      await mount(
        AccountPage(
          api: api,
          owner: owner,
          thai: variant.thai,
          onAuthenticationRequired: () {},
          onNavigate: (_) {},
        ),
      );
      await tap(find.text(variant.thai ? 'ที่อยู่ของฉัน' : 'My addresses'));
      await capture('U12-saved', {
        'firstCard': rect(find.byType(SavedAddressCard)),
      });
      await tap(find.text(variant.thai ? 'แก้ไข' : 'Edit'));
      final fields = find.byType(TextFormField);
      expect(fields, findsNWidgets(4));
      await capture('U13', {
        'place': rect(fields.at(0)),
        'address': rect(fields.at(1)),
        'recipient': rect(fields.at(2)),
        'instructions': rect(fields.at(3)),
      });
      // No input field is horizontally clipped; accessibility text may grow vertically.
      for (var i = 0; i < 4; i++) {
        expect(tester.getRect(fields.at(i)).left, 24);
        expect(
          tester.getRect(fields.at(i)).right,
          closeTo(variant.width - 24, .01),
        );
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
