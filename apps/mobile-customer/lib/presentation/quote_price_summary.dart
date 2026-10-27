import 'package:flutter/material.dart';

/// Displays formatted server quote values without recomputing any totals.
class QuotePriceSummary extends StatelessWidget {
  const QuotePriceSummary({
    super.key,
    required this.thai,
    required this.subtotal,
    required this.discount,
    required this.fees,
    required this.tax,
    required this.total,
    this.compact = false,
    this.showDiscount = true,
    this.showFees = true,
    this.showTax = true,
  });
  final bool thai;
  final String subtotal, discount, fees, tax, total;
  final bool compact, showDiscount, showFees, showTax;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    String t(String th, String en) => thai ? th : en;
    Widget row(String label, String value, {bool emphasis = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: emphasis ? FontWeight.w700 : FontWeight.w400,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(
                fontWeight: emphasis ? FontWeight.w700 : FontWeight.w500,
                fontSize: emphasis ? 24 : 14,
                color: emphasis ? colors.primary : colors.onSurface,
              ),
            ),
          ),
        ],
      ),
    );
    if (compact) {
      Widget compactRow(String label, String value, {bool emphasis = false}) =>
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: emphasis && MediaQuery.textScalerOf(context).scale(17) > 22
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        label,
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                          color: colors.onSurface,
                        ),
                      ),
                      Text(
                        value,
                        textAlign: TextAlign.end,
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w600,
                          color: colors.primary,
                        ),
                      ),
                    ],
                  )
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          label,
                          style: TextStyle(
                            color: emphasis
                                ? colors.onSurface
                                : colors.onSurfaceVariant,
                            fontWeight: emphasis
                                ? FontWeight.w600
                                : FontWeight.w400,
                            fontSize: emphasis ? 17 : 14,
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        flex: emphasis ? 2 : 1,
                        child: Text(
                          value,
                          textAlign: TextAlign.end,
                          style: TextStyle(
                            color: emphasis ? colors.primary : colors.onSurface,
                            fontWeight: emphasis
                                ? FontWeight.w600
                                : FontWeight.w400,
                            fontSize: emphasis ? 24 : 14,
                          ),
                        ),
                      ),
                    ],
                  ),
          );
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            compactRow(t('ยอดก่อนลด', 'Subtotal'), subtotal),
            if (showDiscount) compactRow(t('ส่วนลด', 'Discount'), discount),
            if (showFees) compactRow(t('ค่าธรรมเนียมรวม', 'Total fees'), fees),
            if (showTax) compactRow(t('ภาษีเพิ่มเติม', 'Additional tax'), tax),
            Divider(height: 24, color: colors.outlineVariant),
            compactRow(t('ยอดรวม', 'Total'), total, emphasis: true),
          ],
        ),
      );
    }
    return Container(
      padding: EdgeInsets.zero,
      margin: const EdgeInsets.symmetric(vertical: 16),
      decoration: const BoxDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            t('สรุปราคา', 'Price summary'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          row(t('ยอดก่อนลด', 'Subtotal'), subtotal),
          row(t('ส่วนลด', 'Discount'), discount),
          row(t('ค่าธรรมเนียมรวม', 'Total fees'), fees),
          row(t('ภาษีเพิ่มเติม', 'Additional tax'), tax),
          Divider(height: 24, color: colors.outlineVariant),
          row(t('ยอดรวม', 'Total'), total, emphasis: true),
        ],
      ),
    );
  }
}
