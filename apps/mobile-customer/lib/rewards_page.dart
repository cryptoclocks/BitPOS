import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/owned_route.dart';

/// Derived loyalty points. The server recomputes them from paid online orders on every
/// read (one point per whole currency unit, refunded orders excluded); nothing is stored,
/// redeemable or promised here.
class RewardsPage extends StatefulWidget {
  const RewardsPage({
    super.key,
    required this.api,
    required this.owner,
    required this.thai,
    required this.onAuthenticationRequired,
  });
  final MobileApi api;
  final ValueListenable<bool> owner;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  @override
  State<RewardsPage> createState() => _RewardsPageState();
}

class _RewardsPageState extends State<RewardsPage> {
  ModalRoute<dynamic>? route;
  MobileRewards? rewards;
  bool loading = true;
  String? error;
  String t(String th, String en) => widget.thai ? th : en;
  bool get _current => mounted && widget.owner.value;

  @override
  void initState() {
    super.initState();
    widget.owner.addListener(_ownerChanged);
    unawaited(_load());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    route = ModalRoute.of(context);
    if (!widget.owner.value) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _ownerChanged());
    }
  }

  void _ownerChanged() {
    if (!widget.owner.value) removeOwnedRoute(route);
  }

  @override
  void dispose() {
    widget.owner.removeListener(_ownerChanged);
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final next = await widget.api.rewards();
      if (_current) setState(() => rewards = next);
    } catch (e) {
      if (!_current) return;
      if (e is MobileApiException && e.code == 'AUTH_REQUIRED') {
        widget.onAuthenticationRequired();
        return;
      }
      setState(
        () => error = t(
          'โหลดแต้มไม่สำเร็จ ลองอีกครั้ง',
          'Could not load your points. Try again.',
        ),
      );
    } finally {
      if (_current) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final value = rewards;
    return Scaffold(
      backgroundColor: const Color(0xfff8f5fc),
      appBar: AppBar(
        backgroundColor: const Color(0xfff8f5fc),
        toolbarHeight: 72,
        leadingWidth: 76,
        titleSpacing: 0,
        leading: Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 14, 14),
          child: IconButton.filledTonal(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.of(context).maybePop(),
            style: IconButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: const Color(0xff64188a),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: Color(0xffe9e1f1)),
              ),
            ),
            icon: const Icon(Icons.chevron_left, size: 22),
          ),
        ),
        title: const Text(
          'BitPOS Rewards',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            t(
              'แต้มคำนวณจากออเดอร์อาหารที่ชำระแล้วของคุณ 1 แต้มต่อเงิน 1 หน่วยเต็ม ไม่นับออเดอร์ที่มีการคืนเงิน แยกตามสกุลเงิน ยังไม่สามารถแลกรางวัลได้',
              'Points are worked out from your paid food orders: 1 point per whole currency unit, per currency, excluding orders with a refund. Redeeming rewards is not available yet.',
            ),
          ),
          const SizedBox(height: 16),
          if (loading) const LinearProgressIndicator(),
          if (error != null) ...[
            Semantics(liveRegion: true, child: Text(error!)),
            OutlinedButton(
              onPressed: loading ? null : _load,
              child: Text(t('ลองอีกครั้ง', 'Try again')),
            ),
          ],
          if (value != null && value.totals.isEmpty)
            Text(
              t('ยังไม่มีแต้ม', 'No points yet.'),
              key: const ValueKey('rewards-empty'),
            ),
          if (value != null)
            for (final total in value.totals)
              Container(
                key: ValueKey('rewards-${total.currency}'),
                margin: const EdgeInsets.only(top: 14),
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: const Color(0xff64188a),
                  borderRadius: BorderRadius.circular(28),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${total.points} ${t('แต้ม', 'points')}',
                      style: const TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${total.currency} · ${total.orders} ${t('ออเดอร์', 'orders')}',
                      style: const TextStyle(color: Colors.white),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}
