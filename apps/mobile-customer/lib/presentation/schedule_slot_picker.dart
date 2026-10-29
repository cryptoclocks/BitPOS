import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

/// What the server told us about scheduled ordering for this branch/serving.
enum ScheduleAvailability { loading, published, none, failed }

/// "Schedule for later" tile. It is a picker only when the server publishes
/// bookable slots; otherwise it is a disabled tile that says why. Slot times,
/// capacity and kitchen release are server-owned; the app only chooses an id.
class ScheduleSlotTile extends StatelessWidget {
  const ScheduleSlotTile({
    super.key,
    required this.thai,
    required this.availability,
    required this.slots,
    required this.selected,
    required this.onChanged,
    this.enabled = true,
  });
  final bool thai;
  final ScheduleAvailability availability;
  final List<MobileScheduleSlot> slots;
  final MobileScheduleSlot? selected;
  final ValueChanged<MobileScheduleSlot?> onChanged;
  final bool enabled;

  /// Wall-clock time in the shop's zone. Thailand has no daylight saving, so a fixed
  /// UTC+7 is exact for Asia/Bangkok whatever zone the phone is set to; any other
  /// zone falls back to the phone's local time.
  static DateTime wall(String iso, [String timezone = 'Asia/Bangkok']) {
    final utc = DateTime.parse(iso).toUtc();
    return timezone == 'Asia/Bangkok' ? utc.add(const Duration(hours: 7)) : utc.toLocal();
  }

  static String clock(String iso, [String timezone = 'Asia/Bangkok']) {
    final v = wall(iso, timezone);
    return '${v.hour.toString().padLeft(2, '0')}:${v.minute.toString().padLeft(2, '0')}';
  }

  static String format(MobileScheduleSlot slot, bool thai, {DateTime? now}) {
    final start = wall(slot.startsAt, slot.timezone);
    final end = wall(slot.endsAt, slot.timezone);
    String two(int v) => v.toString().padLeft(2, '0');
    final today = slot.timezone == 'Asia/Bangkok'
        ? (now ?? DateTime.now()).toUtc().add(const Duration(hours: 7))
        : (now ?? DateTime.now()).toLocal();
    final sameDay = start.year == today.year && start.month == today.month && start.day == today.day;
    final day = sameDay ? (thai ? 'วันนี้' : 'Today') : '${two(start.day)}/${two(start.month)}';
    return '$day ${two(start.hour)}:${two(start.minute)}–${two(end.hour)}:${two(end.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    final colors = Theme.of(context).colorScheme;
    final picker = availability == ScheduleAvailability.published && slots.isNotEmpty;
    final subtitle = switch (availability) {
      ScheduleAvailability.published when slots.isNotEmpty =>
        selected == null
            ? t('รับทันที หรือเลือกเวลาที่ร้านเปิดให้จอง', 'As soon as possible, or pick a time the merchant offers')
            : t('นัดรับ ${format(selected!, thai)}', 'Scheduled ${format(selected!, thai)}'),
      ScheduleAvailability.loading => t('กำลังตรวจช่วงเวลาที่ร้านเปิดให้จอง', 'Checking the times the merchant offers'),
      ScheduleAvailability.failed => t('ตอนนี้โหลดช่วงเวลาไม่ได้ ออเดอร์จะเป็นแบบทันที', 'Time slots could not be loaded; the order will be placed for now'),
      _ => t('ร้านนี้ยังไม่เปิดให้สั่งล่วงหน้า ออเดอร์จะเป็นแบบทันที', 'This merchant does not offer scheduled orders yet; the order is placed for now'),
    };
    return Card(
      key: const ValueKey('cart-schedule-entry'),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14),
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: colors.primaryContainer,
            borderRadius: BorderRadius.circular(13),
          ),
          child: const Icon(Icons.schedule_outlined),
        ),
        title: Text(t('สั่งล่วงหน้า', 'Schedule for later')),
        subtitle: Text(subtitle),
        trailing: picker ? const Icon(Icons.chevron_right) : null,
        enabled: picker && enabled,
        onTap: picker && enabled
            ? () async {
                final choice = await showModalBottomSheet<_Choice>(
                  context: context,
                  showDragHandle: true,
                  isScrollControlled: true,
                  builder: (_) => _SlotSheet(thai: thai, slots: slots, selected: selected),
                );
                if (choice != null) onChanged(choice.slot);
              }
            : null,
      ),
    );
  }
}

class _Choice {
  const _Choice(this.slot);
  final MobileScheduleSlot? slot;
}

class _SlotSheet extends StatelessWidget {
  const _SlotSheet({required this.thai, required this.slots, required this.selected});
  final bool thai;
  final List<MobileScheduleSlot> slots;
  final MobileScheduleSlot? selected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.7),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          children: [
            Text(t('เลือกเวลารับ', 'Choose a time'), style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            ListTile(
              key: const ValueKey('slot-asap'),
              leading: Icon(selected == null ? Icons.radio_button_checked : Icons.radio_button_unchecked),
              title: Text(t('ทันที (ไม่นัดเวลา)', 'As soon as possible')),
              onTap: () => Navigator.of(context).pop(const _Choice(null)),
            ),
            for (final slot in slots)
              ListTile(
                key: ValueKey('slot-${slot.id}'),
                leading: Icon(selected?.id == slot.id ? Icons.radio_button_checked : Icons.radio_button_unchecked),
                title: Text(ScheduleSlotTile.format(slot, thai)),
                subtitle: Text(
                  t(
                    'จองได้ก่อน ${ScheduleSlotTile.clock(slot.bookingClosesAt, slot.timezone)}',
                    'Bookable until ${ScheduleSlotTile.clock(slot.bookingClosesAt, slot.timezone)}',
                  ),
                ),
                onTap: () => Navigator.of(context).pop(_Choice(slot)),
              ),
          ],
        ),
      ),
    );
  }
}
