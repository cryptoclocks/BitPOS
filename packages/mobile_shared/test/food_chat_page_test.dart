import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_chat_page.dart';
import 'package:mobile_shared/food_chat_attachment_button.dart';

const id = '00000000-0000-4000-8000-000000000041';
const other = '00000000-0000-4000-8000-000000000042';

class ChatApi extends MobileApi {
  @override
  Future<FoodChatReadReceipt> markFoodChatRead(
    String assignmentId,
    String lastReadSequence,
  ) async => FoodChatReadReceipt(
    assignmentId: assignmentId,
    lastReadSequence: lastReadSequence,
    updatedAt: '2026-10-20T01:00:00Z',
  );
  @override
  Stream<FoodRealtimeState<FoodChatRealtimeSnapshot>> watchFoodChat(
    String assignmentId,
  ) => const Stream.empty();
  ChatApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  ({String accountId, String sessionId})? owner = (
    accountId: id,
    sessionId: id,
  );
  final owners =
      StreamController<({String accountId, String sessionId})?>.broadcast(
        sync: true,
      );
  FoodChatSendCommand? saved;
  final sent = <FoodChatSendCommand>[];
  bool lose = true;
  @override
  bool get signedIn => owner != null;
  @override
  ({String accountId, String sessionId})? get sessionScope => owner;
  @override
  Stream<({String accountId, String sessionId})?> get sessionScopes =>
      owners.stream;
  @override
  Future<FoodChatSendCommand?> pendingFoodChatMessage(
    String assignmentId,
  ) async => saved;
  @override
  Future<FoodChatPage> foodChat(
    String assignmentId, {
    String afterSequence = '0',
    String? beforeSequence,
  }) async => FoodChatPage(
    assignmentId: assignmentId,
    myRole: 'CUSTOMER',
    items: [],
    nextAfterSequence: null,
    nextBeforeSequence: null,
    latestSequence: '0',
  );
  @override
  Future<FoodChatMessage> sendFoodChat(
    String assignmentId,
    FoodChatSendCommand command,
  ) async {
    sent.add(command);
    saved = command;
    if (lose) throw StateError('lost acknowledgement');
    saved = null;
    return FoodChatMessage(
      attachments: const [],
      id: other,
      assignmentId: assignmentId,
      commandId: command.commandId,
      sequence: '1',
      senderRole: 'CUSTOMER',
      mine: true,
      body: command.body,
      createdAt: '2026-10-20T01:00:00Z',
    );
  }

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

class LiveChatApi extends ChatApi {
  final signals =
      StreamController<FoodRealtimeState<FoodChatRealtimeSnapshot>>.broadcast(
        sync: true,
      );
  final reads = <String>[];
  int count = 1;
  @override
  Stream<FoodRealtimeState<FoodChatRealtimeSnapshot>> watchFoodChat(
    String assignmentId,
  ) => signals.stream;
  @override
  Future<FoodChatPage> foodChat(
    String assignmentId, {
    String afterSequence = '0',
    String? beforeSequence,
  }) async {
    reads.add(
      beforeSequence == null
          ? 'after:$afterSequence'
          : 'before:$beforeSequence',
    );
    return FoodChatPage(
      assignmentId: assignmentId,
      myRole: 'CUSTOMER',
      items: [
        for (var n = 1; n <= count; n++)
          if (beforeSequence != null || n > int.parse(afterSequence))
            FoodChatMessage(
              attachments: const [],
              id: n == 1 ? id : other,
              assignmentId: assignmentId,
              commandId: n == 1 ? id : other,
              sequence: '$n',
              senderRole: 'DRIVER',
              mine: false,
              body: 'Incoming $n',
              createdAt: '2026-10-20T01:00:00Z',
            ),
      ],
      nextAfterSequence: null,
      nextBeforeSequence: null,
      latestSequence: '$count',
    );
  }

  void publish() => signals.add(
    FoodRealtimeLive(
      FoodChatRealtimeSnapshot(
        assignmentId: id,
        latestSequence: '$count',
        peerReadSequence: '0',
        serverTime: '2026-10-20T01:00:00Z',
        cursor: 'f1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ),
  );
  @override
  void close() {
    unawaited(signals.close());
    super.close();
  }
}

class ReadChatApi extends ChatApi {
  final signals =
      StreamController<FoodRealtimeState<FoodChatRealtimeSnapshot>>.broadcast(
        sync: true,
      );
  final acknowledgements = <String>[];
  bool tallOwn = false;
  bool tallCounterpart = false;
  @override
  Stream<FoodRealtimeState<FoodChatRealtimeSnapshot>> watchFoodChat(
    String assignmentId,
  ) => signals.stream;
  @override
  Future<FoodChatReadReceipt> markFoodChatRead(
    String assignmentId,
    String lastReadSequence,
  ) async {
    acknowledgements.add(lastReadSequence);
    return super.markFoodChatRead(assignmentId, lastReadSequence);
  }

  @override
  Future<FoodChatPage> foodChat(
    String assignmentId, {
    String afterSequence = '0',
    String? beforeSequence,
  }) async => FoodChatPage(
    assignmentId: assignmentId,
    myRole: 'CUSTOMER',
    items: [
      FoodChatMessage(
        attachments: const [],
        id: id,
        assignmentId: assignmentId,
        commandId: id,
        sequence: '1',
        senderRole: 'DRIVER',
        mine: false,
        body: tallCounterpart
            ? 'Long counterpart message ' * 200
            : 'Counterpart visible message',
        createdAt: '2026-10-20T01:00:00Z',
      ),
      FoodChatMessage(
        attachments: const [],
        id: other,
        assignmentId: assignmentId,
        commandId: other,
        sequence: '2',
        senderRole: 'CUSTOMER',
        mine: true,
        body: tallOwn ? 'Long own message ' * 200 : 'Own unconfirmed read',
        createdAt: '2026-10-20T01:00:00Z',
      ),
    ],
    nextAfterSequence: null,
    nextBeforeSequence: null,
    latestSequence: '2',
  );
  void peerRead() => signals.add(
    FoodRealtimeLive(
      FoodChatRealtimeSnapshot(
        assignmentId: id,
        latestSequence: '2',
        peerReadSequence: '2',
        serverTime: '2026-10-20T01:00:00Z',
        cursor: 'f1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ),
  );
  @override
  void close() {
    unawaited(signals.close());
    super.close();
  }
}

void main() {
  for (final width in [320.0, 390.0]) {
    testWidgets(
      'Thai composer embeds attachment and keeps design spacing at $width',
      (tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = ChatApi();
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: const TextScaler.linear(1.5)),
              child: child!,
            ),
            home: FoodChatPageView(
              api: api,
              assignmentId: id,
              thai: true,
              rider: false,
            ),
          ),
        );
        await tester.pumpAndSettle();
        final field = tester.getRect(find.byType(TextField));
        final attachment = tester.getRect(
          find.byType(FoodChatAttachmentButton),
        );
        final send = tester.getRect(
          find.byWidgetPredicate(
            (w) => w is IconButton && w.tooltip == 'ส่งข้อความ',
          ),
        );
        expect(field.left, closeTo(24, 0.5));
        // The 390px design canvas aligns exactly; narrow widths can quantize
        // the trailing margin by one logical pixel while preserving the row.
        expect(width - send.right, closeTo(24, 1));
        expect(send.left - field.right, closeTo(14, 1.5));
        expect(field.width, greaterThanOrEqualTo(width - 111));
        expect(field.contains(attachment.center), isTrue);
        expect(attachment.width, greaterThanOrEqualTo(44));
        expect(attachment.height, greaterThanOrEqualTo(48));
        await tester.enterText(
          find.byType(TextField),
          'ข้อความภาษาไทยที่ยาวเพื่อทดสอบการขยายช่องพิมพ์และช่องไฟ',
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const MaterialApp());
      },
    );
  }

  testWidgets(
    'foreground reconnect preserves caption while authority denial clears input',
    (tester) async {
      final api = LiveChatApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: FoodChatPageView(
            api: api,
            assignmentId: id,
            thai: false,
            rider: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Caption to keep');
      api.signals.add(const FoodRealtimeConnecting());
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Caption to keep',
      );
      api.publish();
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Caption to keep',
      );
      api.signals.add(
        const FoodRealtimeDisconnected(
          MobileApiException('CHAT_UNAVAILABLE', 404),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      await tester.pumpWidget(const MaterialApp());
    },
  );

  testWidgets(
    'chat recovers exact message and owner retirement removes plaintext',
    (tester) async {
      final api = ChatApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: FoodChatPageView(
            api: api,
            assignmentId: id,
            thai: false,
            rider: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Private note');
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(api.sent, hasLength(1));
      expect(find.text('Recover saved message'), findsOneWidget);
      api.lose = false;
      await tester.tap(find.text('Recover saved message'));
      await tester.pumpAndSettle();
      expect(api.sent, hasLength(2));
      expect(api.sent.first.commandId, api.sent.last.commandId);
      expect(find.text('Private note'), findsOneWidget);
      expect(find.text('Recover saved message'), findsNothing);
      api.retire();
      await tester.pump();
      expect(find.text('Private note'), findsNothing);
      expect(find.byType(TextField), findsNothing);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets(
    'live signal loads new text incrementally and disconnect retires it',
    (tester) async {
      final api = LiveChatApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: FoodChatPageView(
            api: api,
            assignmentId: id,
            thai: false,
            rider: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Incoming 1'), findsOneWidget);
      expect(api.reads, ['before:0']);
      api.count = 2;
      api.publish();
      await tester.pumpAndSettle();
      expect(find.text('Incoming 2'), findsOneWidget);
      expect(api.reads, ['before:0', 'after:1']);
      expect(api.sent, isEmpty);
      api.signals.add(
        const FoodRealtimeDisconnected(
          MobileApiException('REALTIME_DISCONNECTED', 503),
        ),
      );
      await tester.pump();
      expect(find.text('Incoming 1'), findsNothing);
      expect(find.text('Incoming 2'), findsNothing);
      api.publish();
      await tester.pumpAndSettle();
      expect(find.text('Incoming 2'), findsOneWidget);
      expect(api.reads.last, 'before:0');
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets(
    'read badge requires peer acknowledgement, background clears badge',
    (tester) async {
      final api = ReadChatApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: FoodChatPageView(
            api: api,
            assignmentId: id,
            thai: false,
            rider: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(api.acknowledgements, ['1']);
      expect(find.textContaining('· Read'), findsNothing);
      api.peerRead();
      await tester.pumpAndSettle();
      expect(find.textContaining('· Read'), findsOneWidget);
      final dynamic state = tester.state(find.byType(FoodChatPageView));
      state.didChangeAppLifecycleState(AppLifecycleState.paused);
      await tester.pump();
      expect(find.textContaining('· Read'), findsNothing);
      expect(find.text('Own unconfirmed read'), findsNothing);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets(
    'latest chat position only acknowledges a visible counterpart message',
    (tester) async {
      final api = ReadChatApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: FoodChatPageView(
            api: api,
            assignmentId: id,
            thai: false,
            rider: false,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(api.acknowledgements, ['1']);
      await tester.scrollUntilVisible(
        find.text('Counterpart visible message'),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(api.acknowledgements, ['1']);
      await tester.pumpWidget(const MaterialApp());
    },
  );
}
