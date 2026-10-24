import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';

/// R08 details only. The owner must remove this widget when normal duty ends.
/// Restricted duties cannot be supplied through this typed presentation boundary.
class DriverJobDetailsCard extends StatelessWidget {
  const DriverJobDetailsCard({
    super.key,
    required this.assignment,
    required this.thai,
  });

  final FoodDriverAssignment assignment;
  final bool thai;

  String _t(String th, String en) => thai ? th : en;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final dark = theme.brightness == Brightness.dark;
    final a = assignment;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: dark ? colors.surfaceContainer : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: dark ? colors.outlineVariant : BitPosDesignTokens.line,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _t('รหัสอ้างอิงงาน / คำสั่งซื้อ', 'Job / order references'),
            style: theme.textTheme.labelMedium,
          ),
          const SizedBox(height: 4),
          Text(
            '${_t('งาน', 'Job')} #${a.id.substring(0, 8)} · '
            '${_t('คำสั่งซื้อ', 'Order')} #${a.orderId.substring(0, 8)}',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 20),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: dark
                      ? colors.primaryContainer
                      : BitPosDesignTokens.tint,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  Icons.storefront_outlined,
                  color: dark
                      ? colors.onPrimaryContainer
                      : BitPosDesignTokens.primary,
                  size: 24,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _t('จุดรับอาหาร', 'Food pickup'),
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _t('ละติจูด, ลองจิจูด', 'Latitude, longitude'),
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${(a.pickupLatitudeE7 / 10000000).toStringAsFixed(7)}, '
                      '${(a.pickupLongitudeE7 / 10000000).toStringAsFixed(7)}',
                      style: theme.textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Text(
            _t('รายละเอียดผู้รับ', 'Recipient details'),
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(a.recipientName, style: theme.textTheme.bodyLarge),
          const SizedBox(height: 6),
          Text(a.addressText, style: theme.textTheme.bodyMedium),
          const SizedBox(height: 12),
          Text(_t('โทรศัพท์', 'Phone'), style: theme.textTheme.labelMedium),
          const SizedBox(height: 4),
          SelectionArea(
            child: Text(a.phone, style: theme.textTheme.bodyMedium),
          ),
          if (a.instructions.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              _t('คำแนะนำการส่ง', 'Delivery instructions'),
              style: theme.textTheme.labelMedium,
            ),
            const SizedBox(height: 4),
            Text(a.instructions, style: theme.textTheme.bodyMedium),
          ],
          const SizedBox(height: 20),
          Text(
            _t(
              'ข้อมูลที่ได้รับยังไม่มีชื่อร้าน ที่อยู่จุดรับ และรายการอาหารสำหรับตรวจสอบ',
              'Merchant name, pickup address and food checklist are not included in these job details.',
            ),
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
