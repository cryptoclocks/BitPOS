// Actual FoodWorkPage on Android with deterministic local API/native fixtures.
// No provider, dispatch, payment or physical GPS proof.
import 'package:integration_test/integration_test.dart';
import '../test/food_offer_popup_expiry_test.dart' as scenarios;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  scenarios.main();
}
