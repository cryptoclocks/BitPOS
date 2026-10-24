import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/mobile_api.dart';

import 'food_realtime_test.dart' show RealtimeClient;
import 'mobile_session_race_test.dart' show session;

const id = '00000000-0000-4000-8000-000000000041';
String frame({String assignment = id}) {
  const cursor = 'f1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  return 'id: $cursor\nevent: snapshot\ndata: ${jsonEncode({'assignmentId': assignment, 'latestSequence': '52',
            'peerReadSequence': '0', 'serverTime': '2026-10-20T01:00:00Z', 'cursor': cursor})}\n\n';
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('split sequence-only frames publish matching assignment then EOF clears authority', () async {
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': jsonEncode(session('1')),
    });
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
      client: RealtimeClient((request) {
        expect(
          request.url.path,
          '/api/mobile/v1/food/assignments/$id/chat/events',
        );
        expect(request.headers['Accept'], 'text/event-stream');
        return Stream.fromIterable(utf8.encode(frame()).map((byte) => [byte]));
      }),
    );
    addTearDown(api.close);
    await api.restore();
    final states = await api.watchFoodChat(id).take(3).toList();
    expect(states.first, isA<FoodRealtimeConnecting>());
    expect(states[1].snapshot!.latestSequence, '52');
    expect(states[1].snapshot!.toJson().containsKey('body'), false);
    expect(states.last, isA<FoodRealtimeDisconnected>());
    expect(states.last.snapshot, isNull);
  });
  test('different assignment signal never becomes live', () async {
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': jsonEncode(session('1')),
    });
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
      client: RealtimeClient(
        (_) => Stream.value(
          utf8.encode(
            frame(assignment: '00000000-0000-4000-8000-000000000042'),
          ),
        ),
      ),
    );
    addTearDown(api.close);
    await api.restore();
    final states = await api.watchFoodChat(id).take(2).toList();
    expect(states.every((state) => state.snapshot == null), true);
    expect(states.last.error, isA<FormatException>());
  });
}
