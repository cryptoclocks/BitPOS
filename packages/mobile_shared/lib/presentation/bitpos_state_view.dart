import 'package:flutter/material.dart';

/// DS34 shared state kinds. `closed` and `outOfZone` are display-only: the
/// caller must pass them from a real server fact; this widget invents none.
enum BitPosStateKind { loading, empty, error, offline, closed, outOfZone }

/// Shared loading/empty/error/offline/closed/out-of-zone block.
/// Uses theme colors (light/dark), wraps for large text and TH/EN copy is
/// supplied by [BitPosStateView.thai] defaults or caller overrides.
class BitPosStateView extends StatelessWidget {
  const BitPosStateView({
    super.key,
    required this.kind,
    required this.thai,
    this.title,
    this.message,
    this.actionLabel,
    this.onAction,
  });
  final BitPosStateKind kind;
  final bool thai;
  final String? title, message, actionLabel;
  final VoidCallback? onAction;

  (IconData, String, String) _copy() => switch (kind) {
    BitPosStateKind.loading => (
      Icons.hourglass_empty_rounded,
      thai ? 'กำลังโหลด' : 'Loading',
      thai ? 'กรุณารอสักครู่' : 'Please wait a moment.',
    ),
    BitPosStateKind.empty => (
      Icons.inbox_outlined,
      thai ? 'ยังไม่มีรายการ' : 'Nothing here yet',
      thai ? 'เมื่อมีข้อมูลจะแสดงที่นี่' : 'Items will appear here.',
    ),
    BitPosStateKind.error => (
      Icons.error_outline_rounded,
      thai ? 'เกิดข้อผิดพลาด' : 'Something went wrong',
      thai ? 'กรุณาลองใหม่อีกครั้ง' : 'Please try again.',
    ),
    BitPosStateKind.offline => (
      Icons.cloud_off_rounded,
      thai ? 'ไม่มีการเชื่อมต่อ' : 'You are offline',
      thai
          ? 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ ข้อมูลที่บันทึกไว้จะไม่หาย'
          : 'Check your connection and retry. Saved data is kept.',
    ),
    BitPosStateKind.closed => (
      Icons.schedule_rounded,
      thai ? 'ร้านปิดอยู่' : 'Currently closed',
      thai ? 'ตะกร้าของคุณยังอยู่' : 'Your cart is kept.',
    ),
    BitPosStateKind.outOfZone => (
      Icons.location_off_outlined,
      thai ? 'อยู่นอกพื้นที่จัดส่ง' : 'Outside the delivery area',
      thai ? 'เลือกที่อยู่อื่นหรือรับเอง' : 'Choose another address or pickup.',
    ),
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (icon, defTitle, defMessage) = _copy();
    final shownTitle = title ?? defTitle, shownMessage = message ?? defMessage;
    final danger =
        kind == BitPosStateKind.error || kind == BitPosStateKind.offline;
    final accent = danger ? theme.colorScheme.error : theme.colorScheme.primary;
    return Semantics(
      container: true,
      liveRegion: kind != BitPosStateKind.empty,
      label: '$shownTitle. $shownMessage',
      child: Container(
        key: ValueKey('bitpos-state-${kind.name}'),
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: theme.colorScheme.outlineVariant),
        ),
        child: Column(
          children: [
            ExcludeSemantics(
              child: kind == BitPosStateKind.loading
                  ? const SizedBox(
                      width: 32,
                      height: 32,
                      child: CircularProgressIndicator(strokeWidth: 3),
                    )
                  : Icon(icon, size: 40, color: accent),
            ),
            const SizedBox(height: 16),
            Text(
              shownTitle,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: theme.colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              shownMessage,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (actionLabel != null) ...[
              const SizedBox(height: 16),
              ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: OutlinedButton(
                  onPressed: onAction,
                  child: Text(actionLabel!, textAlign: TextAlign.center),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
