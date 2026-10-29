import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/food_chat_page.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:uuid/uuid.dart';

import '../../../apps/mobile-customer/lib/presentation/customer_navigation.dart'
    as customer_nav;
import '../../../apps/mobile-driver/lib/presentation/driver_navigation.dart'
    as driver_nav;

void foodChatNativeFlow({required bool rider}) {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'actual assigned chat sends receives realtime and clears on logout',
    (tester) async {
      const encoded = String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'),
          device = String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
          assignment = String.fromEnvironment('BITPOS_TEST_ASSIGNMENT_ID'),
          peer = String.fromEnvironment('BITPOS_TEST_PEER_ACCESS'),
          base = String.fromEnvironment('BITPOS_MOBILE_API');
      final session = jsonDecode(
        utf8.decode(base64Decode(encoded)),
      ) as Map<String, dynamic>;
      FlutterSecureStorage.setMockInitialValues({
        'bitpos.mobileSession': jsonEncode(session),
        'bitpos.deviceId': device,
      });
      final api = MobileApi(base: Uri.parse(base), fixture: true);
      addTearDown(api.close);
      await tester.runAsync(api.restore);
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: BitPosTheme.light(),
          home: Builder(
                  builder: (context) => Scaffold(
                    body: TextButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => FoodChatPageView(
                            api: api,
                            assignmentId: assignment,
                            thai: false,
                            rider: rider,
                            bottomNavigationBar: SafeArea(
                              top: false,
                              child: rider
                                  ? driver_nav.DriverNavigation(
                                      thai: false,
                                      selectedIndex: 0,
                                      onSelected: (_) {},
                                    )
                                  : customer_nav.CustomerNavigation(
                                      thai: false,
                                      selectedIndex: 0,
                                      onSelected: (_) {},
                                    ),
                            ),
                          ),
                        ),
                      ),
                      child: const Text('Open assigned chat'),
                    ),
                  ),
                ),
        ),
      );
      Future<void> ready(
        bool Function() predicate, {
        int attempts = 200,
      }) async {
        for (var n = 0; n < attempts && !predicate(); n++) {
          await tester.pump();
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 100)),
          );
        }
        expect(predicate(), true);
      }

      await tester.tap(find.text('Open assigned chat'));
      await tester.pump();

      await ready(
        () =>
            find.byType(TextField).evaluate().isNotEmpty &&
            tester.widget<TextField>(find.byType(TextField)).enabled == true,
      );
      expect(find.text(rider ? 'Work' : 'Order'), findsOneWidget);
      expect(find.text(rider ? 'History' : 'Orders'), findsOneWidget);
      final suffix = (session['sessionId'] as String).substring(0, 8),
          sent = 'Synthetic native ${rider ? 'rider' : 'customer'} $suffix',
          reply = 'Synthetic counterpart reply $suffix';
      await tester.enterText(find.byType(TextField), sent);
      await tester.tap(find.byTooltip('Send message'));
      bool visible(String text) => find
          .byWidgetPredicate(
            (widget) => widget is SelectableText && widget.data == text,
          )
          .evaluate()
          .isNotEmpty;
      await ready(
        () =>
            visible(sent) &&
            tester
                .widget<TextField>(find.byType(TextField))
                .controller!
                .text
                .isEmpty,
      );
      await tester.runAsync(() async {
        final http = HttpClient();
        try {
          final request = await http.postUrl(
            Uri.parse(base).resolve('food/assignments/$assignment/chat'),
          );
          request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $peer');
          request.headers.contentType = ContentType.json;
          request.write(
            jsonEncode({'commandId': const Uuid().v4(), 'body': reply}),
          );
          final response = await request.close();
          final value = jsonDecode(
            await utf8.decoder.bind(response).join(),
          ) as Map<String, dynamic>;
          expect(response.statusCode, 200);
          expect(value['senderRole'], rider ? 'CUSTOMER' : 'DRIVER');
          expect(value['body'], reply);
        } finally {
          http.close(force: true);
        }
      });
      // No tap/refresh: the foreground SSE hint must fetch the counterpart message.
      await ready(() => visible(reply));
      Finder ownBubble() => find
          .ancestor(
            of: find.byWidgetPredicate(
              (widget) => widget is SelectableText && widget.data == sent,
            ),
            matching: find.byType(Container),
          )
          .first;
      bool readBadge() => find
          .descendant(of: ownBubble(), matching: find.textContaining('· Read'))
          .evaluate()
          .isNotEmpty;
      expect(
        readBadge(),
        false,
        reason: 'Receiving a reply is not a peer read acknowledgement',
      );
      await tester.runAsync(() async {
        final http = HttpClient();
        try {
          final history = await http.getUrl(
            Uri.parse(base)
                .resolve('food/assignments/$assignment/chat?beforeSequence=0'),
          );
          history.headers.set(HttpHeaders.authorizationHeader, 'Bearer $peer');
          final response = await history.close();
          final data = jsonDecode(
            await utf8.decoder.bind(response).join(),
          ) as Map<String, dynamic>;
          expect(response.statusCode, 200);
          final message = (data['items'] as List)
              .cast<Map<String, dynamic>>()
              .singleWhere((m) => m['body'] == sent);
          final request = await http.putUrl(
            Uri.parse(base).resolve('food/assignments/$assignment/chat/read'),
          );
          request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $peer');
          request.headers.contentType = ContentType.json;
          request.write(jsonEncode({'lastReadSequence': message['sequence']}));
          final result = await request.close();
          final receipt = jsonDecode(
            await utf8.decoder.bind(result).join(),
          ) as Map<String, dynamic>;
          expect(result.statusCode, 200);
          expect(
            BigInt.parse(receipt['lastReadSequence'] as String) >=
                BigInt.parse(message['sequence'] as String),
            true,
          );
        } finally {
          http.close(force: true);
        }
      });
      await ready(readBadge);

      const gallery = bool.fromEnvironment('BITPOS_TEST_CHAT_GALLERY');
      if (gallery) {
        FocusManager.instance.primaryFocus?.unfocus();
        await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
        await tester.pump();
        for (var photo = 1; photo <= 2; photo++) {
          debugPrint('BITPOS_CHAT_PICKER_REQUEST');
          final attach = find.byWidgetPredicate(
            (widget) =>
                widget is IconButton &&
                widget.tooltip == 'Attach or recover photo',
          );
          await ready(
            () => tester.widget<IconButton>(attach).onPressed != null,
          );
          await tester.ensureVisible(attach);
          await tester.pumpAndSettle();
          await tester.tap(attach);
          await ready(
            () => find
                .text(photo == 1 ? 'Photo attached' : 'Photo 2')
                .evaluate()
                .isNotEmpty,
            attempts: 600,
          );
          debugPrint('BITPOS_CHAT_GALLERY_UPLOADED_$photo');
        }
        await ready(
          () =>
              tester.widget<TextField>(find.byType(TextField)).enabled ==
                  true &&
              tester
                      .widget<IconButton>(
                        find.byWidgetPredicate(
                          (widget) =>
                              widget is IconButton &&
                              widget.tooltip == 'Send message',
                        ),
                      )
                      .onPressed !=
                  null,
        );
        // The earlier explicit unfocus closes the IME, while the test binding
        // retains its EditableTextState. Reset only the test binding so
        // showKeyboard reconnects instead of sending text to its stale client.
        tester.binding.focusedEditable = null;
        await tester.enterText(
          find.byType(TextField),
          'Synthetic gallery $suffix',
        );
        expect(
          tester.widget<TextField>(find.byType(TextField)).controller!.text,
          'Synthetic gallery $suffix',
        );
        await ready(
          () =>
              tester
                  .widget<IconButton>(
                    find.byWidgetPredicate(
                      (widget) =>
                          widget is IconButton &&
                          widget.tooltip == 'Send message',
                    ),
                  )
                  .onPressed !=
              null,
        );
        expect(
          tester.widget<TextField>(find.byType(TextField)).controller!.text,
          'Synthetic gallery $suffix',
        );
        debugPrint('BITPOS_CHAT_GALLERY_SEND_AVAILABLE');
        await tester.tap(find.byTooltip('Send message'));
        await ready(
          () =>
              visible('Synthetic gallery $suffix') &&
              find.text('Photo attached').evaluate().isEmpty,
        );
      }

      const imageSource = String.fromEnvironment('BITPOS_TEST_CHAT_IMAGE');
      if (imageSource.isNotEmpty) {
        await tester.runAsync(() async {
          final http = HttpClient();
          try {
            final upload = await http.postUrl(
              Uri.parse(base)
                  .resolve('food/assignments/$assignment/chat/images'),
            );
            upload.headers.set(HttpHeaders.authorizationHeader, 'Bearer $peer');
            upload.headers.set('Idempotency-Key', const Uuid().v4());
            upload.headers.contentType = ContentType('image', 'jpeg');
            final imageBytes = base64Decode(imageSource);
            upload.contentLength = imageBytes.length;
            upload.add(imageBytes);
            final uploaded = await upload.close();
            final metadata = jsonDecode(
              await utf8.decoder.bind(uploaded).join(),
            ) as Map<String, dynamic>;
            expect(uploaded.statusCode, 200);
            final post = await http.postUrl(
              Uri.parse(base).resolve('food/assignments/$assignment/chat'),
            );
            post.headers.set(HttpHeaders.authorizationHeader, 'Bearer $peer');
            post.headers.contentType = ContentType.json;
            post.write(
              jsonEncode({
                'commandId': const Uuid().v4(),
                'body': 'Synthetic photo $suffix',
                'attachmentIds': [metadata['id']],
              }),
            );
            final posted = await post.close();
            await posted.drain<void>();
            expect(posted.statusCode, 200);
          } finally {
            http.close(force: true);
          }
        });
        Finder receivedPhoto() => find.descendant(
          of: find
              .ancestor(
                of: find.byWidgetPredicate(
                  (widget) =>
                      widget is SelectableText &&
                      widget.data == 'Synthetic photo $suffix',
                ),
                matching: find.byType(Container),
              )
              .first,
          matching: find.byType(Image),
        );
        await ready(
          () =>
              visible('Synthetic photo $suffix') &&
              receivedPhoto().evaluate().isNotEmpty,
        );
        await tester.tap(receivedPhoto().first);
        await tester.pumpAndSettle();
        expect(find.byType(InteractiveViewer), findsOneWidget);
        await tester.tap(find.byTooltip('Close'));
        await tester.pumpAndSettle();
        expect(find.byType(InteractiveViewer), findsNothing);
      }

      FocusManager.instance.primaryFocus?.unfocus();
      await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
      await tester.pump();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 500)),
      );
      await tester.pump();
      debugPrint(
        rider ? 'BITPOS_CHAT_RIDER_VISIBLE' : 'BITPOS_CHAT_CUSTOMER_VISIBLE',
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 2)),
      );
      await tester.runAsync(api.logout);
      await ready(() => find.byType(TextField).evaluate().isEmpty);
      expect(visible(sent), false);
      expect(visible(reply), false);
      expect(find.byType(Image), findsNothing);
    },
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
