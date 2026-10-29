import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'mobile_session_race_test.dart' as fixture;

const id = '00000000-0000-4000-8000-000000000041';
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('private image is bearer authorized and checked against message digest before decode', () async {
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': jsonEncode(fixture.session('1')),
    });
    final bytes = await File('test/fixtures/chat-photo.jpg').readAsBytes();
    var calls = 0;
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
      client: MockClient((request) async {
        calls++;
        expect(request.headers['Authorization'], startsWith('Bearer '));
        expect(request.followRedirects, false);
        return http.Response.bytes(
          bytes,
          200,
          headers: {'content-type': 'image/jpeg'},
        );
      }),
    );
    addTearDown(api.close);
    await api.restore();
    FoodChatAttachment image(String digest) => FoodChatAttachment(
      id: id,
      mime: 'image/jpeg',
      byteLength: bytes.length,
      width: 24,
      height: 16,
      sha256: digest,
      state: 'READY',
    );
    expect(
      await api.foodChatImage(id, image(sha256.convert(bytes).toString())),
      bytes,
    );
    await expectLater(
      api.foodChatImage(id, image('0' * 64)),
      throwsFormatException,
    );
    expect(calls, 2);
  });
}
