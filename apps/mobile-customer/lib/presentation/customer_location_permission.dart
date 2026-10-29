import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';

import '../customer_location_access.dart';

/// U04 renders only the OS permission outcome supplied by the root adapter.
class CustomerLocationPermission extends StatelessWidget {
  const CustomerLocationPermission({
    super.key,
    required this.thai,
    required this.busy,
    required this.status,
    required this.onAllow,
    required this.onSkip,
    required this.onSettings,
    required this.onBack,
  });
  final bool thai, busy;
  final CustomerLocationStatus status;
  final VoidCallback onAllow, onSkip, onSettings, onBack;
  String t(String th, String en) => thai ? th : en;

  @override
  Widget build(BuildContext context) {
    final needsSettings =
        status == CustomerLocationStatus.permanentlyDenied ||
        status == CustomerLocationStatus.servicesOff;
    final granted = status == CustomerLocationStatus.granted;
    final failure = status != CustomerLocationStatus.initial && !granted;
    final message = switch (status) {
      CustomerLocationStatus.initial => t(
        'เลือกที่อยู่ได้แม่นยำ\nและค้นหาร้านที่ส่งถึงคุณ',
        'Choose an address accurately\nand find merchants that deliver to you.',
      ),
      CustomerLocationStatus.granted => t(
        'อนุญาตตำแหน่งแล้ว กำลังไปต่อ',
        'Location is allowed. Continuing.',
      ),
      CustomerLocationStatus.denied => t(
        'คุณยังไม่ได้อนุญาตตำแหน่ง ลองอีกครั้งหรือเลือกที่อยู่เองได้',
        'Location was not allowed. Try again or choose an address yourself.',
      ),
      CustomerLocationStatus.permanentlyDenied => t(
        'เปิดสิทธิ์ตำแหน่งสำหรับ BitPOS ในการตั้งค่า หรือเลือกที่อยู่เองได้',
        'Enable BitPOS location permission in Settings, or choose an address yourself.',
      ),
      CustomerLocationStatus.servicesOff => t(
        'เปิดบริการตำแหน่งบนอุปกรณ์ แล้วลองอีกครั้ง หรือเลือกที่อยู่เองได้',
        'Turn on device location services, then try again or choose an address yourself.',
      ),
      CustomerLocationStatus.error => t(
        'ตรวจสอบตำแหน่งไม่ได้ในขณะนี้ ลองอีกครั้งหรือเลือกที่อยู่เองได้',
        'Location is unavailable right now. Try again or choose an address yourself.',
      ),
    };
    return CustomerPermissionLayout(
      keyPrefix: 'customer-location',
      title: t('ส่งความอร่อยถึงที่', 'Delivery to your door'),
      message: message,
      icon: Icons.location_on_outlined,
      busy: busy || granted,
      error: failure,
      primaryLabel: needsSettings
          ? t('เปิดการตั้งค่า', 'Open settings')
          : failure
          ? t('ลองอีกครั้ง', 'Try again')
          : t('อนุญาตตำแหน่ง', 'Allow location'),
      primaryAction: needsSettings ? onSettings : onAllow,
      skipLabel: t('ไว้ภายหลัง', 'Not now'),
      backLabel: t('กลับ', 'Back'),
      onSkip: onSkip,
      onBack: onBack,
      additionalAction: needsSettings
          ? TextButton(
              onPressed: busy ? null : onAllow,
              child: Text(t('ตรวจสอบสิทธิ์อีกครั้ง', 'Check permission again')),
            )
          : null,
    );
  }
}

/// Shared U04/U05 layout; callbacks belong to the authenticated root, not this UI.
/// OS insets are real safe areas. Content can grow/scroll at accessibility scales.
class CustomerPermissionLayout extends StatelessWidget {
  const CustomerPermissionLayout({
    super.key,
    required this.keyPrefix,
    required this.title,
    required this.message,
    required this.icon,
    required this.busy,
    required this.primaryLabel,
    required this.primaryAction,
    required this.skipLabel,
    required this.backLabel,
    required this.onSkip,
    required this.onBack,
    this.error = false,
    this.additionalAction,
  });
  final String keyPrefix, title, message, primaryLabel, skipLabel, backLabel;
  final IconData icon;
  final bool busy, error;
  final VoidCallback? primaryAction;
  final VoidCallback onSkip, onBack;
  final Widget? additionalAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = theme.colorScheme;
    final buttonStyle = FilledButton.styleFrom(minimumSize: const Size(48, 52));
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: IntrinsicHeight(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 60),
                            child: Row(
                              children: [
                                IconButton.filledTonal(
                                  key: ValueKey('$keyPrefix-back'),
                                  tooltip: backLabel,
                                  onPressed: busy ? null : onBack,
                                  style: IconButton.styleFrom(
                                    minimumSize: const Size(44, 44),
                                    maximumSize: const Size(44, 44),
                                    padding: EdgeInsets.zero,
                                    backgroundColor:
                                        theme.brightness == Brightness.dark
                                        ? colors.surfaceContainer
                                        : Colors.white,
                                    side: BorderSide(
                                      color: colors.outlineVariant,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(
                                        BitPosDesignTokens.radiusControl,
                                      ),
                                    ),
                                  ),
                                  icon: const Icon(Icons.chevron_left),
                                ),
                                const SizedBox(width: 14),
                                Expanded(
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 8,
                                    ),
                                    child: Text(
                                      title,
                                      style: theme.textTheme.titleLarge,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 66),
                          Align(
                            alignment: Alignment.center,
                            child: Container(
                              key: ValueKey('$keyPrefix-icon'),
                              width: 120,
                              height: 120,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: colors.primaryContainer,
                                borderRadius: BorderRadius.circular(40),
                              ),
                              child: Icon(
                                icon,
                                size: 56,
                                color: colors.primary,
                              ),
                            ),
                          ),
                          const SizedBox(height: 38),
                          Semantics(
                            header: true,
                            child: Text(
                              title,
                              textAlign: TextAlign.center,
                              style: theme.textTheme.headlineMedium?.copyWith(
                                fontSize: 26,
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Semantics(
                            liveRegion: error,
                            child: Text(
                              message,
                              textAlign: TextAlign.center,
                              style: theme.textTheme.bodyLarge?.copyWith(
                                fontSize: 16,
                                height: 1.65,
                                color: error
                                    ? colors.error
                                    : colors.onSurfaceVariant,
                              ),
                            ),
                          ),
                          if (busy) ...[
                            const SizedBox(height: 12),
                            const LinearProgressIndicator(),
                          ],
                          const SizedBox(height: 24),
                          const Spacer(),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 6),
                            child: FilledButton(
                              key: ValueKey('$keyPrefix-primary'),
                              onPressed: busy ? null : primaryAction,
                              style: buttonStyle,
                              child: Text(
                                primaryLabel,
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ),
                          if (additionalAction != null) additionalAction!,
                          const SizedBox(height: 14),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 6),
                            child: OutlinedButton(
                              key: ValueKey('$keyPrefix-skip'),
                              onPressed: busy ? null : onSkip,
                              style: OutlinedButton.styleFrom(
                                minimumSize: const Size(48, 52),
                                backgroundColor:
                                    theme.brightness == Brightness.dark
                                    ? colors.surfaceContainer
                                    : Colors.white,
                              ),
                              child: Text(skipLabel),
                            ),
                          ),
                          const SizedBox(height: 70),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
