import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

/// The mobile contract exposes an obligation, not a verified transfer receipt.
class RefundObligationCard extends StatelessWidget {
  const RefundObligationCard({
    super.key,
    required this.refund,
    required this.thai,
  });
  final MobileRefund refund;
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    final cause = switch (refund.cause) {
      'ONLINE_ACCEPTANCE_REJECTED' => t(
        'ร้านปฏิเสธออร์เดอร์',
        'Merchant declined the order',
      ),
      'ONLINE_ACCEPTANCE_TIMED_OUT' => t(
        'ร้านไม่รับออร์เดอร์ภายในกำหนด',
        'Merchant acceptance timed out',
      ),
      _ => t('คำขอคืนเงินที่บันทึกไว้', 'Recorded refund request'),
    };
    final colors = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.receipt_long_outlined, color: colors.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  '#${refund.id.substring(0, 8)}',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            formatMinorUnits(
              refund.money.amountMinor,
              refund.money.decimals,
              refund.money.currency,
            ),
            textAlign: TextAlign.end,
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: colors.primary,
            ),
          ),
          const SizedBox(height: 12),
          Text(cause),
          const SizedBox(height: 8),
          Text(
            refund.status == 'REQUESTED'
                ? t('บันทึกภาระคืนเงินแล้ว', 'Refund obligation recorded')
                : t(
                    'ต้องตรวจสอบสถานะเพิ่มเติม',
                    'Further status verification required',
                  ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colors.secondaryContainer,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              t(
                'ยังไม่มีหลักฐานยืนยันการโอนคืนในข้อมูลนี้',
                'This record contains no verified return-transfer receipt.',
              ),
              style: TextStyle(
                color: colors.onSecondaryContainer,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
