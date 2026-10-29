import 'package:flutter/material.dart';

/// Honest unavailable state until the coupon lifecycle is admitted by the API.
class CartCouponPage extends StatelessWidget {
  const CartCouponPage({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(t('คูปองส่วนลด', 'Discount coupons'))),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(
                    Icons.local_offer_outlined,
                    size: 56,
                    color: colors.primary,
                  ),
                  const SizedBox(height: 24),
                  Text(
                    t('ยังใช้คูปองไม่ได้', 'Coupons are not available yet'),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    t(
                      'ระบบยังไม่เปิดให้เลือกและใช้คูปองกับออเดอร์นี้ ยอดในตะกร้ายังไม่เปลี่ยนแปลง',
                      'Coupon selection and redemption are not enabled for this order. Your cart total has not changed.',
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(t('กลับไปตะกร้า', 'Back to cart')),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
