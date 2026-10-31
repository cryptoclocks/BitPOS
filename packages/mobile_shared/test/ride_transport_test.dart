import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'mobile_session_race_test.dart' as fixture;

const tripId = '00000000-0000-4000-8000-000000000051';
const account = '00000000-0000-4000-8000-000000000052';
Map<String, Object?> trip(String state) => {
      'id': tripId,
      'state': state,
      'seats': 1,
      'shared': false,
      'fare': {'currency': 'THB', 'decimals': 2, 'amountMinor': '7500'},
      'distanceMetres': 5000,
      'durationSeconds': 600,
      'pickup': {'latitudeE7': 137560000, 'longitudeE7': 1005018000},
      'dropoff': {'latitudeE7': 137600000, 'longitudeE7': 1005100000},
      'version': '1',
      'riderAccountId': account,
      'driverAccountId': null,
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('ride client calls the ride routes with bearer auth and parses generated models', () async {
    FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession': jsonEncode(fixture.session('1'))});
    final seen = <String>[];
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
      client: MockClient((request) async {
        seen.add('${request.method} ${request.url.path.replaceFirst('/api/mobile/v1/', '')}');
        expect(request.headers['Authorization'], startsWith('Bearer '));
        final path = request.url.path;
        Object? body;
        if (path.endsWith('/rides/quote')) {
          body = {'rateId': tripId, 'fare': {'currency': 'THB', 'decimals': 2, 'amountMinor': '7500'}, 'seats': 1, 'shared': false};
        } else if (path.endsWith('/rides')) {
          body = {'trip': trip('REQUESTED'), 'pin': '4821'};
        } else if (path.endsWith('/rides/open')) {
          body = {'trips': [trip('REQUESTED')]};
        } else if (path.endsWith('/start')) {
          expect(jsonDecode(request.body), {'pin': '4821'});
          body = trip('IN_TRIP');
        } else {
          body = trip(path.endsWith('/accept') ? 'MATCHED' : path.endsWith('/arrive') ? 'ARRIVED' : path.endsWith('/complete') ? 'COMPLETED' : path.endsWith('/cancel') ? 'CANCELLED' : 'REQUESTED');
        }
        return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json'});
      }),
    );
    addTearDown(api.close);
    await api.restore();
    final quote = await api.quoteRide(MobileRideQuoteRequest(distanceMetres: 5000, durationSeconds: 600, seats: 1, shared: false));
    expect(quote.fare.amountMinor, '7500');
    final made = await api.requestRide(MobileRideRequest(
      idempotencyKey: '00000000-0000-4000-8000-000000000053',
      distanceMetres: 5000,
      durationSeconds: 600,
      seats: 1,
      shared: false,
      pickup: MobileRidePoint(latitudeE7: 137560000, longitudeE7: 1005018000),
      dropoff: MobileRidePoint(latitudeE7: 137600000, longitudeE7: 1005100000),
    ));
    expect(made.pin, '4821');
    expect((await api.ride(tripId)).state, 'REQUESTED');
    expect((await api.openRides()).trips, hasLength(1));
    expect((await api.acceptRide(tripId)).state, 'MATCHED');
    expect((await api.arriveRide(tripId)).state, 'ARRIVED');
    expect((await api.startRide(tripId, '4821')).state, 'IN_TRIP');
    expect((await api.completeRide(tripId)).state, 'COMPLETED');
    expect((await api.cancelRide(tripId)).state, 'CANCELLED');
    expect(seen, [
      'POST rides/quote',
      'POST rides',
      'GET rides/$tripId',
      'GET rides/open',
      'POST rides/$tripId/accept',
      'POST rides/$tripId/arrive',
      'POST rides/$tripId/start',
      'POST rides/$tripId/complete',
      'POST rides/$tripId/cancel',
    ]);
  });
}
