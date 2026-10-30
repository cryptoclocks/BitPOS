import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'food_presentation.dart';

/// U09 menu row. Catalogue prices are not configured or payable totals.
class FoodProductCard extends StatelessWidget {
  const FoodProductCard({
    super.key,
    required this.product,
    required this.thai,
    this.onConfigure,
    this.inCart = 0,
  });
  final MobileProduct product;
  final bool thai;
  final VoidCallback? onConfigure;
  /// Quantity of this product already in the cart, shown where the customer just added it.
  final int inCart;
  String t(String th, String en) => thai ? th : en;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final preferred = thai ? product.name : product.nameEn;
    final name = preferred.trim().isNotEmpty
        ? preferred
        : (thai ? product.nameEn : product.name);
    final price = product.unitPrice;
    final details = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          name.trim().isEmpty ? t('สินค้ายังไม่มีชื่อ', 'Unnamed item') : name,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        if (product.description.trim().isNotEmpty)
          Text(
            product.description,
            style: Theme.of(context).textTheme.bodySmall,
          )
        else if (product.category.trim().isNotEmpty)
          Text(product.category, style: Theme.of(context).textTheme.bodySmall),
        if (product.available == 0)
          Text(
            t('สินค้าหมด', 'Sold out'),
            style: TextStyle(color: colors.error),
          ),
        if (inCart > 0)
          Text(
            '${t('ในตะกร้า', 'In cart')} ×$inCart',
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: colors.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
      ],
    );
    final amount = Text(
      price == null
          ? t('ยังไม่ตั้งราคา', 'Pricing unavailable')
          : formatMinorUnits(price.amountMinor, price.decimals, price.currency),
      textAlign: TextAlign.end,
      style: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: colors.primary,
      ),
    );
    final action = Text(
      t('เลือก / เพิ่ม', 'Configure / add'),
      style: Theme.of(context).textTheme.bodySmall
          ?.copyWith(color: colors.primary),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: OutlinedButton(
        onPressed: onConfigure,
        style: OutlinedButton.styleFrom(
          foregroundColor: colors.onSurface,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          minimumSize: const Size(48, 82),
          alignment: Alignment.centerLeft,
          side: BorderSide(color: colors.outlineVariant),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          backgroundColor: Theme.of(context).cardTheme.color,
        ),
        child: LayoutBuilder(
          builder: (context, constraints) {
            // Reflow the price/action before long names or scaled type get squeezed.
            final stacked =
                constraints.maxWidth < 290 ||
                MediaQuery.textScalerOf(context).scale(15) > 18;
            return Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                FoodImage(
                  url: product.imageUrl,
                  emoji: foodEmoji(
                    name: product.name,
                    nameEn: product.nameEn,
                    category: product.category,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      details,
                      if (stacked) ...[
                        const SizedBox(height: 8),
                        amount,
                        Align(alignment: Alignment.centerRight, child: action),
                      ],
                    ],
                  ),
                ),
                if (!stacked) ...[
                  const SizedBox(width: 12),
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxWidth: constraints.maxWidth * .36,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisSize: MainAxisSize.min,
                      children: [amount, action],
                    ),
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}
