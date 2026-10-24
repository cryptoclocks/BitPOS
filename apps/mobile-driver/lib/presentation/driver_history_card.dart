import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

class DriverHistoryCard extends StatelessWidget {
  const DriverHistoryCard({super.key, required this.item, required this.thai});
  final FoodDriverHistoryItem item;
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    final label = switch (item.state) {
      'DELIVERED' => t('ส่งอาหารแล้ว', 'Delivered'),
      'RETURNED' => t('คืนอาหารที่ร้านแล้ว', 'Returned to merchant'),
      'RELEASED' => t('ปล่อยงานแล้ว', 'Assignment released'),
      'INCIDENT' => t('งานมีเหตุขัดข้อง', 'Incident recorded'),
      _ => t('งานปิดแล้ว', 'Closed assignment'),
    };
    final closed = DateTime.parse(item.closedAt).toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final dark = theme.brightness == Brightness.dark;
    final fee = Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          t('ค่าจัดส่งตามราคาเดิม', 'Quoted delivery fee'),
          textAlign: TextAlign.end,
          style: theme.textTheme.bodySmall?.copyWith(
            fontSize: 11,
            height: 1.5,
            color: dark ? colors.onSurfaceVariant : BitPosDesignTokens.muted,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          formatMinorUnits(
            item.quotedDriverFee.amountMinor,
            item.quotedDriverFee.decimals,
            item.quotedDriverFee.currency,
          ),
          textAlign: TextAlign.end,
          style: TextStyle(
            fontSize: 14,
            height: 1.65,
            fontWeight: FontWeight.w600,
            color: dark ? colors.primary : BitPosDesignTokens.primary,
          ),
        ),
      ],
    );
    final details = Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: dark ? colors.primaryContainer : BitPosDesignTokens.tint,
            borderRadius: BorderRadius.circular(13),
          ),
          child: Icon(
            switch (item.state) {
              'DELIVERED' => Icons.delivery_dining_outlined,
              'RETURNED' => Icons.keyboard_return,
              'INCIDENT' => Icons.error_outline,
              _ => Icons.receipt_long_outlined,
            },
            size: 22,
            color: dark ? colors.onPrimaryContainer : BitPosDesignTokens.primary,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '#${item.id.substring(0, 8)}',
                style: TextStyle(
                  fontSize: 15,
                  height: 1.65,
                  fontWeight: FontWeight.w600,
                  color: dark ? colors.onSurface : BitPosDesignTokens.ink,
                ),
              ),
              Text(
                '$label · ${two(closed.hour)}:${two(closed.minute)}',
                style: TextStyle(
                  fontSize: 12,
                  height: 1.65,
                  color: dark ? colors.onSurfaceVariant : BitPosDesignTokens.muted,
                ),
              ),
              Text(
                '${t('ปิดเมื่อ', 'Closed')} ${two(closed.day)}/${two(closed.month)}/${closed.year}',
                style: TextStyle(
                  fontSize: 11,
                  height: 1.3,
                  color: dark ? colors.onSurfaceVariant : BitPosDesignTokens.muted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
    return MergeSemantics(
      child: Card(
        margin: EdgeInsets.zero,
        elevation: 0,
        color: dark ? colors.surfaceContainer : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(
            color: dark ? colors.outlineVariant : BitPosDesignTokens.line,
          ),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 82),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final stacked = constraints.maxWidth < 300 ||
                    MediaQuery.textScalerOf(context).scale(14) > 16.8;
                return stacked
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          details,
                          const SizedBox(height: 12),
                          fee,
                        ],
                      )
                    : Row(
                        children: [
                          Expanded(child: details),
                          const SizedBox(width: 12),
                          SizedBox(width: 104, child: fee),
                        ],
                      );
              },
            ),
          ),
        ),
      ),
    );
  }
}
