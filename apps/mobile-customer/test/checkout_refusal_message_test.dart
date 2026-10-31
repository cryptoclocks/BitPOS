import 'package:bitpos_customer/food_labels.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';

void main() {
  test('expired price and minimum spend get their own coupon reasons, not the generic one', () {
    const expired = MobileApiException('QUOTE_CHANGED', 409, 'COUPON_QUOTE_EXPIRED');
    const minimum = MobileApiException('QUOTE_CHANGED', 409, 'COUPON_MINIMUM_NOT_MET');
    const generic = MobileApiException('QUOTE_CHANGED', 409, 'COUPON_INELIGIBLE');
    expect(checkoutRefusalMessage(expired, true), contains('หมดอายุ'));
    expect(checkoutRefusalMessage(expired, false), contains('expired'));
    expect(checkoutRefusalMessage(minimum, true), contains('ขั้นต่ำ'));
    expect(checkoutRefusalMessage(minimum, false), contains('minimum'));
    expect(checkoutRefusalMessage(generic, true), isNot(contains('หมดอายุ')));
  });
}
