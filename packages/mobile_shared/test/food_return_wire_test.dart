import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

void main() {
  test('return snapshot keeps API case key while exposing a legal Dart field', () {
    final wire = <String, dynamic>{
      'assignmentId': '00000000-0000-4000-8000-000000000001',
      'shipmentVersion': '7',
      'case': {
        'caseId': '00000000-0000-4000-8000-000000000002',
        'state': 'RETURN_RESOLVED',
        'requestedAt': '2026-10-21T01:00:00Z',
        'receivedAt': '2026-10-21T01:01:00Z',
        'condition': 'DAMAGED',
        'resolvedAt': '2026-10-21T01:02:00Z',
        'custodyReleased': true,
        'financialReview': 'PENDING',
      },
    };
    final snapshot = FoodReturnSnapshot.fromJson(wire);
    expect(snapshot.caseValue?.state, 'RETURN_RESOLVED');
    expect(snapshot.toJson(), wire);
    expect(snapshot.toJson().containsKey('caseValue'), false);
    expect(FoodReturnSnapshot.fromJson({...wire, 'case': null}).caseValue, isNull);
  });
}
