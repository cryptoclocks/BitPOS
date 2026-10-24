import 'package:flutter/material.dart';

import 'mobile_push_controller.dart';
import 'mobile_push_native.dart';
import 'mobile_v1.generated.dart';

class MobilePushSettings extends StatelessWidget {
  const MobilePushSettings({
    super.key,
    required this.controller,
    required this.thai,
  });
  final MobilePushController controller;
  final bool thai;
  String t(String th, String en) => thai ? th : en;
  String _error(String code) => switch (code) {
    'PUSH_CONFIGURATION_REQUIRED' || 'CONFIGURATION_REQUIRED' => t(
      'ยังไม่ได้ตั้งค่าบริการแจ้งเตือน การปิดรับยังใช้งานได้',
      'Push service is not configured. Opt-out remains available.',
    ),
    'PUSH_PLAY_SERVICES_UNAVAILABLE' => t(
      'Google Play services ไม่พร้อมใช้งาน',
      'Google Play services unavailable.',
    ),
    'PUSH_RECOVERY_REQUIRED' || 'VERSION_CONFLICT' => t(
      'การผูกอุปกรณ์เปลี่ยนไป กรุณาโหลดสถานะและลองอีกครั้ง',
      'Installation changed. Refresh and retry the saved operation.',
    ),
    'AUTH_REQUIRED' ||
    'SESSION_CHANGED' => t('กรุณาเข้าสู่ระบบใหม่', 'Sign in again.'),
    'PUSH_PERMISSION_REQUIRED' => t(
      'เปิดสิทธิ์แจ้งเตือนในการตั้งค่าระบบก่อน',
      'Allow notifications in system settings first.',
    ),
    'PUSH_APNS_UNAVAILABLE' => t(
      'ยังลงทะเบียนบริการแจ้งเตือนของ Apple ไม่สำเร็จ',
      'Apple notification registration unavailable.',
    ),
    _ => t(
      'ยังอัปเดตการแจ้งเตือนไม่สำเร็จ กรุณาลองอีกครั้ง',
      'Notification update did not complete. Retry.',
    ),
  };
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) {
      final installation = controller.status?.installation,
          consented =
              installation is MobilePushRegistered &&
              installation.boundToCurrentSession &&
              installation.consentEnabled;
      final permission = switch (controller.permission) {
        MobilePushPermission.authorized => t('อนุญาต', 'Allowed'),
        MobilePushPermission.provisional => t(
          'อนุญาตแบบเงียบ',
          'Quietly allowed',
        ),
        MobilePushPermission.denied => t(
          'ไม่อนุญาตหรือช่องแจ้งเตือนถูกปิด',
          'Denied or notification channel blocked',
        ),
        MobilePushPermission.notDetermined => t(
          'ยังไม่ได้ขอสิทธิ์',
          'Not requested',
        ),
        null => t('ยังไม่ได้ตรวจสอบ', 'Not checked'),
      };
      final colors = Theme.of(context).colorScheme;
      return Card(
        color: Theme.of(context).brightness == Brightness.dark
            ? colors.surface
            : Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: colors.outlineVariant),
        ),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: colors.primaryContainer,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Icon(
                      Icons.notifications_none,
                      color: colors.onPrimaryContainer,
                      size: 28,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          t('การแจ้งเตือน', 'Notifications'),
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          t(
                            'เลือกเปิดหรือปิดได้ด้วยตัวคุณเอง',
                            'Choose whether to receive updates',
                          ),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                t(
                  'แจ้งเฉพาะข้อมูลออเดอร์หรืองานที่บัญชีนี้มีสิทธิ์ ดูข้อมูลล่าสุดในแอปเสมอ',
                  'Updates only for orders or work this account may access. Open the app for current facts.',
                ),
              ),
              const SizedBox(height: 8),
              Text(
                controller.status == null
                    ? t(
                        'การยินยอมของบัญชี: ยังไม่ทราบสถานะ',
                        'Account consent: unknown',
                      )
                    : t(
                        'การยินยอมของบัญชี: ${consented ? 'เปิด' : 'ปิด'}',
                        'Account consent: ${consented ? 'enabled' : 'disabled'}',
                      ),
              ),
              const SizedBox(height: 8),
              Text(
                t(
                  'สิทธิ์ของระบบ: $permission',
                  'System permission: $permission',
                ),
              ),
              const SizedBox(height: 8),
              Text(
                controller.enabled
                    ? t(
                        'ลงทะเบียนอุปกรณ์แล้ว ไม่ใช่หลักฐานว่าได้รับข้อความ',
                        'Device registered; this is not proof a message was received.',
                      )
                    : t(
                        'ยังไม่ได้ยืนยันการลงทะเบียนอุปกรณ์',
                        'Device registration not confirmed.',
                      ),
              ),
              if (!controller.native.configured)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    t(
                      'บิลด์นี้ยังไม่มีการตั้งค่าผู้ให้บริการ จึงลงทะเบียนรับการแจ้งเตือนใหม่ไม่ได้',
                      'This build has no push-provider configuration; new notification registration is unavailable.',
                    ),
                  ),
                ),
              if (consented && !controller.enabled)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    t(
                      'สถานะบัญชียังเปิดอยู่ หากต้องการหยุด ให้กดปิดรับและรอการยืนยันจากเซิร์ฟเวอร์',
                      'Account consent remains enabled. To stop, choose opt-out and wait for server confirmation.',
                    ),
                  ),
                ),
              if (controller.errorCode != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Semantics(
                    liveRegion: true,
                    child: Text(
                      _error(controller.errorCode!),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                ),
              if (controller.busy)
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: LinearProgressIndicator(),
                ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(48, 52),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    onPressed: controller.busy || !controller.signedIn
                        ? null
                        : controller.enable,
                    child: Text(
                      t('เปิดรับการแจ้งเตือน', 'Enable notifications'),
                    ),
                  ),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(48, 52),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    onPressed: !controller.signedIn
                        ? null
                        : () => controller.disable(),
                    child: Text(
                      t('ปิดรับบนอุปกรณ์นี้', 'Opt out on this device'),
                    ),
                  ),
                  TextButton(
                    onPressed: controller.busy ? null : controller.openSettings,
                    child: Text(t('ตั้งค่าระบบ', 'System settings')),
                  ),
                  TextButton(
                    onPressed: controller.busy || !controller.signedIn
                        ? null
                        : controller.refresh,
                    child: Text(t('โหลดสถานะ', 'Refresh status')),
                  ),
                  if (controller.hintAvailable)
                    TextButton(
                      onPressed: controller.busy ? null : controller.openHint,
                      child: Text(
                        t('เปิดข้อมูลอัปเดตล่าสุด', 'Open latest update'),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );
}
