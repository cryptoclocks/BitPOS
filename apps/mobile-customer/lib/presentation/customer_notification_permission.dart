import 'package:flutter/material.dart';

import 'customer_location_permission.dart';

/// U05 is explicit opt-in presentation. Only the root may request OS/provider access.
class CustomerNotificationPermission extends StatelessWidget {
  const CustomerNotificationPermission({
    super.key,
    required this.thai,
    required this.busy,
    required this.available,
    required this.enabled,
    this.error,
    required this.onAllow,
    required this.onSkip,
    required this.onBack,
  });
  final bool thai, busy, available, enabled;
  final String? error;
  final VoidCallback onAllow, onSkip, onBack;
  String t(String th, String en) => thai ? th : en;

  @override
  Widget build(BuildContext context) {
    final failed = error != null && error!.isNotEmpty;
    final message = failed
        ? error!
        : enabled
        ? t(
            'เปิดการแจ้งเตือนแล้ว ติดตามสถานะออเดอร์ได้ทุกขั้นตอน',
            'Notifications are enabled. Keep up with every step of your order.',
          )
        : !available
        ? t(
            'การแจ้งเตือนยังไม่พร้อมในขณะนี้ คุณยังติดตามออเดอร์ในแอพได้',
            'Notifications are unavailable right now. You can still track orders in the app.',
          )
        : t(
            'รับการแจ้งเตือนเมื่อร้านรับออเดอร์\nและไรเดอร์กำลังนำส่ง',
            'Get updates when the merchant accepts\nyour order and your rider is on the way.',
          );
    return CustomerPermissionLayout(
      keyPrefix: 'customer-notification',
      title: t('ไม่พลาดทุกขั้นตอน', 'Stay in the loop'),
      message: message,
      icon: Icons.notifications_none_outlined,
      busy: busy,
      error: failed,
      primaryLabel: enabled
          ? t('ไปต่อ', 'Continue')
          : !available
          ? t('การแจ้งเตือนยังไม่พร้อม', 'Notifications unavailable')
          : failed
          ? t('ลองอีกครั้ง', 'Try again')
          : t('เปิดการแจ้งเตือน', 'Enable notifications'),
      primaryAction: enabled
          ? onSkip
          : available
          ? onAllow
          : null,
      skipLabel: t('ไว้ภายหลัง', 'Not now'),
      backLabel: t('กลับ', 'Back'),
      onSkip: onSkip,
      onBack: onBack,
    );
  }
}
