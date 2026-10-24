import 'presentation/refund_obligation_card.dart';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'presentation/customer_navigation.dart';

class OrderRefundsSheet extends StatefulWidget {
  const OrderRefundsSheet({
    super.key,
    required this.api,
    required this.orderId,
    required this.firstPage,
    required this.thai,
    required this.onAuthenticationRequired,
    this.order,
    this.onViewOrder,
    this.onContactSupport,
    this.onNavigation,
  });
  final MobileApi api;
  final String orderId;
  final MobileFoodRefunds firstPage;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final MobileFoodOrder? order;
  final VoidCallback? onViewOrder;
  final VoidCallback? onContactSupport;
  final ValueChanged<int>? onNavigation;
  @override
  State<OrderRefundsSheet> createState() => _OrderRefundsSheetState();
}

class _OrderRefundsSheetState extends State<OrderRefundsSheet> {
  late MobileFoodRefunds _page = widget.firstPage;
  bool _loading = false, _failed = false, _changed = false;
  FoodReturnExecution? _execution;
  bool _executionLoading = false;
  String? _executionError;
  Future<void> _refreshExecution() async {
    if (_executionLoading) return;
    setState(() {
      _executionLoading = true;
      _execution = null;
      _executionError = null;
    });
    try {
      final result = await widget.api.foodRefundExecution(widget.orderId);
      if (!mounted) return;
      setState(() {
        _execution = result.execution;
      });
    } on MobileApiException catch (error) {
      if (!mounted) return;
      if (error.code == 'AUTH_REQUIRED') widget.onAuthenticationRequired();
      setState(() {
        _executionError = t(
          'ยังตรวจผลไม่ได้ กรุณาลองใหม่',
          'Execution status unavailable. Try again.',
        );
      });
    } catch (_) {
      if (mounted)
        setState(() {
          _executionError = t(
            'ยังตรวจผลไม่ได้ กรุณาลองใหม่',
            'Execution status unavailable. Try again.',
          );
        });
    } finally {
      if (mounted)
        setState(() {
          _executionLoading = false;
        });
    }
  }

  String _executionLabel(String state) => switch (state) {
    'FINALIZED' => t(
      'ยืนยันคืนเงินครบจากหลักฐานแล้ว',
      'All payments refunded with finalized evidence',
    ),
    'SELECTED_FINALIZED' => t(
      'ยืนยันคืนเฉพาะรายการที่เลือก ไม่ใช่ยอดชำระทั้งหมด',
      'Selected line refunded; not all original payments',
    ),
    'PARTIAL' => t(
      'ยืนยันคืนบางรายการ ยังไม่ครบ',
      'Some payments refunded; incomplete',
    ),
    'FAILED' => t(
      'การโอนล้มเหลว รอฝ่ายช่วยเหลือตรวจสอบ',
      'Transfer failed; support review required',
    ),
    'RECONCILIATION_REQUIRED' => t(
      'รายการนี้ต้องตรวจสอบ ยังยืนยันว่าคืนครบไม่ได้',
      'Reconciliation required; refund completion unconfirmed',
    ),
    'NOT_REQUESTED' => t(
      'ยังไม่มีคำสั่งโอนคืน',
      'No refund transfer requested',
    ),
    'NOT_DECIDED' => t('รอพิจารณาการคืนเงิน', 'Awaiting financial review'),
    _ => t(
      'รอดำเนินการ ยังไม่ยืนยันโอนคืน',
      'Execution pending; transfer not confirmed',
    ),
  };
  String t(String th, String en) => widget.thai ? th : en;
  Future<void> _load(String? cursor) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final page = await widget.api.foodRefunds(
        widget.orderId,
        after: cursor == null
            ? null
            : (cursor: cursor, generation: _page.generation),
      );
      if (mounted) {
        setState(() {
          _page = page;
          _changed = false;
        });
      }
    } catch (error) {
      if (!mounted) return;
      if (error is MobileApiException &&
          error.code == 'AUTH_REQUIRED' &&
          !widget.api.signedIn) {
        Navigator.pop(context);
        widget.onAuthenticationRequired();
        return;
      }
      setState(() {
        _failed = true;
        if (error is MobileApiException &&
            error.code == 'REFUND_PAGE_CHANGED') {
          _changed = true;
        }
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final order = widget.order;
    return Scaffold(
      appBar: AppBar(
        centerTitle: false,
        toolbarHeight: 72,
        titleSpacing: 0,
        leadingWidth: 76,
        leading: Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 14, 14),
          child: IconButton.filledTonal(
            style: IconButton.styleFrom(
              backgroundColor: colors.surface,
              foregroundColor: colors.primary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: BorderSide(color: colors.outlineVariant),
              ),
            ),
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.chevron_left, size: 22),
          ),
        ),
        title: Text(
          t('ติดตามการคืนเงิน', 'Refund status'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: CustomerNavigation(
          thai: widget.thai,
          selectedIndex: 1,
          onSelected: widget.onNavigation,
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 58, 24, 24),
          children: [
            Center(
              child: Container(
                width: 116,
                height: 116,
                decoration: BoxDecoration(
                  color: colors.secondaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.refresh_rounded,
                  size: 44,
                  color: colors.primary,
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              t('ติดตามการคืนเงิน', 'Refund status'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 20),
            OutlinedButton(
              onPressed: _executionLoading ? null : _refreshExecution,
              child: Text(
                _executionLoading
                    ? t('กำลังตรวจผล…', 'Checking…')
                    : t('ตรวจผลคืนเงินจริง', 'Check refund execution'),
              ),
            ),
            if (_executionError != null) Text(_executionError!),
            if (_execution case final execution?) ...[
              Text(
                _executionLabel(execution.state),
                textAlign: TextAlign.center,
              ),
              if (execution.selectedRefund case final selected?)
                Text(
                  '${t('ยอดคืนรายการที่เลือก', 'Selected line refund')}: ${formatMinorUnits(selected.refundAmount.amountMinor, selected.refundAmount.decimals, selected.refundAmount.currency)}',
                  textAlign: TextAlign.center,
                ),
              Text(
                '${t('ยืนยันแล้ว / รายการจัดสรรคืน', 'Finalized / refund allocations')}: ${execution.finalizedCount} / ${execution.allocationCount}',
                textAlign: TextAlign.center,
              ),
            ],
            if (_execution == null)
              Text(
                t(
                  'มีการบันทึกภาระคืนเงินไว้แล้ว ขณะนี้ยังไม่มีหลักฐานยืนยันการโอนคืน',
                  'A refund obligation is recorded. No verified return-transfer receipt is available yet.',
                ),
                textAlign: TextAlign.center,
                style: TextStyle(color: colors.onSurfaceVariant),
              ),
            const SizedBox(height: 6),
            Text(
              t(
                'กลับมาตรวจรายการที่บันทึกไว้ได้เสมอ',
                'You can return to refresh the recorded obligation history.',
              ),
              textAlign: TextAlign.center,
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
            const SizedBox(height: 70),
            if (order != null)
              Container(
                constraints: const BoxConstraints(minHeight: 82),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 14,
                ),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: colors.outlineVariant),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: colors.secondaryContainer,
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: Icon(
                        Icons.receipt_long_outlined,
                        color: colors.primary,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            '${t('ออเดอร์', 'Order')} #${order.id.substring(0, 8)}',
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            formatMinorUnits(
                              order.total.amountMinor,
                              order.total.decimals,
                              order.total.currency,
                            ),
                            style: TextStyle(
                              fontSize: 12,
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 56),
            if (widget.onViewOrder != null)
              SizedBox(
                height: 52,
                child: FilledButton(
                  onPressed: widget.onViewOrder,
                  child: Text(t('ดูสถานะออเดอร์', 'View order status')),
                ),
              ),
            if (widget.onContactSupport != null) ...[
              const SizedBox(height: 14),
              SizedBox(
                height: 52,
                child: OutlinedButton(
                  onPressed: widget.onContactSupport,
                  child: Text(t('ติดต่อช่วยเหลือ', 'Contact support')),
                ),
              ),
            ],
            const SizedBox(height: 32),
            Text(
              t('คำขอคืนเงินอื่น', 'Other refund requests'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              t(
                'การคืนอาหารและผลโอนคืนแสดงด้านบน · รายการนี้แสดงคำขอคืนเงินอื่น เรียงจากรายการแรก สถานะไม่ใช่หลักฐานการโอนคืน',
                'Returned-food review and transfer status are shown above. Other refund requests are listed oldest first; status is not proof of a transfer.',
              ),
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
            if (_loading) const LinearProgressIndicator(),
            if (_failed)
              Text(
                t(
                  'โหลดไม่สำเร็จ ลองหน้าที่ต้องการอีกครั้ง',
                  'Could not load refunds. Retry the desired page.',
                ),
              ),
            if (_changed)
              Text(
                t(
                  'ประวัติเปลี่ยนแล้ว กลับรายการแรกเพื่อโหลดใหม่',
                  'Refund history changed. Refresh the first page to continue.',
                ),
              ),
            if (_page.refunds.isEmpty)
              Text(
                t(
                  'ไม่มีคำขอคืนเงินอื่นที่บันทึกไว้',
                  'No other refund requests recorded',
                ),
              ),
            ..._page.refunds.map(
              (r) => RefundObligationCard(
                key: ValueKey(r.id),
                refund: r,
                thai: widget.thai,
              ),
            ),
            if (_page.nextCursor != null)
              OutlinedButton(
                onPressed: _loading || _changed
                    ? null
                    : () => _load(_page.nextCursor),
                child: Text(t('ภาระคืนเงินถัดไป', 'Next refund obligations')),
              ),
            TextButton(
              onPressed: _loading ? null : () => _load(null),
              child: Text(t('กลับรายการแรก / อัปเดต', 'First page / refresh')),
            ),
          ],
        ),
      ),
    );
  }
}
