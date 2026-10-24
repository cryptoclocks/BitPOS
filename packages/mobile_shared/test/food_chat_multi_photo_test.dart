import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_chat_page.dart';
import 'package:mobile_shared/food_chat_upload_draft.dart';

import 'food_chat_page_test.dart' show ChatApi, id;

class MultiApi extends ChatApi {
  final uploads = <String, FoodChatUpload>{};
  String? failCommand;
  @override
  Future<FoodChatUpload> recoverFoodChatUpload(
    String assignment,
    String command,
  ) async {
    if (command == failCommand) {
      throw const MobileApiException('RESPONSE_UNAVAILABLE', 503);
    }
    final value = uploads[command];
    if (value == null) {
      throw const MobileApiException('RESOURCE_NOT_FOUND', 404);
    }
    return value;
  }

  @override
  Future<FoodChatUpload> uploadFoodChatImage(
    String assignment,
    String command,
    Uint8List bytes,
    String mime,
  ) async {
    return uploads.putIfAbsent(
      command,
      () => FoodChatUpload(
        id: command,
        assignmentId: assignment,
        mime: 'image/jpeg',
        byteLength: 4,
        width: 1,
        height: 1,
        sha256: '0' * 64,
        state: 'READY',
        expiresAt: DateTime.now()
            .add(const Duration(minutes: 5))
            .toUtc()
            .toIso8601String(),
        sanitizer: 'raster-reencode-v1',
      ),
    );
  }
}

Future<void> ready(WidgetTester tester, bool Function() check) async {
  for (var n = 0; n < 100 && !check(); n++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
    await tester.pump();
  }
  expect(check(), isTrue);
}

void main() {
  testWidgets(
    'four private photo slots retain exact ordered command across lost reply and remove middle',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final root = Directory.systemTemp.createTempSync('bitpos-multi-photo-');
      addTearDown(() => root.delete(recursive: true));
      final original = File('${root.path}/gallery.jpg')
        ..writeAsBytesSync([255, 216, 255, 0]);
      final api = MultiApi();
      addTearDown(api.close);
      final stores = List.generate(
        4,
        (n) => FoodChatUploadDraftStore(Directory('${root.path}/private-$n')),
      );
      var picks = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: FoodChatPageView(
            api: api,
            assignmentId: id,
            thai: false,
            rider: false,
            attachmentDraftStore: (slot) async => stores[slot],
            pickImage: () async {
              picks++;
              return XFile(original.path);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      for (var n = 1; n <= 4; n++) {
        await tester.tap(find.byTooltip('Attach or recover photo'));
        await ready(
          tester,
          () => find.byType(InputChip).evaluate().length == n,
        );
      }
      expect(picks, 4);
      expect(api.uploads.length, 4);
      final fullButton = tester.widget<IconButton>(
        find.byWidgetPredicate(
          (w) => w is IconButton && w.tooltip == 'Attach or recover photo',
        ),
      );
      expect(fullButton.onPressed, isNull);
      final originalIds = api.uploads.values.map((v) => v.id).toList();
      await tester.tap(find.byTooltip('Remove photo').at(1));
      await ready(tester, () => find.byType(InputChip).evaluate().length == 3);
      await tester.tap(find.byTooltip('Attach or recover photo'));
      await ready(
        tester,
        () =>
            api.uploads.length == 5 &&
            find.byType(InputChip).evaluate().length == 4,
      );
      await tester.enterText(find.byType(TextField), 'Four photos');
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(api.sent.length, 1);
      expect(api.sent.single.attachmentIds, [
        originalIds[0],
        api.uploads.values.last.id,
        originalIds[2],
        originalIds[3],
      ]);
      for (final store in stores) {
        final saved = await tester.runAsync(
          () => store.recover(account: id, session: id, assignment: id),
        );
        expect(
          saved,
          isNotNull,
          reason: 'Unknown send result must retain all private draft bytes',
        );
      }
      api.lose = false;
      await tester.tap(find.text('Recover saved message'));
      await ready(
        tester,
        () => api.sent.length == 2 && find.byType(InputChip).evaluate().isEmpty,
      );
      expect(api.sent[1].toJson(), api.sent[0].toJson());
      expect(picks, 5);
      for (final store in stores) {
        final saved = await tester.runAsync(
          () => store.recover(account: id, session: id, assignment: id),
        );
        expect(saved, isNull);
      }
      expect(original.existsSync(), isTrue);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
  testWidgets(
    'background clears private selection then explicit recovery restores earlier photos without repicking',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final root = Directory.systemTemp.createTempSync(
        'bitpos-multi-background-',
      );
      addTearDown(() => root.delete(recursive: true));
      final original = File('${root.path}/gallery.jpg')
        ..writeAsBytesSync([255, 216, 255, 0]);
      final api = MultiApi()..lose = false;
      addTearDown(api.close);
      final stores = List.generate(
        4,
        (n) => FoodChatUploadDraftStore(Directory('${root.path}/slot-$n')),
      );
      var picks = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: FoodChatPageView(
            api: api,
            assignmentId: id,
            thai: false,
            rider: false,
            attachmentDraftStore: (slot) async => stores[slot],
            pickImage: () async {
              picks++;
              return XFile(original.path);
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Attach or recover photo'));
      await ready(tester, () => find.byType(InputChip).evaluate().length == 1);
      final first = api.uploads.values.single.id;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.scheduleForcedFrame();
      await tester.pump();
      expect(find.byType(InputChip), findsNothing);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Attach or recover photo'));
      await ready(tester, () => find.byType(InputChip).evaluate().length == 1);
      expect(picks, 1);
      await tester.tap(find.byTooltip('Attach or recover photo'));
      await ready(tester, () => find.byType(InputChip).evaluate().length == 2);
      expect(picks, 2);
      await tester.tap(find.byTooltip('Send message'));
      await ready(
        tester,
        () => api.sent.length == 1 && find.byType(InputChip).evaluate().isEmpty,
      );
      expect(api.sent.single.attachmentIds, [
        first,
        api.uploads.values.last.id,
      ]);
      expect(original.existsSync(), isTrue);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
  testWidgets(
    'unknown recovery of earlier photo blocks partial send until explicit discard-all',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final root = Directory.systemTemp.createTempSync('bitpos-multi-unknown-');
      addTearDown(() => root.delete(recursive: true));
      final original = File('${root.path}/gallery.jpg')
        ..writeAsBytesSync([255, 216, 255, 0]);
      final api = MultiApi();
      addTearDown(api.close);
      final stores = List.generate(
        4,
        (n) => FoodChatUploadDraftStore(Directory('${root.path}/slot-$n')),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: FoodChatPageView(
            api: api,
            assignmentId: id,
            thai: false,
            rider: false,
            attachmentDraftStore: (slot) async => stores[slot],
            pickImage: () async => XFile(original.path),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Attach or recover photo'));
      await ready(tester, () => find.byType(InputChip).evaluate().length == 1);
      api.failCommand = api.uploads.keys.first;
      await tester.tap(find.byTooltip('Attach or recover photo'));
      await ready(
        tester,
        () => find.text('Remove all photos').evaluate().isNotEmpty,
      );
      final send = tester.widget<IconButton>(
        find.byWidgetPredicate(
          (w) => w is IconButton && w.tooltip == 'Send message',
        ),
      );
      expect(send.onPressed, isNull);
      expect(api.sent, isEmpty);
      for (final store in stores.take(2)) {
        expect(
          await tester.runAsync(
            () => store.recover(account: id, session: id, assignment: id),
          ),
          isNotNull,
        );
      }
      await tester.tap(find.text('Remove all photos'));
      await ready(
        tester,
        () =>
            find.text('Remove all photos').evaluate().isEmpty &&
            find.byType(InputChip).evaluate().isEmpty,
      );
      for (final store in stores) {
        expect(
          await tester.runAsync(
            () => store.recover(account: id, session: id, assignment: id),
          ),
          isNull,
        );
      }
      expect(original.existsSync(), isTrue);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
}
