// Synthetic addresses only. No provider, payment, GPS or physical-device proof.
import 'package:integration_test/integration_test.dart';

import '../test/address_route_owner_test.dart' as regression;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  regression.main();
}
