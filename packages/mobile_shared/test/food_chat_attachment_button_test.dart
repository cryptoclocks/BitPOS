import 'dart:io';
import 'dart:typed_data';

import 'package:mobile_shared/mobile_api.dart';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_shared/food_chat_attachment_button.dart';
import 'package:mobile_shared/food_chat_upload_draft.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_chat_upload_recovery_test.dart' as fixture;

void main() {
  testWidgets(
    'attachment action publishes ready metadata and leaves original source untouched',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final root = Directory.systemTemp.createTempSync(
        'bitpos-attachment-widget-',
      );
      addTearDown(() => root.delete(recursive: true));
      final original = File('${root.path}/gallery.jpg')
        ..writeAsBytesSync([255, 216, 255, 0]);
      final api = fixture.Api()..exists = true;
      addTearDown(api.close);
      final store = FoodChatUploadDraftStore(Directory('${root.path}/private'));
      FoodChatUpload? selected;
      var choosing = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FoodChatAttachmentButton(
              api: api,
              assignmentId: fixture.id,
              thai: false,
              enabled: true,
              draftStore: () async => store,
              pickImage: () async {
                choosing++;
                return XFile(original.path);
              },
              onChanged: (value) => selected = value,
              onBusy: (_) {},
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('Attach or recover photo'));
      for (var i = 0; i < 60 && selected == null; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)),
        );
        await tester.pump();
      }
      expect(selected, isNotNull);
      expect(choosing, 1);
      expect(api.lookups, 1);
      expect(api.uploads, 0);
      expect(original.readAsBytesSync(), [255, 216, 255, 0]);
      final recovered = await tester.runAsync(
        () => store.recover(
          account: fixture.id,
          session: fixture.id,
          assignment: fixture.id,
        ),
      );
      expect(recovered, isNotNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const MaterialApp());
    },
    timeout: const Timeout(Duration(seconds: 20)),
  );
  testWidgets('cancelled picker creates no upload or draft', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    final root = Directory.systemTemp.createTempSync(
      'bitpos-attachment-cancel-',
    );
    addTearDown(() => root.delete(recursive: true));
    final api = fixture.Api();
    addTearDown(api.close);
    var cancelled = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FoodChatAttachmentButton(
            api: api,
            assignmentId: fixture.id,
            thai: false,
            enabled: true,
            draftStore: () async => FoodChatUploadDraftStore(root),
            pickImage: () async {
              cancelled = true;
              return null;
            },
            onChanged: (_) => fail('No attachment on cancel'),
            onBusy: (_) {},
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('Attach or recover photo'));
    for (var i = 0; i < 60 && !cancelled; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      await tester.pump();
    }
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 30)),
    );
    await tester.pumpAndSettle();
    expect(cancelled, isTrue);
    expect(api.uploads, 0);
    expect(api.lookups, 0);
    expect(root.listSync(recursive: true), isEmpty);
    await tester.pumpWidget(const MaterialApp());
  }, timeout: const Timeout(Duration(seconds: 20)));
  testWidgets(
    'expired upload can be explicitly discarded without uploading or deleting gallery source',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final root = Directory.systemTemp.createTempSync(
        'bitpos-attachment-expired-',
      );
      addTearDown(() => root.delete(recursive: true));
      final original = File('${root.path}/gallery.jpg')
        ..writeAsBytesSync([255, 216, 255, 0]);
      final store = FoodChatUploadDraftStore(Directory('${root.path}/private'));
      await tester.runAsync(
        () => store.save(
          account: fixture.id,
          session: fixture.id,
          assignment: fixture.id,
          bytes: Uint8List.fromList([255, 216, 255, 0]),
          mime: 'image/jpeg',
        ),
      );
      final api = fixture.Api()
        ..lookupError = const MobileApiException('CHAT_IMAGE_EXPIRED', 410);
      addTearDown(api.close);
      var cleared = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FoodChatAttachmentButton(
              api: api,
              assignmentId: fixture.id,
              thai: false,
              enabled: true,
              draftStore: () async => store,
              pickImage: () async =>
                  throw StateError('Do not open picker for pending upload'),
              onChanged: (value) {
                if (value == null) cleared = true;
              },
              onBusy: (_) {},
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('Attach or recover photo'));
      for (
        var i = 0;
        i < 60 && find.byType(PopupMenuButton<bool>).evaluate().isEmpty;
        i++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)),
        );
        await tester.pump();
      }
      expect(api.uploads, 0);
      expect(api.lookups, 1);
      await tester.tap(find.byType(PopupMenuButton<bool>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Discard unsent photo'));
      for (var i = 0; i < 60 && !cleared; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)),
        );
        await tester.pump();
      }
      expect(cleared, isTrue);
      expect(
        await tester.runAsync(
          () => store.recover(
            account: fixture.id,
            session: fixture.id,
            assignment: fixture.id,
          ),
        ),
        isNull,
      );
      expect(original.readAsBytesSync(), [255, 216, 255, 0]);
      expect(find.byTooltip('Attach or recover photo'), findsOneWidget);
      await tester.pumpWidget(const MaterialApp());
    },
    timeout: const Timeout(Duration(seconds: 20)),
  );
}
