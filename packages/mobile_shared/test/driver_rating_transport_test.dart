import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';

import 'mobile_session_race_test.dart' as fixture;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('driver rating transport rejects inconsistent count/average instead of displaying invented rating', () async {
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': jsonEncode(fixture.session('1')),
    });
    var count = '0';
    int? average;
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
      client: MockClient((r) async {
        expect(r.method, 'GET');
        expect(r.url.path, '/api/mobile/v1/driver/reviews/summary');
        expect(r.url.query, isEmpty);
        expect(r.headers['Authorization'], startsWith('Bearer '));
        return http.Response(
          jsonEncode({
            'driverId': '00000000-0000-4000-8000-000000000041',
            'publishedCount': count,
            'averageTenths': average,
            'snapshotAt': DateTime.now().toUtc().toIso8601String(),
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );
    addTearDown(api.close);
    await api.restore();
    expect((await api.driverReviewSummary()).averageTenths, isNull);
    average = 43;
    await expectLater(api.driverReviewSummary(), throwsFormatException);
    count = '4';
    expect((await api.driverReviewSummary()).averageTenths, 43);
    average = null;
    await expectLater(api.driverReviewSummary(), throwsFormatException);
  });
}
