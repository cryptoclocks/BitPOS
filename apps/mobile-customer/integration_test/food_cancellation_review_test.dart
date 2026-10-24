import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/food_cancellation_review_mutation.dart';
import 'package:bitpos_customer/food_cancellation_review_page.dart';
import 'package:http/http.dart' as http;

class ObservedReviewClient extends http.BaseClient {
  final http.Client inner = http.Client();
  ObservedReviewClient({this.loseCommittedResponse = false});
  bool loseCommittedResponse;
  int sequence = 0;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (!request.url.path.endsWith('/cancellation-reviews')) {
      return inner.send(request);
    }
    final id = ++sequence, clock = Stopwatch()..start();
    void trace(String phase) => debugPrint(
      'BITPOS_CANCELLATION083_HTTP $id ${request.method} $phase elapsedMs=${clock.elapsedMilliseconds}',
    );
    trace('send');
    try {
      final response = await inner.send(request);
      var bytes = 0;
      trace(
        'headers status=${response.statusCode} contentType=${response.headers['content-type']}',
      );
      if (loseCommittedResponse &&
          request.method == 'POST' &&
          response.statusCode == 200) {
        loseCommittedResponse = false;
        await response.stream.drain<void>();
        debugPrint('BITPOS_CANCELLATION083_COMMITTED_RESPONSE_DROPPED');
        throw http.ClientException('Synthetic committed response loss');
      }
      final stream = response.stream.transform<List<int>>(
        StreamTransformer.fromHandlers(
          handleData: (chunk, sink) {
            bytes += chunk.length;
            sink.add(chunk);
          },
          handleError: (Object error, StackTrace stack, sink) {
            trace('body-error class=${error.runtimeType} bytes=$bytes');
            sink.addError(error, stack);
          },
          handleDone: (sink) {
            trace('body-complete bytes=$bytes');
            sink.close();
          },
        ),
      );
      return http.StreamedResponse(
        stream,
        response.statusCode,
        contentLength: response.contentLength,
        request: response.request,
        headers: response.headers,
        isRedirect: response.isRedirect,
        persistentConnection: response.persistentConnection,
        reasonPhrase: response.reasonPhrase,
      );
    } catch (error, stack) {
      trace('send-error class=${error.runtimeType}');
      debugPrintStack(
        stackTrace: stack,
        label: 'BITPOS_CANCELLATION083_HTTP_STACK',
      );
      rethrow;
    }
  }

  @override
  void close() => inner.close();
}

class ObservedReviewApi extends MobileApi {
  ObservedReviewApi({bool loseCommittedResponse = false})
    : super(
        base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
        fixture: true,
        client: ObservedReviewClient(
          loseCommittedResponse: loseCommittedResponse,
        ),
      );
  @override
  Future<FoodCancellationReviewReceipt> submitCancellationReview(
    FoodCancellationReviewMutation mutation,
  ) async {
    debugPrint(
      'BITPOS_CANCELLATION083_SUBMIT command=${mutation.command.idempotencyKey}',
    );
    try {
      final receipt = await super.submitCancellationReview(mutation);
      debugPrint('BITPOS_CANCELLATION083_SUBMIT_COMPLETE');
      return receipt;
    } catch (error, stack) {
      debugPrint(
        'BITPOS_CANCELLATION083_SUBMISSION_ERROR class=${error.runtimeType} code=${error is MobileApiException ? error.code : 'non-api'}',
      );
      debugPrintStack(
        stackTrace: stack,
        label: 'BITPOS_CANCELLATION083_SUBMISSION_STACK',
      );
      rethrow;
    }
  }

  @override
  Future<FoodCancellationReviewMutation?> pendingCancellationReview() async {
    try {
      final pending = await super.pendingCancellationReview();
      debugPrint(
        'BITPOS_CANCELLATION083_JOURNAL pending=${pending != null} command=${pending?.command.idempotencyKey}',
      );
      return pending;
    } catch (error, stack) {
      debugPrint(
        'BITPOS_CANCELLATION083_JOURNAL_ERROR class=${error.runtimeType}',
      );
      debugPrintStack(
        stackTrace: stack,
        label: 'BITPOS_CANCELLATION083_JOURNAL_STACK',
      );
      rethrow;
    }
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'native customer review request and staff disposition preserve active order and custody',
    (tester) async {
      if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
        throw StateError('Explicit local fixture required');
      }
      const orderId = String.fromEnvironment('BITPOS_TEST_ORDER_ID');
      if (!RegExp(r'^[0-9a-f-]{36}$').hasMatch(orderId)) {
        throw StateError('Fixture order required');
      }
      final session = jsonDecode(
        utf8.decode(
          base64Decode(
            const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'),
          ),
        ),
      );
      FlutterSecureStorage.setMockInitialValues({
        'bitpos.mobileSession': jsonEncode(session),
        'bitpos.deviceId': '00000000-0000-4000-8000-000000000083',
      });
      const responseLoss = bool.fromEnvironment(
        'BITPOS_TEST_LOSE_CANCELLATION_RESPONSE',
      );
      var api = ObservedReviewApi(loseCommittedResponse: responseLoss);
      await api.restore();
      addTearDown(() => api.close());
      final initial = await api.foodCustomerWork(orderId);
      expect(initial.state, 'AT_PICKUP');
      expect((await api.foodCancellationReviews(orderId)).items, isEmpty);
      await tester.pumpWidget(
        MaterialApp(
          theme: BitPosTheme.light(),
          home: FoodCancellationReviewPage(
            api: api,
            orderId: orderId,
            shipmentId: initial.shipmentId,
            thai: false,
            owner: null,
            onAuthenticationRequired: () =>
                throw StateError('Fixture auth unexpectedly lost'),
          ),
        ),
      );
      Future<void> wait(Finder finder) async {
        final until = DateTime.now().add(const Duration(seconds: 30));
        while (finder.evaluate().isEmpty && DateTime.now().isBefore(until)) {
          await tester.pump(const Duration(milliseconds: 200));
        }
        expect(finder, findsOneWidget);
      }

      final detail = find.byKey(
        const ValueKey('food-cancellation-review-detail'),
      );
      await wait(detail);
      await tester.tap(
        find.byKey(const ValueKey('food-cancellation-reason.LATE_ORDER')),
      );
      await tester.pumpAndSettle();
      final firstReason = find.byKey(
        const ValueKey('food-cancellation-reason.CHANGE_OF_PLANS'),
      );
      final secondReason = find.byKey(
        const ValueKey('food-cancellation-reason.LATE_ORDER'),
      );
      debugPrint(
        'BITPOS_CANCELLATION083_GEOMETRY first=${tester.getRect(firstReason)} second=${tester.getRect(secondReason)} detail=${tester.getRect(detail)}',
      );
      debugPrint('BITPOS_CANCELLATION083_FORM_READY');
      await tester.ensureVisible(detail);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.enterText(
        detail,
        'AVD synthetic private cancellation review. Request only, not payment or delivery.',
      );
      final send = find.byKey(const ValueKey('food-cancellation-review-send'));
      await tester.ensureVisible(send);
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        tester.widget<TextField>(detail).controller!.text,
        'AVD synthetic private cancellation review. Request only, not payment or delivery.',
      );
      expect(tester.widget<FilledButton>(send).onPressed, isNotNull);
      await tester.tap(send);
      await tester.pump();
      if (responseLoss) {
        final retry = find.text('Retry exact saved review request');
        await wait(retry);
        final saved = await api.pendingCancellationReview();
        expect(saved, isNotNull);
        expect(
          find.byKey(const ValueKey('food-cancellation-review-recorded')),
          findsNothing,
        );
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
        api.close();
        api = ObservedReviewApi();
        await api.restore();
        final restored = await api.pendingCancellationReview();
        expect(restored!.toJson(), saved!.toJson());
        final committed = await api.foodCancellationReviews(orderId);
        expect(committed.items.single, isA<FoodCancellationReviewOpen>());
        await tester.pumpWidget(
          MaterialApp(
            theme: BitPosTheme.light(),
            home: FoodCancellationReviewPage(
              api: api,
              orderId: orderId,
              shipmentId: initial.shipmentId,
              thai: false,
              owner: null,
              onAuthenticationRequired: () =>
                  throw StateError('Fixture auth unexpectedly lost'),
            ),
          ),
        );
        await wait(retry);
        await tester.ensureVisible(retry);
        await tester.pump(const Duration(milliseconds: 300));
        await tester.tap(retry);
        await tester.pump();
        debugPrint(
          'BITPOS_CANCELLATION083_RESTORED_EXACT_RETRY command=${restored.command.idempotencyKey}',
        );
      }
      final recorded = find.byKey(
        const ValueKey('food-cancellation-review-recorded'),
      );
      try {
        await wait(recorded);
      } catch (_) {
        debugPrint(
          'BITPOS_CANCELLATION083_DIAGNOSTIC ${tester.widgetList<Text>(find.byType(Text)).map((value) => value.data).whereType<String>().where((value) => value.contains('confirmed') || value.contains('INVALID') || value.contains('PENDING') || value.contains('REQUEST') || value.contains('AUTH') || value.contains('VERSION') || value.contains('NETWORK')).toList()}',
        );
        rethrow;
      }
      await tester.ensureVisible(recorded);
      await tester.pump(const Duration(milliseconds: 300));
      expect(await api.pendingCancellationReview(), isNull);
      expect((await api.foodCustomerWork(orderId)).state, initial.state);
      debugPrint('BITPOS_CANCELLATION083_REQUESTED');
      final deadline = DateTime.now().add(const Duration(seconds: 40));
      FoodCancellationReviewOwnPage? history;
      while (DateTime.now().isBefore(deadline)) {
        history = await api.foodCancellationReviews(orderId);
        if (history.items.single is FoodCancellationReviewReviewed) break;
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 400)),
        );
      }
      final reviewed = history!.items.single;
      expect(reviewed, isA<FoodCancellationReviewReviewed>());
      expect(
        (reviewed as FoodCancellationReviewReviewed).decision,
        'COMPENSATION_REVIEW_REQUIRED',
      );
      final reload = find.byKey(
        const ValueKey('food-cancellation-review-refresh'),
      );
      await tester.ensureVisible(reload);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(reload);
      await tester.pump();
      final explanation = find.text(reviewed.customerExplanation);
      await wait(explanation);
      await tester.ensureVisible(explanation);
      await tester.pump(const Duration(milliseconds: 300));
      expect((await api.foodCustomerWork(orderId)).state, initial.state);
      expect(tester.takeException(), isNull);
      debugPrint('BITPOS_CANCELLATION083_REVIEW_VISIBLE');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 3)),
      );
    },
  );
}
