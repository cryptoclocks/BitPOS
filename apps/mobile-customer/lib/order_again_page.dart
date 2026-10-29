import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_info.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/owned_route.dart';

/// Read-only suggestions from this session's own paid, accepted food orders.
/// Historical prices and option selections are deliberately not reusable quotes.
class OrderAgainPage extends StatefulWidget {
  const OrderAgainPage({
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
  State<OrderAgainPage> createState() => _OrderAgainPageState();
}

class _OrderAgainPageState extends State<OrderAgainPage> {
  late final _scope = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? _sessions;
  ModalRoute<dynamic>? _route;
  List<({MobileFoodOrderSummary summary, MobileFoodOrder order})> _items = [];
  bool _loading = true, _invalidated = false;
  String? _error;
  int _generation = 0;
  String t(String th, String en) => widget.thai ? th : en;
  bool get _current =>
      mounted &&
      !_invalidated &&
      widget.owner.value &&
      _scope != null &&
      widget.api.sessionScope == _scope;

  @override
  void initState() {
    super.initState();
    widget.owner.addListener(_ownerChanged);
    _sessions = widget.api.sessionScopes.listen((scope) {
      if (scope != _scope) _invalidate();
    });
    unawaited(_load());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
    if (!_current) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _invalidate());
    }
  }

  void _ownerChanged() {
    if (!widget.owner.value) _invalidate();
  }

  void _invalidate() {
    if (!mounted) return;
    setState(() {
      _invalidated = true;
      _items = [];
      _error = null;
    });
    _generation++;
    if (_route?.isFirst == false) removeOwnedRoute(_route);
  }

  @override
  void dispose() {
    widget.owner.removeListener(_ownerChanged);
    unawaited(_sessions?.cancel());
    super.dispose();
  }

  Future<void> _load() async {
    if (!_current) return;
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      _items = [];
    });
    try {
      final page = await widget.api.foodOrders();
      if (!_current || generation != _generation) return;
      final summaries = page.orders
          .take(30)
          .where((s) => s.status == 'PAID' && s.acceptanceStatus == 'ACCEPTED')
          .take(10);
      final next =
          <({MobileFoodOrderSummary summary, MobileFoodOrder order})>[];
      for (final summary in summaries) {
        final order = await widget.api.foodOrder(summary.id);
        if (!_current || generation != _generation) return;
        // Recheck detail: history can change between these authenticated reads.
        if (order.id == summary.id &&
            order.branchId == summary.branchId &&
            order.merchantId == summary.merchantId &&
            order.status == 'PAID' &&
            order.acceptanceStatus == 'ACCEPTED' &&
            order.refunds.isEmpty &&
            order.nextRefundCursor == null) {
          next.add((summary: summary, order: order));
        }
      }
      if (_current && generation == _generation) setState(() => _items = next);
    } catch (e) {
      if (!_current || generation != _generation) return;
      if (e is MobileApiException &&
          ['AUTH_REQUIRED', 'SESSION_CHANGED'].contains(e.code)) {
        _invalidate();
        widget.onAuthenticationRequired();
        return;
      }
      setState(
        () => _error = t(
          'โหลดรายการไม่สำเร็จ ลองอีกครั้ง',
          'Could not load suggestions. Try again.',
        ),
      );
    } finally {
      if (_current && generation == _generation)
        setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_invalidated || !_current) return const SizedBox.shrink();
    return Scaffold(
      backgroundColor: const Color(0xfff8f5fc),
      appBar: AppBar(
        backgroundColor: const Color(0xfff8f5fc),
        title: Text(t('สั่งอีกครั้ง', 'Order again')),
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            t('รายการที่คุณเคยสั่ง', 'From your own orders'),
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),
          BitPosInfoLine(
            key: const ValueKey('order-again-info'),
            thai: widget.thai,
            summary: t('ดูย้อนหลังอย่างเดียว ไม่สร้างออเดอร์', 'Read-only. Creates no order.'),
            title: t('เกี่ยวกับรายการนี้', 'About this list'),
            paragraphs: [
              t(
                'ดูย้อนหลังอย่างเดียว จาก 30 ออเดอร์ล่าสุดของคุณ แสดงสูงสุด 10 ออเดอร์ที่จ่ายแล้วและร้านรับแล้ว ไม่รวมออเดอร์ที่มีรายการคืนเงิน',
                'Read-only suggestions from your latest 30 orders, showing up to 10 paid and accepted orders. Orders with refund records are excluded.',
              ),
              t(
                'ตรวจเมนู ตัวเลือก สต็อก และราคาปัจจุบันที่ร้านก่อนสั่งใหม่ หน้านี้ไม่สร้างออเดอร์หรือชำระเงิน',
                'Check the branch menu, options, stock and current prices before ordering again. This page creates no order or payment.',
              ),
            ],
          ),
          const SizedBox(height: 20),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_error != null) ...[
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            TextButton(
              onPressed: _load,
              child: Text(t('ลองอีกครั้ง', 'Try again')),
            ),
          ] else if (_items.isEmpty)
            Text(
              t(
                'ยังไม่มีรายการที่แนะนำจากประวัติของคุณ',
                'No suggestions from your order history yet.',
              ),
            )
          else ...[
            for (final item in _items)
              Card(
                key: ValueKey('order-again.${item.order.id}'),
                margin: const EdgeInsets.only(bottom: 14),
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.summary.merchantName,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        '${t('สาขา', 'Branch')} ${item.order.branchId.substring(0, 8)}',
                      ),
                      Text(
                        '${t('สั่งเมื่อ', 'Ordered on')} ${MaterialLocalizations.of(context).formatMediumDate(DateTime.parse(item.order.createdAt).toLocal())}',
                      ),
                      const SizedBox(height: 10),
                      for (final line in item.order.lines)
                        Text(
                          '${line.qty} × ${widget.thai || line.nameEn.isEmpty ? line.name : line.nameEn}',
                        ),
                    ],
                  ),
                ),
              ),
            TextButton(onPressed: _load, child: Text(t('โหลดใหม่', 'Refresh'))),
          ],
        ],
      ),
    );
  }
}
