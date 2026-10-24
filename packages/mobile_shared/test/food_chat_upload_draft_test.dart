import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/food_chat_upload_draft.dart';

void main() {
  test('restart retains exact command and bytes, isolates owner, refuses replacement', () async {
    final root = await Directory.systemTemp.createTemp('bitpos-upload-draft-');
    addTearDown(() => root.delete(recursive: true));
    final store = FoodChatUploadDraftStore(root);
    final bytes = Uint8List.fromList([255, 216, 255, 0]);
    final first = await store.save(
      account: 'a',
      session: 's',
      assignment: 'j',
      bytes: bytes,
      mime: 'image/jpeg',
    );
    final restarted = FoodChatUploadDraftStore(root);
    final recovered = await restarted.recover(
      account: 'a',
      session: 's',
      assignment: 'j',
    );
    expect(recovered!.draft.commandId, first.commandId);
    expect(recovered.bytes, bytes);
    expect(
      await restarted.recover(account: 'b', session: 's', assignment: 'j'),
      isNull,
    );
    expect(
      await restarted.recover(account: 'a', session: 'other', assignment: 'j'),
      isNull,
    );
    await expectLater(
      store.save(
        account: 'a',
        session: 's',
        assignment: 'j',
        bytes: bytes,
        mime: 'image/jpeg',
      ),
      throwsStateError,
    );
    await restarted.discard(account: 'a', session: 's', assignment: 'j');
    expect(
      await restarted.recover(account: 'a', session: 's', assignment: 'j'),
      isNull,
    );
  });
  test(
    'tampered bytes refuse recovery and unsafe metadata cannot name files',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'bitpos-upload-draft-',
      );
      addTearDown(() => root.delete(recursive: true));
      final store = FoodChatUploadDraftStore(root);
      await store.save(
        account: 'a',
        session: 's',
        assignment: 'j',
        bytes: Uint8List.fromList([1, 2]),
        mime: 'image/png',
      );
      final image =
          await root
                  .list(recursive: true)
                  .where((f) => f.path.endsWith('.image'))
                  .first
              as File;
      await image.writeAsBytes([3, 4], flush: true);
      await expectLater(
        store.recover(account: 'a', session: 's', assignment: 'j'),
        throwsFormatException,
      );
      expect(
        () => FoodChatUploadDraft.fromJson({
          'commandId': '../../outside',
          'mime': 'image/png',
          'byteLength': 2,
          'sha256': '0' * 64,
        }),
        throwsFormatException,
      );
    },
  );
}
