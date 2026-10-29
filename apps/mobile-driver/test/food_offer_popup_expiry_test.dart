import 'package:flutter/services.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'food_realtime_lifecycle_test.dart' as fixture;

void main() {
  for (final selection in ['expired-pointer', 'expired-keyboard', 'current-pointer']) {
  testWidgets('production decline popup selection $selection', (tester) async {
    final previous = GeolocatorPlatform.instance;
    final native = fixture.ActiveNative();
    GeolocatorPlatform.instance = native;
    final api = fixture.LiveWorkApi();
    addTearDown(() { api.close(); native.close(); GeolocatorPlatform.instance = previous; });
    final deadline = DateTime.now().add(const Duration(seconds: 45));
    api.current = FoodDriverWork(offers: [FoodDriverOffer(
      id: '11111111-1111-4111-8111-111111111111',
      shipmentId: '22222222-2222-4222-8222-222222222222',
      generation: '1', version: '1', expiresAt: deadline.toUtc().toIso8601String(),
      pickupLatitudeE7: 137560000, pickupLongitudeE7: 1005018000,
      earning: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '100'), fixture: true,
    )], assignment: null);
    await fixture.mount(tester, api);
    final menu = find.byTooltip('Decline with reason');
    await tester.scrollUntilVisible(menu, 300);
    await tester.ensureVisible(menu); await tester.pumpAndSettle();
    await tester.tap(menu); await tester.pumpAndSettle();
    expect(find.text('Safety concern'), findsOneWidget);
    if(selection!='current-pointer'){
      await tester.runAsync(() => Future<void>.delayed(
        deadline.difference(DateTime.now()) + const Duration(milliseconds: 100),
      ));
      await tester.pumpAndSettle();
    }
    if(selection=='expired-keyboard'){
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    }else{
      await tester.tap(find.text('Safety concern'));
    }
    await tester.pumpAndSettle();
    if(selection=='current-pointer'){
      expect(api.submitted.single, isA<FoodDeclineMutation>().having((v)=>v.command.reason,'reason','SAFETY'));
    }else{
      expect(api.submitted, isEmpty);
      expect(find.textContaining('Recover same command'), findsNothing);
    }
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
  });
  }
}
