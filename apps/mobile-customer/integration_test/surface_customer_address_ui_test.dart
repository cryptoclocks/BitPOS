import 'package:integration_test/integration_test.dart';

import '../test/surface_customer_address_ui_test.dart' as surface;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  surface.registerAddressSurfaceTests(native: true);
}
