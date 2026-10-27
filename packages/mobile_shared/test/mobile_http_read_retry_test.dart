import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_shared/mobile_api.dart';

class _ScriptedClient extends http.BaseClient {
  _ScriptedClient(this.reply);

  final Future<http.StreamedResponse> Function(http.BaseRequest, int) reply;
  int sends = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      reply(request, ++sends);
}

http.StreamedResponse _jsonResponse(Object value) => http.StreamedResponse(
  Stream.value(utf8.encode(jsonEncode(value))),
  200,
  headers: {'content-type': 'application/json'},
);

void main() {
  final base = Uri.parse('http://127.0.0.1/api/mobile/v1/');

  test(
    'GET retries one stale pooled socket before any response header',
    () async {
      final client = _ScriptedClient((request, attempt) async {
        expect(request.method, 'GET');
        if (attempt == 1) {
          throw http.ClientException(
            'Connection closed before full header was received',
            request.url,
          );
        }
        return _jsonResponse({'branches': [], 'nextCursor': null});
      });
      final api = MobileApi(base: base, fixture: true, client: client);
      addTearDown(api.close);

      final result = await api.branches();
      expect(result.branches, isEmpty);
      expect(client.sends, 2);
    },
  );

  test('POST is never retried after ambiguous connection closure', () async {
    final client = _ScriptedClient((request, attempt) async {
      expect(request.method, 'POST');
      throw http.ClientException(
        'Connection closed before full header was received',
        request.url,
      );
    });
    final api = MobileApi(base: base, fixture: true, client: client);
    addTearDown(api.close);

    await expectLater(
      api.requestOtp('+66812345678'),
      throwsA(isA<http.ClientException>()),
    );
    expect(client.sends, 1);
  });

  test('other GET transport failures are not retried', () async {
    final client = _ScriptedClient((request, attempt) async {
      throw http.ClientException('Connection refused', request.url);
    });
    final api = MobileApi(base: base, fixture: true, client: client);
    addTearDown(api.close);

    await expectLater(api.branches(), throwsA(isA<http.ClientException>()));
    expect(client.sends, 1);
  });

  test('stale-socket GET stops after one retry', () async {
    final client = _ScriptedClient((request, attempt) async {
      throw http.ClientException(
        'Connection closed before full header was received',
        request.url,
      );
    });
    final api = MobileApi(base: base, fixture: true, client: client);
    addTearDown(api.close);

    await expectLater(api.branches(), throwsA(isA<http.ClientException>()));
    expect(client.sends, 2);
  });
}
