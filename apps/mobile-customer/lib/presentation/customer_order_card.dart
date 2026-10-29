import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import '../food_labels.dart';

class CustomerOrderCard extends StatelessWidget {
  const CustomerOrderCard({
    super.key,
    required this.order,
    required this.thai,
    this.onOpen,
    this.clock = DateTime.now,
  });
  final MobileFoodOrderSummary order;
  final bool thai;
  final VoidCallback? onOpen;
  final DateTime Function() clock;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    final created = DateTime.tryParse(order.createdAt)?.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    const monthsEn = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const monthsTh = [
      'ม.ค.',
      'ก.พ.',
      'มี.ค.',
      'เม.ย.',
      'พ.ค.',
      'มิ.ย.',
      'ก.ค.',
      'ส.ค.',
      'ก.ย.',
      'ต.ค.',
      'พ.ย.',
      'ธ.ค.',
    ];
    final now = clock();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final createdDay = created == null
        ? null
        : DateTime(created.year, created.month, created.day);
    final when = created == null
        ? null
        : createdDay == today
        ? '${two(created.hour)}:${two(created.minute)}'
        : createdDay == yesterday
        ? t('เมื่อวาน', 'Yesterday')
        : '${created.day} ${thai ? monthsTh[created.month - 1] : monthsEn[created.month - 1]}';
    final progress = order.status != 'PAID'
        ? order.status
        : order.acceptanceStatus != 'ACCEPTED'
        ? order.acceptanceStatus
        : order.fulfillmentStatus;
    final subtitle = [
      foodActivityStateLabel(progress, thai),
      ?when,
      formatMinorUnits(
        order.total.amountMinor,
        order.total.decimals,
        order.total.currency,
      ),
    ].join(' · ');
    return Material(
      key: ValueKey('customer-order-card.${order.id}'),
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFFE9E1F1)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 11, 8, 11),
          child: Row(
            children: [
              Semantics(
                label: t('ร้านอาหาร', 'Restaurant'),
                image: true,
                child: Container(
                  key: ValueKey('customer-order-storefront.${order.id}'),
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFE6F8),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  alignment: Alignment.center,
                  child: const Icon(
                    Icons.storefront_outlined,
                    color: Color(0xFF64188A),
                    size: 24,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      order.merchantName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF29183F),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF7B7088),
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right,
                color: Color(0xFF7B7088),
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
