import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

/// Own published rating aggregate. No default stars or reviewer identity.
class DriverRatingSummary extends StatefulWidget {
  const DriverRatingSummary({super.key, required this.api, required this.thai});
  final MobileApi api;
  final bool thai;
  @override
  State<DriverRatingSummary> createState() => _DriverRatingSummaryState();
}

class _DriverRatingSummaryState extends State<DriverRatingSummary>
    with WidgetsBindingObserver {
  late final owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? changes;
  DriverReviewSummary? rating;
  Timer? expiry;
  int epoch = 0;
  bool retired = false, foreground = true, busy = false, unavailable = false;
  String t(String th, String en) => widget.thai ? th : en;
  bool get current =>
      mounted &&
      !retired &&
      foreground &&
      widget.api.signedIn &&
      widget.api.sessionScope == owner;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    changes = widget.api.sessionScopes.listen((next) {
      if (mounted && next != owner) {
        epoch++;
        expiry?.cancel();
        setState(() {
          retired = true;
          rating = null;
          busy = false;
        });
      }
    });
    unawaited(load());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    epoch++;
    expiry?.cancel();
    if (!mounted) return;
    setState(() {
      rating = null;
      busy = false;
    });
    if (current) unawaited(load());
  }

  Future<void> load() async {
    if (!current || busy) return;
    final run = ++epoch;
    expiry?.cancel();
    setState(() {
      busy = true;
      unavailable = false;
      rating = null;
    });
    try {
      final value = await widget.api.driverReviewSummary();
      if (!current || run != epoch) return;
      final until = DateTime.parse(value.snapshotAt)
              .add(const Duration(minutes: 5)),
          remaining = until.difference(DateTime.now());
      if (remaining <= Duration.zero) {
        throw const FormatException('Expired rating snapshot');
      }
      setState(() => rating = value);
      expiry = Timer(
        remaining > const Duration(minutes: 5)
            ? const Duration(minutes: 5)
            : remaining,
        () {
          if (current && run == epoch) {
            setState(() {
              rating = null;
              unavailable = true;
            });
          }
        },
      );
    } catch (_) {
      if (current && run == epoch) setState(() => unavailable = true);
    } finally {
      if (current && run == epoch) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (retired || !foreground) return const SizedBox.shrink();
    final value = rating, tenths = value?.averageTenths;
    return Container(
      constraints: const BoxConstraints(minHeight: 110),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE9E1F1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t(
              'คะแนนของคุณ · รีวิวที่เผยแพร่',
              'Your rating · published reviews',
            ),
            style: const TextStyle(fontSize: 13, color: Color(0xFF7B7088)),
          ),
          if (busy) const LinearProgressIndicator(),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.star_rounded, color: Color(0xFFA94800)),
              const SizedBox(width: 8),
              Text(
                tenths == null ? '—' : '${tenths ~/ 10}.${tenths % 10}',
                style: const TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFFA94800),
                ),
              ),
            ],
          ),
          Text(
            unavailable
                ? t('ยังโหลดคะแนนไม่ได้', 'Rating unavailable')
                : value == null
                ? t('กำลังโหลดคะแนน', 'Loading rating')
                : tenths == null
                ? t('ยังไม่มีคะแนนที่เผยแพร่', 'No published ratings yet')
                : t(
                    'จาก ${value.publishedCount} รีวิวที่เผยแพร่',
                    'From ${value.publishedCount} published ${value.publishedCount == '1' ? 'review' : 'reviews'}',
                  ),
            style: const TextStyle(fontSize: 12, color: Color(0xFF7B7088)),
          ),
          TextButton(
            onPressed: busy ? null : load,
            child: Text(t('โหลดคะแนนใหม่', 'Refresh rating')),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    epoch++;
    expiry?.cancel();
    unawaited(changes?.cancel());
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
