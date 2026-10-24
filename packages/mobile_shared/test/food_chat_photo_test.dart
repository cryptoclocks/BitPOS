import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_chat_photo.dart';

const id = '00000000-0000-4000-8000-000000000041';

class PhotoApi extends MobileApi {
  PhotoApi(this.bytes)
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  final Uint8List bytes;
  Completer<Uint8List>? held;
  ({String accountId, String sessionId})? owner = (
    accountId: id,
    sessionId: id,
  );
  final owners =
      StreamController<({String accountId, String sessionId})?>.broadcast(
        sync: true,
      );
  @override
  bool get signedIn => owner != null;
  @override
  ({String accountId, String sessionId})? get sessionScope => owner;
  @override
  Stream<({String accountId, String sessionId})?> get sessionScopes =>
      owners.stream;
  @override
  Future<Uint8List> foodChatImage(
    String assignmentId,
    FoodChatAttachment image,
  ) async => held?.future ?? bytes;
  void retire() {
    owner = null;
    owners.add(null);
  }

  @override
  void close() {
    unawaited(owners.close());
    super.close();
  }
}

FoodChatAttachment attachment(Uint8List bytes) => FoodChatAttachment(
  id: id,
  mime: 'image/jpeg',
  byteLength: bytes.length,
  width: 24,
  height: 16,
  sha256: sha256.convert(bytes).toString(),
  state: 'READY',
);
void main() {
  testWidgets(
    'rendered private image reports ready and full-screen preview retires on owner loss',
    (tester) async {
      final bytes = File('test/fixtures/chat-photo.jpg').readAsBytesSync(),
          api = PhotoApi(bytes);
      addTearDown(api.close);
      var ready = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FoodChatPhoto(
              api: api,
              assignmentId: id,
              image: attachment(bytes),
              thai: false,
              onRendered: () => ready++,
            ),
          ),
        ),
      );
      for (var i = 0; i < 40 && ready == 0; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump();
      }
      expect(ready, 1);
      expect(find.byType(Image), findsOneWidget);
      await tester.tap(
        find
            .descendant(
              of: find.byType(FoodChatPhoto),
              matching: find.byType(InkWell),
            )
            .first,
      );
      await tester.pumpAndSettle();
      expect(find.byType(InteractiveViewer), findsOneWidget);
      api.retire();
      await tester.pumpAndSettle();
      expect(find.byType(InteractiveViewer), findsNothing);
      expect(find.byType(Image), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const MaterialApp());
    },
    timeout: const Timeout(Duration(seconds: 20)),
  );
  testWidgets('late encoded bytes cannot render after owner retirement', (
    tester,
  ) async {
    final bytes = File('test/fixtures/chat-photo.jpg').readAsBytesSync(),
        api = PhotoApi(bytes),
        held = Completer<Uint8List>();
    api.held = held;
    addTearDown(api.close);
    var ready = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FoodChatPhoto(
            api: api,
            assignmentId: id,
            image: attachment(bytes),
            thai: false,
            onRendered: () => ready++,
          ),
        ),
      ),
    );
    await tester.pump();
    api.retire();
    held.complete(bytes);
    await tester.pumpAndSettle();
    expect(ready, 0);
    expect(find.byType(Image), findsNothing);
    await tester.pumpWidget(const MaterialApp());
  }, timeout: const Timeout(Duration(seconds: 20)));
}
