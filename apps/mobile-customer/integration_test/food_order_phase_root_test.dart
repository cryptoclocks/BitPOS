import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import '../test/food_order_phase_root_test.dart' as phase;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  phase.registerOrderPhaseRootTests(native: true, capture: (tester, stage) async {
    // External ADB capture consumes these markers without persisting fixture credentials.
    print('BITPOS_ORDER_PHASE_CAPTURE:$stage');
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
  });
}
