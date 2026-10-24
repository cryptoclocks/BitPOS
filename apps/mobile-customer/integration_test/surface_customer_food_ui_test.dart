import 'package:integration_test/integration_test.dart';

import '../test/surface_customer_food_ui_test.dart' as surface;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  surface.registerCustomerFoodSurfaceTests(native: true);
}
