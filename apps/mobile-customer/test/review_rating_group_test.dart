import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/review_rating_group.dart';

void main() {
  testWidgets('narrow large Thai rating keeps all five targets and explicit selected score', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320,900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var chosen = 0;
    await tester.pumpWidget(MaterialApp(home: MediaQuery(data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
      child: Scaffold(body: SingleChildScrollView(child: Padding(padding: const EdgeInsets.all(24),
        child: ReviewRatingGroup(title:'ให้คะแนนไรเดอร์ (ไม่บังคับ)', value:3, thai:true, onChanged:(n)=>chosen=n)))))));
    expect(find.byType(IconButton), findsNWidgets(5));
    expect(find.text('3 / 5'), findsOneWidget);
    await tester.tap(find.byTooltip('5 / 5')); expect(chosen,5);
    for(final element in find.byType(IconButton).evaluate()) {
      final rect = tester.getRect(find.byWidget(element.widget));
      expect(rect.width, greaterThanOrEqualTo(48));
      expect(rect.height, greaterThanOrEqualTo(48));
    }
    expect(tester.takeException(), isNull);
  });
}
