import 'food_compensation_page.dart';
import 'presentation/driver_history_card.dart';

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_layout.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'presentation/driver_presentation.dart';

class DriverFoodHistoryPage extends StatefulWidget {
  const DriverFoodHistoryPage({
    super.key,
    required this.api,
    required this.thai,
  });
  final MobileApi api;
  final bool thai;
  @override
  State<DriverFoodHistoryPage> createState() => _DriverFoodHistoryPageState();
}

class _DriverFoodHistoryPageState extends State<DriverFoodHistoryPage>
    with WidgetsBindingObserver {
  FoodDriverHistory? page;
  bool busy = false, retired = false;
  bool deliveredOnly = false;
  String? error;
  int generation = 0;
  late final owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? changes;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    changes = widget.api.sessionScopes.listen((next) {
      if (next != owner && mounted) {
        generation++;
        setState(() {
          retired = true;
          busy = false;
          page = null;
        });
      }
    });
    unawaited(load());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    if (state == AppLifecycleState.resumed) {
      unawaited(load());
    } else {
      generation++;
      setState(() {
        page = null;
        busy = false;
      });
    }
  }

  @override
  void dispose() {
    generation++;
    WidgetsBinding.instance.removeObserver(this);
    unawaited(changes?.cancel());
    super.dispose();
  }

  Future<void> load({String? cursor}) async {
    if (busy || retired) return;
    if (widget.api.sessionScope != owner || !widget.api.signedIn) {
      setState(() {
        retired = true;
        page = null;
      });
      return;
    }
    final run = ++generation;
    setState(() {
      busy = true;
      error = null;
      if (cursor == null) page = null;
    });
    try {
      final result = await widget.api.driverFoodHistory(cursor: cursor);
      if (!mounted || run != generation) return;
      if (widget.api.sessionScope != owner || !widget.api.signedIn) {
        setState(() {
          retired = true;
          page = null;
        });
        return;
      }
      setState(() => page = result);
    } catch (e) {
      if (mounted && run == generation) {
        setState(() {
          error = t(
            'โหลดประวัติไม่สำเร็จ ลองโหลดหน้าที่ต้องการอีกครั้ง',
            'History unavailable. Retry the desired page.',
          );
          if (!widget.api.signedIn ||
              widget.api.sessionScope != owner ||
              e is MobileApiException &&
                  ['AUTH_REQUIRED', 'ROLE_REQUIRED'].contains(e.code)) {
            retired = true;
            page = null;
          }
        });
      }
    } finally {
      if (mounted && run == generation) setState(() => busy = false);
    }
  }

  Widget _filter(BuildContext context, bool delivered) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final selected = deliveredOnly == delivered;
    final foreground = dark
        ? (selected ? colors.onPrimaryContainer : colors.onSurfaceVariant)
        : delivered
        ? BitPosDesignTokens.green
        : BitPosDesignTokens.primary;
    return Semantics(
      button: true,
      selected: selected,
      child: Tooltip(
        message: t('กรองเฉพาะงานในหน้านี้', 'Filter assignments on this page'),
        child: InkWell(
          onTap: () => setState(() => deliveredOnly = delivered),
          borderRadius: BorderRadius.circular(15),
          child: SizedBox(
            width: 90,
            height: 48,
            child: Center(
              child: Container(
                constraints: const BoxConstraints(minHeight: 30),
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: dark
                      ? (selected
                            ? colors.primaryContainer
                            : colors.surfaceContainerHighest)
                      : delivered
                      ? BitPosDesignTokens.greenbg
                      : BitPosDesignTokens.tint,
                  borderRadius: BorderRadius.circular(15),
                  border: selected
                      ? Border.all(color: foreground.withValues(alpha: 0.35))
                      : null,
                ),
                child: Text(
                  delivered ? t('สำเร็จ', 'Delivered') : t('ทั้งหมด', 'All'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.65,
                    fontWeight: FontWeight.w600,
                    color: foreground,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => DriverPresentation(
    child: Builder(
      builder: (context) {
        final colors = Theme.of(context).colorScheme;
        final dark = Theme.of(context).brightness == Brightness.dark;
        final items = page?.items ?? const <FoodDriverHistoryItem>[];
        final visible = deliveredOnly
            ? items.where((item) => item.state == 'DELIVERED')
            : items;
        return Scaffold(
          backgroundColor: dark
              ? colors.surface
              : BitPosDesignTokens.background,
          body: SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 980),
                child: ListView(
                  padding: const EdgeInsets.only(top: 12, bottom: 32),
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
                      child: Row(
                        children: [
                          BitPosBackTile(tooltip: t('กลับ', 'Back')),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              t('ประวัติการรับงาน', 'Delivery history'),
                              style: Theme.of(context).textTheme.headlineSmall,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (retired)
                      Padding(
                        padding: const EdgeInsets.all(24),
                        child: Semantics(
                          liveRegion: true,
                          child: Text(
                            t('กรุณาเข้าสู่ระบบใหม่', 'Sign in again'),
                          ),
                        ),
                      )
                    else
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const SizedBox(height: 29),
                            Wrap(
                              spacing: 12,
                              runSpacing: 8,
                              children: [
                                _filter(context, false),
                                _filter(context, true),
                              ],
                            ),
                            const SizedBox(height: 13),
                            Text(
                              t(
                                'งานที่ปิดแล้ว · หน้านี้',
                                'Closed deliveries · this page',
                              ),
                              style: TextStyle(
                                fontSize: 15,
                                height: 1.65,
                                color: dark
                                    ? colors.onSurfaceVariant
                                    : BitPosDesignTokens.muted,
                              ),
                            ),
                            const SizedBox(height: 15),
                            if (busy) ...[
                              Semantics(
                                label: t(
                                  'กำลังโหลดประวัติ',
                                  'Loading delivery history',
                                ),
                                liveRegion: true,
                                child: const LinearProgressIndicator(),
                              ),
                              const SizedBox(height: 16),
                            ],
                            if (error != null) ...[
                              Semantics(
                                liveRegion: true,
                                child: Text(
                                  error!,
                                  style: TextStyle(color: colors.error),
                                ),
                              ),
                              const SizedBox(height: 16),
                            ],
                            if (page != null && visible.isEmpty) ...[
                              Card(
                                elevation: 0,
                                child: Padding(
                                  padding: const EdgeInsets.all(20),
                                  child: Column(
                                    children: [
                                      Icon(
                                        Icons.receipt_long_outlined,
                                        size: 32,
                                        color: colors.onSurfaceVariant,
                                      ),
                                      const SizedBox(height: 12),
                                      Text(
                                        items.isEmpty
                                            ? t(
                                                'ยังไม่มีประวัติงานที่ปิดแล้ว',
                                                'No closed deliveries yet.',
                                              )
                                            : t(
                                                'ไม่มีงานส่งสำเร็จในหน้านี้ ลองดูงานทั้งหมดหรือหน้าถัดไป',
                                                'No delivered assignments on this page. View All or try another page.',
                                              ),
                                        textAlign: TextAlign.center,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(height: 30),
                            ],
                            for (final item in visible)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 30),
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    DriverHistoryCard(
                                      key: ValueKey(item.id),
                                      item: item,
                                      thai: widget.thai,
                                    ),
                                    if (item.state == 'RETURNED') ...[
                                      const SizedBox(height: 8),
                                      OutlinedButton(
                                        onPressed: () =>
                                            Navigator.of(context).push(
                                              MaterialPageRoute(
                                                builder: (_) =>
                                                    DriverFoodCompensationPage(
                                                      api: widget.api,
                                                      assignmentId: item.id,
                                                      thai: widget.thai,
                                                    ),
                                              ),
                                            ),
                                        child: Text(
                                          t(
                                            'ตรวจค่าชดเชยงานนี้',
                                            'Check compensation for this assignment',
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            Text(
                              t(
                                'เฉพาะงานที่ปิดแล้ว ค่าจัดส่งตามราคาเดิมไม่ใช่ยอดรายได้หรือยอดโอน ดูสถานะการจ่ายในหน้ารายได้',
                                'Closed assignments only. The quoted delivery fee is not an earning or transfer receipt. Check Earnings for payment status.',
                              ),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            const SizedBox(height: 16),
                            Wrap(
                              spacing: 12,
                              runSpacing: 8,
                              children: [
                                OutlinedButton(
                                  onPressed: busy ? null : () => load(),
                                  child: Text(t('ล่าสุด', 'Newest')),
                                ),
                                if (page?.nextCursor != null)
                                  OutlinedButton(
                                    onPressed: busy
                                        ? null
                                        : () => load(cursor: page!.nextCursor),
                                    child: Text(
                                      t('งานเก่ากว่านี้', 'Older deliveries'),
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    ),
  );
}
