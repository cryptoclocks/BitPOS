import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/presentation/ui_catalog.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('all missing native presentation screens on Android', (
    tester,
  ) async {
    const filter = String.fromEnvironment('BITPOS_UI_SCREENS');
    final ids = filter.isEmpty ? missingUiScreens.keys : filter.split(',');
    for (final id in ids) {
      expect(missingUiScreens.containsKey(id), isTrue, reason: id);
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: BitPosTheme.light(),
          home: UiPreviewRoute(key: ValueKey(id), id: id, thai: true),
        ),
      );
      await tester.pump(const Duration(milliseconds: 400));
      expect(tester.takeException(), isNull, reason: id);
      debugPrint('BITPOS_UI_CATALOG_VISIBLE:$id');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 1200)),
      );
    }
  });
}
