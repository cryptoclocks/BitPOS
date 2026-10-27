import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';

/// Server aggregate over a Bangkok day, never a total of paginated client entries.
class DriverDailySummary extends StatefulWidget {
  const DriverDailySummary({
    super.key,
    required this.api,
    required this.thai,
    this.compact = false,
  });
  final MobileApi api;
  final bool thai, compact;
  @override
  State<DriverDailySummary> createState() => _DriverDailySummaryState();
}

class _DriverDailySummaryState extends State<DriverDailySummary>
    with WidgetsBindingObserver {
  late final owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? changes;
  DriverDailyEarnings? summary;
  Timer? dayTimer;
  int epoch = 0;
  bool busy = false, retired = false, unavailable = false;
  String t(String th, String en) => widget.thai ? th : en;
  bool get current =>
      mounted &&
      !retired &&
      widget.api.signedIn &&
      widget.api.sessionScope == owner;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    changes = widget.api.sessionScopes.listen((next) {
      if (mounted && next != owner) {
        epoch++;
        dayTimer?.cancel();
        setState(() {
          retired = true;
          summary = null;
          busy = false;
        });
      }
    });
    unawaited(load());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    epoch++;
    dayTimer?.cancel();
    setState(() {
      summary = null;
      busy = false;
    });
    if (state == AppLifecycleState.resumed && current) unawaited(load());
  }

  Future<void> load() async {
    if (!current || busy) return;
    final run = ++epoch;
    setState(() {
      busy = true;
      unavailable = false;
      summary = null;
    });
    try {
      final result = await widget.api.driverDailyEarnings();
      if (current && run == epoch) {
        final remaining = DateTime.parse(result.dayEnd)
            .difference(DateTime.now());
        if (remaining <= Duration.zero) {
          throw const FormatException('Expired daily summary');
        }
        setState(() => summary = result);
        dayTimer?.cancel();
        dayTimer = Timer(remaining, () {
          if (current && run == epoch) {
            setState(() {
              summary = null;
              unavailable = true;
            });
          }
        });
      }
    } catch (_) {
      if (current && run == epoch) setState(() => unavailable = true);
    } finally {
      if (current && run == epoch) setState(() => busy = false);
    }
  }

  String stateLabel(String state) => switch (state) {
    'ACCRUED' => t('บันทึกภาระรายได้', 'Accrued'),
    'HELD' => t('รอตรวจสอบ', 'Held for review'),
    'AVAILABLE' => t('ผ่านเกณฑ์การจ่าย', 'Eligible'),
    'RESERVED' => t('กันสิทธิ์รอบจ่าย', 'Reserved'),
    'SETTLED' => t('ยืนยันจ่ายแล้ว', 'Verified settlement'),
    'REVERSED' => t('กลับรายการ', 'Reversed'),
    _ => t('ไม่ทราบสถานะ', 'Unknown status'),
  };
  Widget metric(String label, String value, double width) => Container(
    width: width,
    constraints: BoxConstraints(minHeight: widget.compact ? 0 : 110),
    padding: widget.compact ? EdgeInsets.zero : const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: widget.compact
          ? Colors.transparent
          : Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(18),
      border: widget.compact
          ? null
          : Border.all(color: Theme.of(context).colorScheme.outlineVariant),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          value,
          softWrap: true,
          style: TextStyle(
            fontSize: 30,
            fontWeight: FontWeight.w600,
            color: Theme.of(context).colorScheme.primary,
          ),
        ),
      ],
    ),
  );
  @override
  Widget build(BuildContext context) {
    if (retired) return const SizedBox.shrink();
    final value = summary;
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          t('สรุปวันนี้ · เวลาไทย', 'Today · Bangkok time'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        if (busy) const LinearProgressIndicator(),
        if (unavailable)
          Semantics(
            liveRegion: true,
            child: Text(
              t(
                'ยังโหลดสรุปไม่ได้ กรุณาลองใหม่',
                'Daily summary unavailable. Try again.',
              ),
            ),
          ),
        if (value != null) ...[
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) => Wrap(
              spacing: 14,
              runSpacing: 14,
              children: [
                metric(
                  t('งานส่งสำเร็จ', 'Completed deliveries'),
                  value.completedDeliveries,
                  widget.compact || constraints.maxWidth < 300
                      ? constraints.maxWidth
                      : (constraints.maxWidth - 14) / 2,
                ),
                for (final group in value.groups)
                  metric(
                    '${stateLabel(group.state)} · ${group.count} ${t('รายการ', 'entries')}',
                    formatMinorUnits(
                      group.money.amountMinor,
                      group.money.decimals,
                      group.money.currency,
                    ),
                    widget.compact || constraints.maxWidth < 300
                        ? constraints.maxWidth
                        : (constraints.maxWidth - 14) / 2,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (widget.compact)
            Material(
              color: Colors.transparent,
              child: ExpansionTile(
                tilePadding: EdgeInsets.zero,
                childrenPadding: EdgeInsets.zero,
                title: Text(
                  t('รายละเอียดรายได้', 'Earning details'),
                  style: const TextStyle(fontSize: 12),
                ),
                children: [
                  Text(
                    t(
                      'ภาระรายได้ที่บันทึกวันนี้ แยกสกุลเงินและสถานะปัจจุบัน ไม่ใช่ยอดโอนวันนี้',
                      'Earning obligations created today, by currency and current state. Not today’s transfers.',
                    ),
                    style: const TextStyle(fontSize: 12),
                  ),
                  Text(
                    '${t('ข้อมูล ณ', 'As of')}: ${DateTime.parse(value.snapshotAt).toLocal()}',
                    style: const TextStyle(fontSize: 11),
                  ),
                ],
              ),
            )
          else ...[
            Text(
              t(
                'ภาระรายได้ที่บันทึกวันนี้ แยกสกุลเงินและสถานะปัจจุบัน ไม่ใช่ยอดโอนวันนี้',
                'Earning obligations created today, by currency and current state. Not today’s transfers.',
              ),
              style: const TextStyle(fontSize: 12),
            ),
            Text(
              '${t('ข้อมูล ณ', 'As of')}: ${DateTime.parse(value.snapshotAt).toLocal()}',
              style: const TextStyle(fontSize: 11),
            ),
          ],
        ],
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: busy ? null : load,
            child: Text(t('โหลดสรุปรายวัน', 'Refresh daily summary')),
          ),
        ),
      ],
    );
    if (!widget.compact) return content;
    return Container(
      constraints: const BoxConstraints(minHeight: 110),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: content,
    );
  }

  @override
  void dispose() {
    epoch++;
    dayTimer?.cancel();
    unawaited(changes?.cancel());
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
