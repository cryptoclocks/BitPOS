import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_chat_upload_draft.dart';
import 'package:mobile_shared/food_chat_upload_recovery.dart';

const id = '00000000-0000-4000-8000-000000000041';

class Api extends MobileApi {
  Api() : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  bool active = true, exists = false;
  Object? lookupError;
  int lookups = 0, uploads = 0;
  String? command;
  Completer<void>? held;
  @override
  bool get signedIn => active;
  @override
  ({String accountId, String sessionId})? get sessionScope =>
      active ? (accountId: id, sessionId: id) : null;
  FoodChatUpload receipt() => FoodChatUpload(
    id: id,
    assignmentId: id,
    mime: 'image/jpeg',
    byteLength: 2,
    width: 1,
    height: 1,
    sha256: '0' * 64,
    state: 'READY',
    expiresAt: DateTime.now()
        .add(const Duration(minutes: 5))
        .toUtc()
        .toIso8601String(),
    sanitizer: 'raster-reencode-v1',
  );
  @override
  Future<FoodChatUpload> recoverFoodChatUpload(
    String assignmentId,
    String commandId,
  ) async {
    lookups++;
    command = commandId;
    if (held != null) await held!.future;
    if (lookupError != null) throw lookupError!;
    if (!exists) throw const MobileApiException('RESOURCE_NOT_FOUND', 404);
    return receipt();
  }

  @override
  Future<FoodChatUpload> uploadFoodChatImage(
    String assignmentId,
    String commandId,
    Uint8List bytes,
    String mime,
  ) async {
    uploads++;
    expect(commandId, command);
    expect(bytes, [1, 2]);
    exists = true;
    return receipt();
  }
}

void main() {
  Future<
    ({
      Directory root,
      FoodChatUploadDraftStore store,
      Api api,
      FoodChatUploadRecovery recovery,
    })
  >
  setup() async {
    final root = await Directory.systemTemp.createTemp(
      'bitpos-upload-recovery-',
    );
    addTearDown(() => root.delete(recursive: true));
    final store = FoodChatUploadDraftStore(root), api = Api();
    addTearDown(api.close);
    await store.save(
      account: id,
      session: id,
      assignment: id,
      bytes: Uint8List.fromList([1, 2]),
      mime: 'image/jpeg',
    );
    return (
      root: root,
      store: store,
      api: api,
      recovery: FoodChatUploadRecovery(
        api: api,
        store: store,
        assignmentId: id,
      ),
    );
  }

  test('only proven absence uploads original command, subsequent recovery never reuploads', () async {
    final f = await setup();
    expect(await f.recovery.recover(), isNotNull);
    expect(f.api.uploads, 1);
    expect(await f.recovery.recover(), isNotNull);
    expect(f.api.uploads, 1);
    expect(
      await f.store.recover(account: id, session: id, assignment: id),
      isNotNull,
    );
  });
  test('ambiguous lookup leaves draft and does not upload', () async {
    final f = await setup();
    f.api.lookupError = TimeoutException('fixture');
    await expectLater(f.recovery.recover(), throwsA(isA<TimeoutException>()));
    expect(f.api.uploads, 0);
    expect(
      await f.store.recover(account: id, session: id, assignment: id),
      isNotNull,
    );
  });
  test(
    'single-flight owner retirement refuses late receipt and does not upload',
    () async {
      final f = await setup();
      f.api.held = Completer<void>();
      final first = f.recovery.recover(), second = f.recovery.recover();
      expect(identical(first, second), isTrue);
      final check = expectLater(first, throwsA(isA<MobileApiException>()));
      while (f.api.lookups == 0) {
        await Future<void>.delayed(const Duration(milliseconds: 1));
      }
      f.api.active = false;
      f.api.held!.complete();
      await check;
      expect(f.api.uploads, 0);
      expect(f.api.lookups, 1);
    },
  );
}
