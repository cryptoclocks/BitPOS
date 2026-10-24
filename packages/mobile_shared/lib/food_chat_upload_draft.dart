import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:uuid/uuid.dart';

/// One app-owned upload draft. Never deletes the picker/user's source file.
/// Supply an application-private support directory; this is not a gallery cache.
class FoodChatUploadDraftStore {
  FoodChatUploadDraftStore(this.root);
  final Directory root;
  Future<void> _tail = Future<void>.value();

  Future<T> _serial<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Directory _scope(String account, String session, String assignment) {
    if ([account, session, assignment].any((s) => s.isEmpty)) {
      throw ArgumentError('A complete owner scope is required');
    }
    final scope = sha256.convert(
      utf8.encode(jsonEncode([account, session, assignment])),
    );
    return Directory('${root.path}/$scope');
  }

  Future<FoodChatUploadDraft> save({
    required String account,
    required String session,
    required String assignment,
    required Uint8List bytes,
    required String mime,
  }) => _serial(() async {
    if (bytes.isEmpty ||
        bytes.length > 4 * 1024 * 1024 ||
        !['image/jpeg', 'image/png'].contains(mime)) {
      throw const FormatException('JPEG/PNG image up to 4 MiB required');
    }
    final directory = _scope(account, session, assignment);
    await directory.create(recursive: true);
    // Do not replace a pending command: an unknown upload outcome must recover it.
    if (await File('${directory.path}/draft.json').exists()) {
      throw StateError('An upload draft already requires recovery');
    }
    final command = const Uuid().v4();
    final digest = sha256.convert(bytes).toString();
    final body = File('${directory.path}/$command.image');
    await body.writeAsBytes(bytes, flush: true);
    final draft = FoodChatUploadDraft(command, mime, bytes.length, digest);
    final temporary = File('${directory.path}/draft.tmp');
    await temporary.writeAsString(jsonEncode(draft.toJson()), flush: true);
    await temporary.rename('${directory.path}/draft.json');
    return draft;
  });

  Future<({FoodChatUploadDraft draft, Uint8List bytes})?> recover({
    required String account,
    required String session,
    required String assignment,
  }) => _serial(() async {
    final directory = _scope(account, session, assignment);
    final manifest = File('${directory.path}/draft.json');
    if (!await manifest.exists()) return null;
    final draft = FoodChatUploadDraft.fromJson(
      jsonDecode(await manifest.readAsString()),
    );
    final body = File('${directory.path}/${draft.commandId}.image');
    if (await body.length() != draft.byteLength) {
      throw const FormatException('Upload draft length mismatch');
    }
    final bytes = await body.readAsBytes();
    if (sha256.convert(bytes).toString() != draft.sha256) {
      throw const FormatException('Upload draft digest mismatch');
    }
    return (draft: draft, bytes: bytes);
  });

  Future<void> discard({
    required String account,
    required String session,
    required String assignment,
  }) => _serial(() async {
    final directory = _scope(account, session, assignment);
    if (await directory.exists()) await directory.delete(recursive: true);
  });
}

class FoodChatUploadDraft {
  const FoodChatUploadDraft(
    this.commandId,
    this.mime,
    this.byteLength,
    this.sha256,
  );
  final String commandId, mime, sha256;
  final int byteLength;
  Map<String, Object> toJson() => {
    'commandId': commandId,
    'mime': mime,
    'byteLength': byteLength,
    'sha256': sha256,
  };
  factory FoodChatUploadDraft.fromJson(dynamic value) {
    if (value is! Map ||
        value.length != 4 ||
        value['commandId'] is! String ||
        !RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ).hasMatch(value['commandId'] as String) ||
        !['image/jpeg', 'image/png'].contains(value['mime']) ||
        value['byteLength'] is! int ||
        value['byteLength'] < 1 ||
        value['byteLength'] > 4 * 1024 * 1024 ||
        value['sha256'] is! String ||
        !RegExp(r'^[0-9a-f]{64}$').hasMatch(value['sha256'] as String)) {
      throw const FormatException('Invalid private upload draft');
    }
    return FoodChatUploadDraft(
      value['commandId'] as String,
      value['mime'] as String,
      value['byteLength'] as int,
      value['sha256'] as String,
    );
  }
}
