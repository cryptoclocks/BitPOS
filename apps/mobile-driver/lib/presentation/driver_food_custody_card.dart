import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

/// R11/R13 presentation only. Proof entry and command ownership stay on the page.
class DriverFoodCustodyCard extends StatelessWidget {
  const DriverFoodCustodyCard({
    super.key,
    required this.assignment,
    required this.thai,
    required this.onEnterProof,
  });

  final FoodDriverAssignment assignment;
  final bool thai;
  final ValueChanged<FoodDriverProof>? onEnterProof;

  String _t(String th, String en) => thai ? th : en;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final dark = theme.brightness == Brightness.dark;
    final pickup = assignment.state == 'AT_PICKUP';
    final proofs = assignment.proofs
        .where((proof) => proof.kind == (pickup ? 'PICKUP' : 'DELIVERY'))
        .toList(growable: false);
    final destination = _destination(context, pickup: pickup);
    final confirmation = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          pickup
              ? _t('ตรวจสอบก่อนรับอาหาร', 'Check before pickup')
              : _t('ยืนยันก่อนส่งมอบ', 'Confirm before handover'),
          style: theme.textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        Text(
          pickup
              ? _t(
                  'ตรวจอาหารและบรรจุภัณฑ์ แล้วกรอกรหัสจากร้าน',
                  'Check food and packaging, then enter the merchant’s code',
                )
              : _t(
                  'กรอกรหัสรับอาหารจากลูกค้าเพื่อยืนยันส่งมอบ',
                  'Enter the customer’s code to confirm handover',
                ),
          style: theme.textTheme.bodyMedium?.copyWith(
            color: colors.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 24),
        if (proofs.isEmpty)
          Container(
            key: const ValueKey('food-custody-proof-unavailable'),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: colors.primaryContainer,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              _t(
                'รอร้าน/ลูกค้าออกหลักฐาน กดโหลดใหม่ได้',
                'Waiting for merchant/customer proof. Refresh to recover.',
              ),
              style: TextStyle(color: colors.onPrimaryContainer),
            ),
          ),
        for (final proof in proofs) ...[
          Container(
            key: ValueKey('food-custody-proof-${proof.id}'),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: dark ? colors.surfaceContainerLow : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: dark ? colors.outlineVariant : BitPosDesignTokens.line,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.key_outlined, color: colors.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_t('หมดอายุ', 'Expires')}: ${_proofExpiry(context, proof)}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      Text(
                        '${_t('จำนวนครั้งที่เหลือ', 'Attempts remaining')}: ${proof.attemptsRemaining}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (!pickup) ...[
          Container(
            key: const ValueKey('food-custody-photo-unavailable'),
            constraints: const BoxConstraints(minHeight: 128),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: dark ? colors.primaryContainer : BitPosDesignTokens.tint,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              children: [
                Icon(
                  Icons.inventory_2_outlined,
                  size: 32,
                  color: dark
                      ? colors.onPrimaryContainer
                      : BitPosDesignTokens.primary,
                ),
                const SizedBox(height: 8),
                Text(
                  _t(
                    'ขั้นตอนนี้ยังไม่รองรับหลักฐานภาพถ่าย ใช้รหัสจากลูกค้าเพื่อยืนยันส่งมอบ',
                    'Photo proof is not supported in this workflow. Confirm handover with the customer’s code.',
                  ),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: dark
                        ? colors.onPrimaryContainer
                        : BitPosDesignTokens.primary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
        ],
        for (final proof in proofs) ...[
          FilledButton(
            key: ValueKey('food-custody-${proof.kind}'),
            onPressed: onEnterProof == null ? null : () => onEnterProof!(proof),
            child: Text(
              pickup
                  ? _t('กรอกรหัสรับอาหาร', 'Enter pickup proof')
                  : _t('กรอกรหัสส่งมอบ', 'Enter delivery proof'),
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 900 &&
            MediaQuery.textScalerOf(context).scale(16) <= 24) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(flex: 2, child: destination),
              const SizedBox(width: 24),
              Expanded(flex: 3, child: confirmation),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            destination,
            const SizedBox(height: 24),
            confirmation,
          ],
        );
      },
    );
  }

  String _proofExpiry(BuildContext context, FoodDriverProof proof) {
    final expiry = DateTime.parse(proof.expiresAt).toLocal();
    final labels = MaterialLocalizations.of(context);
    return '${labels.formatShortDate(expiry)} '
        '${labels.formatTimeOfDay(TimeOfDay.fromDateTime(expiry), alwaysUse24HourFormat: true)}';
  }

  Widget _destination(BuildContext context, {required bool pickup}) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final dark = theme.brightness == Brightness.dark;
    return Container(
      key: const ValueKey('food-handover-destination'),
      constraints: const BoxConstraints(minHeight: 82),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: dark ? colors.surfaceContainerLow : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: dark ? colors.outlineVariant : BitPosDesignTokens.line,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: dark ? colors.primaryContainer : BitPosDesignTokens.tint,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(
              pickup ? Icons.storefront_outlined : Icons.location_on_outlined,
              color: dark
                  ? colors.onPrimaryContainer
                  : BitPosDesignTokens.primary,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  pickup
                      ? _t('จุดรับอาหาร', 'Food pickup')
                      : assignment.recipientName,
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 4),
                Text(
                  pickup
                      ? (assignment.pickupAddress.isEmpty
                            ? assignment.pickupName
                            : '${assignment.pickupName}\n${assignment.pickupAddress}')
                      : assignment.addressText,
                  style: theme.textTheme.bodySmall,
                ),
                if (!pickup && assignment.instructions.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(assignment.instructions, style: theme.textTheme.bodySmall),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
