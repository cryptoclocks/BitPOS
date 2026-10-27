import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';

import 'mobile_session_race_test.dart' as fixture;

const assignment = '00000000-0000-4000-8000-000000000041';
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  void initialize() => FlutterSecureStorage.setMockInitialValues({
    'bitpos.deviceId': '00000000-0000-4000-8000-000000000099',
    'bitpos.mobileSession': jsonEncode(fixture.session('1')),
  });
  test(
    'lost chat ack survives restart and only exact command may recover',
    () async {
      initialize();
      bool committed = false;
      final keys = <String>[];
      MobileApi make() => MobileApi(
        base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
        fixture: true,
        client: MockClient((r) async {
          final command = jsonDecode(r.body) as Map<String, dynamic>;
          keys.add(command['commandId'] as String);
          if (!committed) {
            committed = true;
            throw http.ClientException('lost response');
          }
          return http.Response(
            jsonEncode({
              'attachments': [],
              'id': assignment,
              'assignmentId': assignment,
              'commandId': command['commandId'],
              'sequence': '1',
              'senderRole': 'CUSTOMER',
              'mine': true,
              'body': command['body'],
              'createdAt': '2026-10-20T01:00:00Z',
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final first = make();
      await first.restore();
      final command = first.newFoodChatMessage('Hello ไรเดอร์');
      await expectLater(
        first.sendFoodChat(assignment, command),
        throwsA(isA<http.ClientException>()),
      );
      first.close();
      final next = make();
      addTearDown(next.close);
      await next.restore();
      final saved = await next.pendingFoodChatMessage(assignment);
      expect(saved!.toJson(), command.toJson());
      await expectLater(
        next.sendFoodChat(assignment, next.newFoodChatMessage('Replacement')),
        throwsA(
          isA<MobileApiException>().having(
            (e) => e.code,
            'code',
            'PENDING_CHAT_RECOVERY_REQUIRED',
          ),
        ),
      );
      await next.sendFoodChat(assignment, saved);
      expect(await next.pendingFoodChatMessage(assignment), isNull);
      expect(keys, [command.commandId, command.commandId]);
    },
  );
  test(
    'wrong command receipt cannot clear saved private chat command',
    () async {
      initialize();
      final api = MobileApi(
        base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
        fixture: true,
        client: MockClient(
          (r) async => http.Response(
            jsonEncode({
              'attachments': [],
              'id': assignment,
              'assignmentId': assignment,
              'commandId': assignment,
              'sequence': '1',
              'senderRole': 'CUSTOMER',
              'mine': true,
              'body': 'Hello',
              'createdAt': '2026-10-20T01:00:00Z',
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        ),
      );
      addTearDown(api.close);
      await api.restore();
      final command = api.newFoodChatMessage('Hello');
      await expectLater(
        api.sendFoodChat(assignment, command),
        throwsFormatException,
      );
      expect(
        (await api.pendingFoodChatMessage(assignment))!.commandId,
        command.commandId,
      );
    },
  );
  test(
    'only explicit scoped image-expired rejection retires unsent photo command',
    () async {
      for (final scenario in [
        (status: 410, photos: true, clear: true),
        (status: 500, photos: true, clear: false),
        (status: 410, photos: false, clear: false),
      ]) {
        initialize();
        final api = MobileApi(
          base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
          fixture: true,
          client: MockClient(
            (r) async => http.Response(
              jsonEncode({
                'error': {
                  'code': 'CHAT_IMAGE_EXPIRED',
                  'message': 'CHAT_IMAGE_EXPIRED',
                  'retryable': false,
                },
              }),
              scenario.status,
              headers: {'content-type': 'application/json; charset=utf-8'},
            ),
          ),
        );
        await api.restore();
        final command = api.newFoodChatMessage(
          'Caption remains editable',
          attachmentIds: scenario.photos ? [assignment] : [],
        );
        await expectLater(
          api.sendFoodChat(assignment, command),
          throwsA(isA<MobileApiException>()),
        );
        final pending = await api.pendingFoodChatMessage(assignment);
        if (scenario.clear) {
          expect(pending, isNull);
        } else {
          expect(pending!.commandId, command.commandId);
        }
        api.close();
      }
    },
  );
}
