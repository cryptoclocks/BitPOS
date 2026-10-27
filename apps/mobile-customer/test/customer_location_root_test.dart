import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'customer_onboarding_ui_test.dart' show loadFonts;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/customer_location_access.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_push_native.dart';
import 'package:bitpos_customer/presentation/customer_location_permission.dart';
import 'package:bitpos_customer/presentation/customer_notification_permission.dart';

import 'notification_owner_test.dart' show PushApi, PushNative;

class OnboardingApi extends PushApi {
  OnboardingApi() {
    owner = null;
  }
  @override
  Future<MobilePushStatus> pushStatus(
    MobilePushApp app,
    String installationKey,
  ) async => MobilePushStatus(
    installation: MobilePushUnregistered(kind: 'UNREGISTERED', revision: '0'),
    endpointEncryptionAvailable: true,
  );
  @override
  Future<void> requestOtp(String phone) async {}
  @override
  Future<void> verifyOtp(String phone, String code) async {
    owner = (
      accountId: '00000000-0000-4000-8000-000000000050',
      sessionId: '00000000-0000-4000-8000-000000000051',
    );
    scopes.add(owner);
  }
}

class GatedOtpApi extends OnboardingApi {
  int requests = 0, verifies = 0;
  final requested = Completer<void>();
  @override
  Future<void> requestOtp(String phone) async {
    requests++;
    await requested.future;
  }

  @override
  Future<void> verifyOtp(String phone, String code) async {
    verifies++;
    throw const MobileApiException('AUTH_REQUIRED', 401);
  }
}

class ConsentApi extends OnboardingApi {
  final commands = <MobilePushCommand>[];
  bool consent = false;
  int revision = 0;
  @override
  Future<MobilePushStatus> pushStatus(
    MobilePushApp app,
    String installationKey,
  ) async => MobilePushStatus(
    installation: revision == 0
        ? MobilePushUnregistered(kind: 'UNREGISTERED', revision: '0')
        : MobilePushRegistered(
            kind: 'REGISTERED',
            installationId: '00000000-0000-4000-8000-000000000087',
            bindingId: '00000000-0000-4000-8000-000000000088',
            revision: '$revision',
            generation: '$revision',
            boundToCurrentSession: true,
            consentEnabled: consent,
            capability: consent ? 'authorized' : 'denied',
            endpointRegistered: consent,
          ),
    endpointEncryptionAvailable: true,
  );
  @override
  Future<MobilePushReceipt> pushCommand(
    MobilePushApp app,
    MobilePushCommand command,
    String installationKey, {
    String? nextKey,
  }) async {
    commands.add(command);
    revision++;
    consent = command is MobilePushEnable;
    return MobilePushReceipt.fromJson({
      'installationId': '00000000-0000-4000-8000-000000000087',
      'bindingId': '00000000-0000-4000-8000-000000000088',
      'revision': '$revision',
      'generation': '$revision',
      'action': command.toJson()['kind'],
      'replayed': false,
    });
  }
}

class ConsentNative extends PushNative {
  ConsentNative(this.allowed);
  final bool allowed;
  int prompts = 0, registers = 0;
  final fids = StreamController<String>.broadcast(sync: true);
  @override
  bool get configured => true;
  @override
  Stream<String> get registrations => fids.stream;
  @override
  Future<MobilePushPermission> permission({bool request = false}) async {
    if (request) prompts++;
    return allowed
        ? MobilePushPermission.authorized
        : MobilePushPermission.denied;
  }

  @override
  Future<void> register() async {
    registers++;
    fids.add('local-fixture-fid');
  }

  @override
  Future<void> close() async {
    await fids.close();
    await super.close();
  }
}

class LocationAccess implements CustomerLocationAccess {
  int requests = 0, appSettings = 0, locationSettings = 0;
  bool settingsAvailable = true;
  final result = Completer<CustomerLocationStatus>();
  @override
  Future<CustomerLocationStatus> request() {
    requests++;
    return result.future;
  }

  @override
  Future<bool> openAppSettings() async {
    appSettings++;
    return settingsAvailable;
  }

  @override
  Future<bool> openLocationSettings() async {
    locationSettings++;
    return settingsAvailable;
  }
}

Future<void> captureOnboardingRoot(WidgetTester tester, String id) async {
  final out = Platform.environment['BITPOS_DS03_ROOT_CAPTURE_DIR'];
  if (out == null) return;
  await tester.pumpAndSettle();
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('customer-root-capture')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('$out/$id.png').writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

Future<void> signIn(
  WidgetTester tester,
  OnboardingApi api,
  LocationAccess location, {
  PushNative? native,
}) async {
  await loadFonts(tester);
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  FlutterSecureStorage.setMockInitialValues({});
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: BitPosTheme.light(),
      home: RepaintBoundary(
        key: const ValueKey('customer-root-capture'),
        child: CustomerSessionPage(
          api: api,
          pushNative: native ?? PushNative(),
          locationAccess: location,
        ),
      ),
    ),
  );
  expect(api.signedIn, false);
  await tester.pumpAndSettle();
  await tester.pump(const Duration(milliseconds: 1));
  final start = find.byKey(const ValueKey('customer-welcome-start'));
  await tester.ensureVisible(start);
  await tester.tap(start);
  await tester.pumpAndSettle();
  await captureOnboardingRoot(tester, 'U02-root');
  await tester.enterText(find.byType(TextFormField), '+66900000001');
  await tester.ensureVisible(find.text('ขอรหัสเข้าสู่ระบบ'));
  await tester.tap(find.text('ขอรหัสเข้าสู่ระบบ'));
  await tester.pumpAndSettle();
  expect(find.byType(TextFormField), findsOneWidget);
  await captureOnboardingRoot(tester, 'U03-root');
  await tester.enterText(find.byType(TextFormField), '123456');
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('ยืนยันรหัส'));
  await tester.tap(find.text('ยืนยันรหัส'));
  await tester.pumpAndSettle();
  expect(find.byType(CustomerLocationPermission), findsOneWidget);
  expect(location.requests, 0);
}

void main() {
  for (final status in [
    CustomerLocationStatus.granted,
    CustomerLocationStatus.permanentlyDenied,
    CustomerLocationStatus.servicesOff,
  ]) {
    testWidgets(
      'location settings and notification back preserve explicit consent $status',
      (tester) async {
        final api = ConsentApi(),
            native = ConsentNative(true),
            location = LocationAccess();
        await signIn(tester, api, location, native: native);
        tester
            .widget<CustomerLocationPermission>(
              find.byType(CustomerLocationPermission),
            )
            .onAllow();
        await tester.pump();
        location.result.complete(status);
        await tester.pumpAndSettle();
        if (status != CustomerLocationStatus.granted) {
          var page = tester.widget<CustomerLocationPermission>(
            find.byType(CustomerLocationPermission),
          );
          expect(page.status, status);
          page.onSettings();
          await tester.pumpAndSettle();
          expect(
            location.appSettings,
            status == CustomerLocationStatus.permanentlyDenied ? 1 : 0,
          );
          expect(
            location.locationSettings,
            status == CustomerLocationStatus.servicesOff ? 1 : 0,
          );
          expect(
            find.byType(CustomerLocationPermission),
            findsOneWidget,
            reason: 'opening Settings is not a permission grant',
          );
          location.settingsAvailable = false;
          tester
              .widget<CustomerLocationPermission>(
                find.byType(CustomerLocationPermission),
              )
              .onSettings();
          await tester.pumpAndSettle();
          page = tester.widget<CustomerLocationPermission>(
            find.byType(CustomerLocationPermission),
          );
          expect(page.status, CustomerLocationStatus.error);
          expect(page.busy, false);
          page.onSkip();
          await tester.pumpAndSettle();
        }
        expect(find.byType(CustomerNotificationPermission), findsOneWidget);
        expect(native.prompts, 0);
        tester
            .widget<CustomerNotificationPermission>(
              find.byType(CustomerNotificationPermission),
            )
            .onBack();
        await tester.pumpAndSettle();
        expect(find.byType(CustomerLocationPermission), findsOneWidget);
        tester
            .widget<CustomerLocationPermission>(
              find.byType(CustomerLocationPermission),
            )
            .onBack();
        await tester.pumpAndSettle();
        expect(find.byType(CustomerNotificationPermission), findsOneWidget);
        expect(native.prompts, 0);
        expect(api.commands, isEmpty);
        tester
            .widget<CustomerNotificationPermission>(
              find.byType(CustomerNotificationPermission),
            )
            .onSkip();
        await tester.pumpAndSettle();
        expect(find.byType(CustomerNotificationPermission), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final variant in [
    (true, 390.0, 1.0, false),
    (false, 390.0, 1.0, false),
    (true, 320.0, 1.5, true),
    (false, 1280.0, 1.5, false),
  ]) {
    testWidgets(
      'root phone OTP keyboard failure back ${variant.$1}-${variant.$2}',
      (tester) async {
        await loadFonts(tester);
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(variant.$2, 844);
        addTearDown(tester.view.reset);
        FlutterSecureStorage.setMockInitialValues({});
        final api = GatedOtpApi();
        await tester.pumpWidget(
          MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: variant.$4 ? BitPosTheme.dark() : BitPosTheme.light(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(variant.$3)),
              child: child!,
            ),
            home: RepaintBoundary(
              key: const ValueKey('customer-root-capture'),
              child: CustomerSessionPage(
                api: api,
                pushNative: PushNative(),
                locationAccess: LocationAccess(),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        if (!variant.$1) {
          await tester.tap(find.text('English'));
          await tester.pumpAndSettle();
        }
        final start = find.byKey(const ValueKey('customer-welcome-start'));
        await tester.scrollUntilVisible(
          start,
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.tap(start);
        await tester.pumpAndSettle();
        final info = find.byKey(const ValueKey('customer-sign-in-information'));
        await tester.ensureVisible(info);
        await tester.tap(info);
        await tester.pumpAndSettle();
        expect(
          find.text(
            variant.$1 ? 'ข้อมูลและสิทธิ์ของคุณ' : 'Your data and permissions',
          ),
          findsOneWidget,
        );
        final close = find.text(variant.$1 ? 'ปิด' : 'Close');
        await tester.ensureVisible(close);
        await tester.tap(close);
        await tester.pumpAndSettle();
        expect(
          api.requests,
          0,
          reason: 'information sheet does not request OTP or grant permissions',
        );
        final send = find.text(
          variant.$1 ? 'ขอรหัสเข้าสู่ระบบ' : 'Send sign-in code',
        );
        await tester.ensureVisible(send);
        await tester.tap(send);
        await tester.pumpAndSettle();
        expect(api.requests, 0, reason: 'invalid phone never reaches API');
        await tester.enterText(find.byType(TextFormField), '+66900000001');
        await captureOnboardingRoot(tester, 'U02-${variant.$1}-${variant.$2}');
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();
        await tester.ensureVisible(send);
        await tester.tap(send);
        await tester.pump();
        expect(api.requests, 1);
        expect(
          tester
              .widget<FilledButton>(find.byType(FilledButton).first)
              .onPressed,
          isNull,
        );
        api.requested.complete();
        await tester.pumpAndSettle();
        tester.view.resetViewInsets();
        await tester.pumpAndSettle();
        final verify = find.text(variant.$1 ? 'ยืนยันรหัส' : 'Verify code');
        await tester.enterText(find.byType(TextFormField), '123456');
        await tester.ensureVisible(verify);
        await tester.tap(verify);
        await tester.pumpAndSettle();
        expect(api.verifies, 1);
        expect(
          find.text(
            variant.$1
                ? 'กรุณาเข้าสู่ระบบใหม่หรือใช้รหัสที่ถูกต้อง'
                : 'Sign in again or check your verification code',
          ),
          findsOneWidget,
        );
        await captureOnboardingRoot(
          tester,
          'U03-error-${variant.$1}-${variant.$2}',
        );
        final back = find.byTooltip(variant.$1 ? 'ย้อนกลับ' : 'Back');
        await tester.tap(back);
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<TextFormField>(find.byType(TextFormField))
              .controller!
              .text,
          '+66900000001',
        );
        expect(api.requests, 1, reason: 'back does not resend');
        await tester.tap(back);
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('customer-welcome-start')),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  for (final allowed in [false, true]) {
    testWidgets(
      'notification explicit consent allowed=$allowed stays owner-bound',
      (tester) async {
        final api = ConsentApi(),
            native = ConsentNative(allowed),
            location = LocationAccess();
        await signIn(tester, api, location, native: native);
        tester
            .widget<CustomerLocationPermission>(
              find.byType(CustomerLocationPermission),
            )
            .onSkip();
        await tester.pumpAndSettle();
        expect(native.prompts, 0);
        expect(api.commands, isEmpty);
        final page = tester.widget<CustomerNotificationPermission>(
          find.byType(CustomerNotificationPermission),
        );
        expect(page.available, true);
        page.onAllow();
        page.onAllow();
        await tester.pumpAndSettle();
        expect(
          native.prompts,
          1,
          reason: 'double tap never duplicates OS consent',
        );
        expect(native.registers, allowed ? 1 : 0);
        expect(
          api.commands.whereType<MobilePushEnable>().length,
          allowed ? 1 : 0,
        );
        if (allowed) {
          expect(find.byType(CustomerNotificationPermission), findsNothing);
          expect(api.consent, true);
        } else {
          final denied = tester.widget<CustomerNotificationPermission>(
            find.byType(CustomerNotificationPermission),
          );
          expect(denied.enabled, false);
          expect(denied.busy, false);
          denied.onSkip();
          await tester.pumpAndSettle();
          expect(find.byType(CustomerNotificationPermission), findsNothing);
          expect(api.consent, false);
        }
        await tester.pumpWidget(const SizedBox.shrink());
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'explicit OTP opens optional permission; denial does not advance; skip does',
    (tester) async {
      final api = OnboardingApi(), location = LocationAccess();
      await signIn(tester, api, location);
      var page = tester.widget<CustomerLocationPermission>(
        find.byType(CustomerLocationPermission),
      );
      page.onAllow();
      page.onAllow();
      await tester.pump();
      expect(location.requests, 1);
      location.result.complete(CustomerLocationStatus.denied);
      await tester.pumpAndSettle();
      page = tester.widget<CustomerLocationPermission>(
        find.byType(CustomerLocationPermission),
      );
      expect(page.status, CustomerLocationStatus.denied);
      expect(page.busy, false);
      page.onSkip();
      await tester.pumpAndSettle();
      expect(find.byType(CustomerLocationPermission), findsNothing);
      expect(api.signedIn, true);
      final notifications = tester.widget<CustomerNotificationPermission>(
        find.byType(CustomerNotificationPermission),
      );
      expect(notifications.available, false);
      expect(notifications.enabled, false);
      await captureOnboardingRoot(tester, 'U05-root-unavailable');
      notifications.onSkip();
      await tester.pumpAndSettle();
      expect(find.byType(CustomerNotificationPermission), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
  testWidgets(
    'permission result cannot re-enter app after session retirement',
    (tester) async {
      final api = OnboardingApi(), location = LocationAccess();
      await signIn(tester, api, location);
      tester
          .widget<CustomerLocationPermission>(
            find.byType(CustomerLocationPermission),
          )
          .onAllow();
      await tester.pump();
      api.owner = null;
      api.scopes.add(null);
      await tester.pump();
      location.result.complete(CustomerLocationStatus.granted);
      await tester.pumpAndSettle();
      expect(find.byType(CustomerLocationPermission), findsNothing);
      expect(find.byType(TextFormField), findsOneWidget);
      expect(api.signedIn, false);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
