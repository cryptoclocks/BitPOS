import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'mobile_session_race_test.dart' as fixture;

// E2E 2026-10-30 P0-3: the customer's "issue delivery code" failed twice with no request reaching the
// server. The command marker was written first and the expiring access token was refreshed afterwards,
// so a failed/rotated refresh left an "unresolved" marker for a command that was never sent.
const assignment = '00000000-0000-4000-8000-000000000091';
FoodDeliveryProofMutation issue() => FoodDeliveryProofMutation(
  assignment,
  FoodProofIssueCommand(
    idempotencyKey: '00000000-0000-4000-8000-000000000092',
    generation: '2',
    leaseGeneration: '3',
    rotate: false,
  ),
);
Map<String, dynamic> expiring(String digit) => {
  ...fixture.session(digit),
  'accessExpiresAt': DateTime.now()
      .add(const Duration(seconds: 5))
      .toUtc()
      .toIso8601String(),
};
Map<String, dynamic> receipt() => {
  'proofId': '00000000-0000-4000-8000-000000000093',
  'assignmentId': assignment,
  'kind': 'DELIVERY',
  'expiresAt': '2099-01-01T00:00:00Z',
  'generation': '2',
  'leaseGeneration': '3',
  'replayed': false,
  'secretRecoveryRequired': false,
  'secret': 'abcdEFGHijklMNOPqrstUVWXyz0123456789_-ABCDe',
};
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(
    () => FlutterSecureStorage.setMockInitialValues({
      'bitpos.deviceId': '00000000-0000-4000-8000-000000000099',
      'bitpos.mobileSession': jsonEncode(expiring('1')),
    }),
  );
  test('expiring token is refreshed before the marker; the command is sent once', () async {
    var posts = 0, refreshes = 0;
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
      client: MockClient((request) async {
        if (request.url.path.endsWith('/auth/refresh')) {
          refreshes++;
          return http.Response(jsonEncode(fixture.session('2')), 200);
        }
        posts++;
        return http.Response(jsonEncode(receipt()), 200);
      }),
    );
    addTearDown(api.close);
    await api.restore();
    final result = await api.submitFoodDispatch(issue());
    expect(result, isA<FoodProofIssueReceipt>());
    expect((result as FoodProofIssueReceipt).secret, hasLength(43));
    expect((refreshes, posts), (1, 1));
    expect(await api.pendingFoodDispatch(), isNull);
  });
  test('a refresh that fails before sending leaves no unresolved marker', () async {
    var posts = 0;
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
      client: MockClient((request) async {
        if (request.url.path.endsWith('/auth/refresh')) {
          throw http.ClientException('Synthetic refresh network failure');
        }
        posts++;
        return http.Response(jsonEncode(receipt()), 200);
      }),
    );
    addTearDown(api.close);
    await api.restore();
    await expectLater(
      api.submitFoodDispatch(issue()),
      throwsA(isA<http.ClientException>()),
    );
    expect(posts, 0);
    expect(await api.pendingFoodDispatch(), isNull);
  });
}
