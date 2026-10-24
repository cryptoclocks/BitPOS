import 'package:flutter/material.dart';

/// R06 map region while no live idle-map provider is available. Offer counts
/// come from the current owned work snapshot; no location/pins/ETA are invented.
class DriverWorkMapCard extends StatelessWidget {
  const DriverWorkMapCard({
    super.key,
    required this.thai,
    required this.offerCount,
    required this.sharing,
    this.stopUnconfirmed = false,
  });
  final bool thai, sharing, stopUnconfirmed;
  final int offerCount;
  String t(String th, String en) => thai ? th : en;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 262),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: dark ? colors.surfaceContainerHighest : const Color(0xFFF0ECE4),
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(Icons.map_outlined, size: 40, color: colors.onSurfaceVariant),
          const SizedBox(height: 14),
          Text(
            t('แผนที่ยังไม่พร้อมใช้งาน', 'Map unavailable'),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w600,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            t(
              'ยังไม่แสดงตำแหน่งสด ระยะทาง หรือเวลาถึง',
              'Live position, distance and arrival estimates are unavailable.',
            ),
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: 22),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 12,
            runSpacing: 8,
            children: [
              _status(
                context,
                Icons.local_shipping_outlined,
                t('$offerCount งานเสนอจากระบบ', '$offerCount server offers'),
              ),
              _status(
                context,
                stopUnconfirmed
                    ? Icons.location_searching
                    : sharing
                    ? Icons.my_location
                    : Icons.location_disabled,
                stopUnconfirmed
                    ? t(
                        'ยังยืนยันการหยุดพิกัดไม่ได้',
                        'Location stop unconfirmed',
                      )
                    : sharing
                    ? t('กำลังจับพิกัดส่วนตัว', 'Capturing private location')
                    : t('ไม่ได้จับพิกัด', 'Not capturing location'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _status(BuildContext context, IconData icon, String label) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 16, color: Theme.of(context).colorScheme.primary),
      const SizedBox(width: 6),
      Flexible(
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.onSurface,
          ),
        ),
      ),
    ],
  );
}
