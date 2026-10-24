import 'presentation/customer_order_card.dart';
import 'presentation/customer_navigation.dart';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

class OrderHistorySheet extends StatefulWidget {
  const OrderHistorySheet({
    super.key,
    required this.api,
    required this.firstPage,
    required this.thai,
    required this.onAuthenticationRequired,
    this.onNavigate,
    this.clock = DateTime.now,
  });
  final ValueChanged<int>? onNavigate;
  final MobileApi api;
  final MobileFoodOrders firstPage;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final DateTime Function() clock;
  @override
  State<OrderHistorySheet> createState() => _OrderHistorySheetState();
}

class _OrderHistorySheetState extends State<OrderHistorySheet> {
  late MobileFoodOrders _page = widget.firstPage;
  bool _loading = false;
  bool _failed = false;
  bool _activeOnly = false;
  String t(String th, String en) => widget.thai ? th : en;
  List<MobileFoodOrderSummary> get _visibleOrders {
    final orders = _page.orders;
    if (!_activeOnly) return orders;
    const terminal = {
      'REJECTED',
      'TIMED_OUT',
      'CANCELLED',
      'DELIVERED',
      'COLLECTED',
    };
    return orders
        .where(
          (order) =>
              !terminal.contains(order.acceptanceStatus) &&
              !terminal.contains(order.fulfillmentStatus),
        )
        .toList(growable: false);
  }

  DateTime? _day(String value) {
    final date = DateTime.tryParse(value)?.toLocal();
    return date == null ? null : DateTime(date.year, date.month, date.day);
  }

  String _dayLabel(String value) {
    final day = _day(value);
    if (day == null) return t('วันที่ไม่พร้อมใช้งาน', 'Date unavailable');
    final now = widget.clock();
    final today = DateTime(now.year, now.month, now.day);
    if (day == today) return t('วันนี้', 'Today');
    if (day == today.subtract(const Duration(days: 1))) {
      return t('เมื่อวาน', 'Yesterday');
    }
    return '${day.day.toString().padLeft(2, '0')}/${day.month.toString().padLeft(2, '0')}/${day.year}';
  }

  Widget _filterPill({
    required String label,
    required String keyName,
    required bool selected,
    required double width,
    required VoidCallback onTap,
  }) => Semantics(
    button: true,
    selected: selected,
    label: label,
    child: InkWell(
      key: ValueKey(keyName),
      borderRadius: BorderRadius.circular(24),
      onTap: _loading ? null : onTap,
      child: SizedBox(
        width: width,
        height: 48,
        child: Center(
          child: Container(
            key: ValueKey('$keyName.visual'),
            width: width,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: selected
                  ? const Color(0xffefe6f8)
                  : const Color(0xfff3eafa),
              borderRadius: BorderRadius.circular(15),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: const Color(0xff64188a),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  Future<void> _load(String? cursor) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final page = await widget.api.foodOrders(cursor: cursor);
      if (mounted) setState(() => _page = page);
    } catch (error) {
      if (!mounted) return;
      if (error is MobileApiException &&
          error.code == 'AUTH_REQUIRED' &&
          !widget.api.signedIn) {
        Navigator.pop(context);
        widget.onAuthenticationRequired();
        return;
      }
      setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final content = Material(
      color: const Color(0xfff8f5fc),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Transform.translate(
                offset: const Offset(-6, 0),
                child: Row(
                  children: [
                    SizedBox(
                      width: 44,
                      height: 44,
                      child: IconButton(
                        tooltip: t('กลับ', 'Back'),
                        onPressed: () => Navigator.pop(context),
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
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        t('กิจกรรมของคุณ', 'Your activity'),
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                          color: Color(0xff29183f),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),
              Align(
                alignment: Alignment.centerLeft,
                child: Row(
                  children: [
                    _filterPill(
                      label: t('ทั้งหมด', 'All'),
                      keyName: 'history-filter-all',
                      selected: !_activeOnly,
                      width: 86,
                      onTap: () => setState(() => _activeOnly = false),
                    ),
                    const SizedBox(width: 12),
                    _filterPill(
                      label: t('กำลังดำเนินการ', 'In progress'),
                      keyName: 'history-filter-active',
                      selected: _activeOnly,
                      width: 140,
                      onTap: () => setState(() => _activeOnly = true),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              if (_loading) const LinearProgressIndicator(),
              if (_failed)
                Text(
                  t(
                    'โหลดประวัติไม่สำเร็จ ลองหน้าที่ต้องการอีกครั้ง',
                    'Could not load history. Retry the desired page.',
                  ),
                  semanticsLabel: t(
                    'โหลดประวัติไม่สำเร็จ',
                    'History unavailable',
                  ),
                ),
              if (_visibleOrders.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  child: Text(
                    _page.orders.isEmpty
                        ? t('ยังไม่มีออร์เดอร์', 'No orders yet')
                        : t(
                            'ไม่มีออร์เดอร์ที่กำลังดำเนินการ',
                            'No orders in progress',
                          ),
                  ),
                ),
              Expanded(
                child: ListView.separated(
                  itemCount: _visibleOrders.length,
                  separatorBuilder: (_, index) {
                    return const SizedBox(height: 30);
                  },
                  itemBuilder: (context, index) {
                    final order = _visibleOrders[index];
                    final day = _day(order.createdAt);
                    final now = widget.clock();
                    final today = DateTime(now.year, now.month, now.day);
                    final showToday = index == 0 && day == today;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (showToday) ...[
                          Padding(
                            padding: const EdgeInsets.fromLTRB(0, 8, 0, 17),
                            child: Text(
                              _dayLabel(order.createdAt),
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                                color: Color(0xff7b7088),
                              ),
                            ),
                          ),
                        ],
                        CustomerOrderCard(
                          order: order,
                          thai: widget.thai,
                          clock: widget.clock,
                          onOpen: _loading
                              ? null
                              : () => Navigator.pop(context, order.id),
                        ),
                      ],
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                children: [
                  if (_page.nextCursor != null)
                    OutlinedButton(
                      onPressed: _loading
                          ? null
                          : () => _load(_page.nextCursor),
                      child: Text(t('ออร์เดอร์เก่ากว่านี้', 'Older orders')),
                    ),
                  TextButton(
                    onPressed: _loading ? null : () => _load(null),
                    child: Text(t('ออร์เดอร์ล่าสุด', 'Newest orders')),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (widget.onNavigate == null) return content;
    return Scaffold(
      backgroundColor: const Color(0xfff8f5fc),
      body: content,
      bottomNavigationBar: CustomerNavigation(
        thai: widget.thai,
        selectedIndex: 1,
        onSelected: _loading ? null : widget.onNavigate,
      ),
    );
  }
}
