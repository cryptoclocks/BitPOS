import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/services.dart';

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_driver/main.dart';

class SignInApi extends MobileApi {
  SignInApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  final requested = <String>[], verified = <String>[];
  @override
  bool get signedIn => false;
  @override
  Future<void> restore() async {}
  @override
  Future<void> requestOtp(String phone) async {
    requested.add(phone);
  }

  @override
  Future<void> verifyOtp(String phone, String code) async {
    verified.add('$phone:$code');
    throw const MobileApiException('AUTH_REQUIRED', 401);
  }
}

Future<void> captureRoot(WidgetTester tester, String name) async {
  final directory = Platform.environment['BITPOS_DS14_ROOT_CAPTURE_DIR'];
  if (directory == null) return;
  await tester.pump();
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('root-capture')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('$directory/$name.png')
        .writeAsBytes(bytes!.buffer.asUint8List(), flush: true);
    image.dispose();
  });
}

void main() {
  testWidgets(
    'rider invalid OTP retains challenge and change-number never automatically resends',
    (tester) async {
      await tester.runAsync(() async {
        for (final family in ['NotoSansThai', 'Inter']) {
          await (FontLoader('packages/mobile_shared/$family')..addFont(
                File(
                  '../../packages/mobile_shared/assets/fonts/$family-Variable.ttf',
                ).readAsBytes().then(ByteData.sublistView),
              ))
              .load();
        }
        final config = jsonDecode(
          File('.dart_tool/package_config.json').readAsStringSync(),
        ) as Map<String, dynamic>;
        final flutter = (config['packages'] as List)
            .cast<Map<String, dynamic>>()
            .firstWhere((p) => p['name'] == 'flutter');
        final sdk = Directory.fromUri(Uri.parse(flutter['rootUri'] as String))
            .parent
            .parent;
        await (FontLoader('MaterialIcons')..addFont(
              File(
                '${sdk.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
              ).readAsBytes().then(ByteData.sublistView),
            ))
            .load();
      });
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      FlutterSecureStorage.setMockInitialValues({});
      final api = SignInApi();
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: BitPosTheme.light(),
          home: RepaintBoundary(
            key: const ValueKey('root-capture'),
            child: DriverSessionPage(api: api),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('driver-welcome-start')),
      );
      await tester.tap(find.byKey(const ValueKey('driver-welcome-start')));
      await tester.pumpAndSettle();
      await captureRoot(tester, 'R02-root-th');
      await tester.tap(find.text('ขอ OTP'));
      await tester.pumpAndSettle();
      expect(api.requested, isEmpty);
      await tester.enterText(find.byType(TextFormField).first, '+66900000001');
      await tester.tap(find.text('ขอ OTP'));
      await tester.pumpAndSettle();
      expect(api.requested, ['+66900000001']);
      expect(find.byType(TextFormField), findsOneWidget, reason: 'OTP step shows only code entry; original phone retained privately');
      await captureRoot(tester, 'R32-root-th');
      await tester.enterText(find.byType(TextFormField).last, '123');
      await tester.ensureVisible(find.text('ยืนยัน OTP'));
      await tester.tap(find.text('ยืนยัน OTP'));
      await tester.pumpAndSettle();
      expect(api.verified, isEmpty);
      await tester.enterText(find.byType(TextFormField).last, '123456');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('ยืนยัน OTP'));
      await tester.tap(find.text('ยืนยัน OTP'));
      await tester.pumpAndSettle();
      expect(api.verified, ['+66900000001:123456']);
      expect(find.text('ยืนยัน OTP'), findsOneWidget);
      expect(api.requested.length, 1);
      await tester.ensureVisible(find.text('เปลี่ยนหมายเลข / ขอรหัสใหม่'));
      await tester.tap(find.text('เปลี่ยนหมายเลข / ขอรหัสใหม่'));
      await tester.pumpAndSettle();
      expect(find.byType(TextFormField), findsOneWidget);
      expect(api.requested.length, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
  for(final variant in [(false,false,390.0,1.0),(true,true,320.0,1.5),(false,false,1280.0,1.5)]) {
    testWidgets('root login and OTP responsive variants $variant',(tester)async{
      final (thai,dark,width,scale)=variant;
      await tester.binding.setSurfaceSize(Size(width,844));addTearDown(()=>tester.binding.setSurfaceSize(null));
      await tester.runAsync(()async{
        for(final family in ['NotoSansThai','Inter'])await (FontLoader('packages/mobile_shared/$family')..addFont(File('../../packages/mobile_shared/assets/fonts/$family-Variable.ttf').readAsBytes().then(ByteData.sublistView))).load();
        final cfg=jsonDecode(File('.dart_tool/package_config.json').readAsStringSync())as Map<String,dynamic>;
        final f=(cfg['packages']as List).cast<Map<String,dynamic>>().firstWhere((p)=>p['name']=='flutter');
        final sdk=Directory.fromUri(Uri.parse(f['rootUri']as String)).parent.parent;
        await (FontLoader('MaterialIcons')..addFont(File('${sdk.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf').readAsBytes().then(ByteData.sublistView))).load();
      });
      FlutterSecureStorage.setMockInitialValues({});final api=SignInApi();
      await tester.pumpWidget(MaterialApp(debugShowCheckedModeBanner:false,theme:dark?BitPosTheme.dark():BitPosTheme.light(),builder:(context,child)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:TextScaler.linear(scale)),child:child!),home:RepaintBoundary(key:const ValueKey('root-capture'),child:DriverSessionPage(api:api))));
      await tester.pumpAndSettle();
      if(!thai){await tester.tap(find.text('English'));await tester.pumpAndSettle();}
      final start=find.byKey(const ValueKey('driver-welcome-start'));
      await tester.scrollUntilVisible(start,300,scrollable:find.byType(Scrollable).first);await tester.tap(start);await tester.pumpAndSettle();
      final tag='${thai?'th':'en'}-${dark?'dark':'light'}-${width.toInt()}-$scale';
      if(width==320){ expect(find.byIcon(Icons.language),findsOneWidget); expect(find.text('English'),findsNothing); }
      await captureRoot(tester,'R02-$tag');
      await tester.enterText(find.byType(TextFormField).first,'+66900000001');
      final request=find.text(thai?'ขอ OTP':'Request OTP');await tester.ensureVisible(request);await tester.tap(request);await tester.pumpAndSettle();
      expect(api.requested,['+66900000001']);
      await tester.enterText(find.byType(TextFormField).last,'123456');FocusManager.instance.primaryFocus?.unfocus();await tester.pumpAndSettle();
      final verify=find.text(thai?'ยืนยัน OTP':'Verify OTP');await tester.ensureVisible(verify);await captureRoot(tester,'R32-$tag');await tester.tap(verify);await tester.pumpAndSettle();
      expect(api.verified,['+66900000001:123456']);expect(tester.takeException(),isNull);
      await tester.pumpWidget(const SizedBox.shrink());await tester.pumpAndSettle();
    });
  }

}
