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
    Widget sectionTitle(String text) =>
        Text(text, style: theme.textTheme.titleMedium);

    Widget borderedCard({required Widget child}) => Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? colors.surfaceContainer : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: dark ? colors.outlineVariant : BitPosDesignTokens.line,
        ),
      ),
      child: child,
    );

    Widget unavailableDetail({
      required IconData icon,
      required String title,
      required String detail,
    }) => Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: dark ? colors.primaryContainer : BitPosDesignTokens.tint,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(
            icon,
            color: dark
                ? colors.onPrimaryContainer
                : BitPosDesignTokens.primary,
            size: 20,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              Text(detail, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ],
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          _t('รหัสอ้างอิงงาน / คำสั่งซื้อ', 'Job / order references'),
          style: theme.textTheme.labelMedium,
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: Semantics(
            label:
                '${_t('งาน', 'Job')} #${a.id.substring(0, 8)} · '
                '${_t('คำสั่งซื้อ', 'Order')} #${a.orderId.substring(0, 8)}',
            child: Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: dark
                        ? colors.primaryContainer
                        : BitPosDesignTokens.tint,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Text(
                    '${_t('งาน', 'Job')} #${a.id.substring(0, 8)}',
                    style: theme.textTheme.bodySmall,
                  ),
                ),
                Text(
                  '${_t('คำสั่งซื้อ', 'Order')} #${a.orderId.substring(0, 8)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        borderedCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(a.pickupName, style: theme.textTheme.titleMedium),
              if (a.pickupAddress.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(a.pickupAddress, style: theme.textTheme.bodyMedium),
              ],
              const SizedBox(height: 12),
              Text(
                _t('พิกัดจุดรับ', 'Pickup coordinates'),
                style: theme.textTheme.labelMedium,
              ),
              const SizedBox(height: 4),
              SelectionArea(
                child: Text(
                  '${(a.pickupLatitudeE7 / 10000000).toStringAsFixed(7)}, '
                  '${(a.pickupLongitudeE7 / 10000000).toStringAsFixed(7)}',
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        sectionTitle(_t('ตรวจสอบก่อนรับอาหาร', 'Check before pickup')),
        const SizedBox(height: 8),
        borderedCard(
          child: a.items.isEmpty
              ? unavailableDetail(
                  icon: Icons.receipt_long_outlined,
                  title: _t(
                    'รายการอาหารสำหรับตรวจสอบยังไม่พร้อม',
                    'Food checklist unavailable',
                  ),
                  detail: _t(
                    'งานนี้ยังไม่มีรายการอาหารสำหรับตรวจสอบ',
                    'This job has no food items to verify.',
                  ),
                )
              : Column(
                  key: const ValueKey('driver-job-items'),
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final item in a.items)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            SizedBox(
                              width: 44,
                              child: Text(
                                '${item.qty} ×',
                                style: theme.textTheme.titleSmall,
                              ),
                            ),
                            Expanded(
                              child: Text(
                                item.name,
                                style: theme.textTheme.bodyLarge,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: 20),
        sectionTitle(_t('รายละเอียดผู้รับ', 'Recipient details')),
        const SizedBox(height: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(a.recipientName, style: theme.textTheme.bodyLarge),
            const SizedBox(height: 4),
            Text(a.addressText, style: theme.textTheme.bodyMedium),
            const SizedBox(height: 12),
            Text(_t('โทรศัพท์', 'Phone'), style: theme.textTheme.labelMedium),
            const SizedBox(height: 2),
            SelectionArea(
              child: Text(a.phone, style: theme.textTheme.bodyMedium),
            ),
            if (a.instructions.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                _t('คำแนะนำการส่ง', 'Delivery instructions'),
                style: theme.textTheme.labelMedium,
              ),
              const SizedBox(height: 2),
              Text(a.instructions, style: theme.textTheme.bodyMedium),
            ],
          ],
        ),
      ],
    );
  }
}
