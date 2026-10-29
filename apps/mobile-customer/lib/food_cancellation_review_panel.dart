import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_cancellation_review_mutation.dart';

class FoodCancellationReviewPanel extends StatefulWidget {
  const FoodCancellationReviewPanel({
    super.key,
    required this.api,
    required this.orderId,
    required this.shipmentId,
    required this.thai,
    required this.onAuthenticationRequired,
    this.owner,
    this.standalone = false,
  });
  final MobileApi api;
  final String orderId, shipmentId;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final ValueListenable<bool>? owner;
  final bool standalone;
  @override
  State<FoodCancellationReviewPanel> createState() =>
      _FoodCancellationReviewPanelState();
}

class _FoodCancellationReviewPanelState
    extends State<FoodCancellationReviewPanel>
    with WidgetsBindingObserver {
  final _detail = TextEditingController();
  late final _session = widget.api.sessionScope;
  FoodCancellationReviewOwnPage? _page;
  FoodCancellationReviewMutation? _pending;
  Object? _error;
  bool _busy = false, _foreground = true, _recorded = false;
  bool _active = true;
  String _reason = '';
  bool _moreReasons = false, _detailMissing = false;
  int _epoch = 0;
  bool get _current =>
      mounted &&
      _active &&
      _foreground &&
      (widget.owner?.value ?? true) &&
      widget.api.sessionScope == _session;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.owner?.addListener(_ownerChanged);
    unawaited(_run(_load));
  }

  @override
  void deactivate() {
    // Owner disposal can notify after this subtree's editor is inactive.
    // Retire subscriptions before that point, not after EditableText disposal.
    _active = false;
    _epoch++;
    widget.owner?.removeListener(_ownerChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.deactivate();
  }

  @override
  void activate() {
    super.activate();
    _active = true;
    widget.owner?.addListener(_ownerChanged);
    WidgetsBinding.instance.addObserver(this);
    // Descendant editors activate after their parent. Build hides retired
    // ownership immediately; clear its controller once that build completes.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_active) return;
      _ownerChanged();
      if (_current) unawaited(_run(_load));
    });
  }

  void _clear() {
    _epoch++;
    _detail.clear();
    _page = null;
    _pending = null;
    _error = null;
    _recorded = false;
    _moreReasons = false;
  }

  void _ownerChanged() {
    if (!_current && mounted) setState(_clear);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!_foreground) {
      setState(_clear);
    } else {
      unawaited(_run(_load));
    }
  }

  Future<void> _load() async {
    final epoch = _epoch,
        pending = await widget.api.pendingCancellationReview();
    if (!_current || epoch != _epoch) return;
    final page = await widget.api.foodCancellationReviews(widget.orderId);
    if (!_current || epoch != _epoch) return;
    setState(() {
      _pending = pending;
      _page = page;
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    if (!_current || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (_current) {
        setState(() => _error = error);
        if (error is MobileApiException &&
            error.code == 'AUTH_REQUIRED' &&
            !widget.api.signedIn) {
          widget.onAuthenticationRequired();
        }
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit(FoodCancellationReviewMutation command) async {
    if (!_current) return;
    final epoch = _epoch;
    setState(() {
      _pending = command;
      _detail.clear();
      _recorded = false;
    });
    try {
      await widget.api.submitCancellationReview(command);
      if (!_current || epoch != _epoch) return;
      setState(() => _recorded = true);
    } finally {
      if (_current && epoch == _epoch) {
        final pending = await widget.api.pendingCancellationReview();
        if (_current && epoch == _epoch) setState(() => _pending = pending);
      }
    }
    if (_current && epoch == _epoch) await _load();
  }

  String _reasonLabel(String value) => switch (value) {
    'NO_DRIVER' => t('หาไรเดอร์ไม่ได้', 'No driver found'),
    'LATE_ORDER' => t('ใช้เวลานานกว่าที่คาด', 'Taking longer than expected'),
    'WRONG_ORDER' => t('ออเดอร์ไม่ถูกต้อง', 'Wrong order details'),
    'CHANGE_OF_PLANS' => t('เปลี่ยนแผนการสั่ง', 'Change of plans'),
    _ => t('อื่น ๆ', 'Other'),
  };
  String _reasonDescription(String value) => switch (value) {
    'CHANGE_OF_PLANS' => t('ขอให้ทีมช่วยตรวจสอบ', 'Ask the team to review'),
    'LATE_ORDER' => t('ขอให้ทีมช่วยตรวจสอบ', 'Ask the team to review'),
    'NO_DRIVER' => t('ขอให้ทีมช่วยตรวจสอบ', 'Ask the team to review'),
    'WRONG_ORDER' => t(
      'แจ้งรายละเอียดที่ไม่ถูกต้อง',
      'Report an order detail issue',
    ),
    _ => t('ระบุเหตุผลเพิ่มเติม', 'Add context for the team'),
  };
  IconData _reasonIcon(String value) => switch (value) {
    'CHANGE_OF_PLANS' => Icons.check,
    'LATE_ORDER' => Icons.wb_sunny_outlined,
    'NO_DRIVER' => Icons.two_wheeler_outlined,
    'WRONG_ORDER' => Icons.info_outline,
    _ => Icons.auto_awesome_outlined,
  };
  @override
  Widget build(BuildContext context) {
    if (!_current) return const SizedBox.shrink();
    final page = _page,
        pending = _pending,
        open =
            page?.items.any((review) => review is FoodCancellationReviewOpen) ??
            false;
    final content = Padding(
      padding: EdgeInsets.all(widget.standalone ? 0 : 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!widget.standalone) ...[
            Text(
              t('ขอให้ตรวจสอบการยกเลิก', 'Request cancellation review'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  '${t('ยังยืนยันผลไม่ได้', 'Outcome not confirmed')}: ${_error is MobileApiException ? (_error as MobileApiException).code : t('เครือข่ายหรือรูปแบบข้อมูลไม่พร้อม', 'Network or response unavailable')}',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          if (_detailMissing)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  t(
                    'พิมพ์รายละเอียดสั้น ๆ ในช่องด้านล่างก่อนส่งคำขอ',
                    'Please type a short detail in the box below before sending.',
                  ),
                  key: const ValueKey('food-cancellation-detail-missing'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
          if (_recorded)
            Semantics(
              liveRegion: true,
              child: Text(
                t(
                  'บันทึกคำขอแล้ว ออเดอร์ยังไม่ถูกยกเลิกและยังไม่ได้คืนเงิน',
                  'Request recorded. The order is not cancelled and no refund has been executed.',
                ),
                key: const ValueKey('food-cancellation-review-recorded'),
              ),
            ),
          if (!widget.standalone)
            OutlinedButton(
              key: const ValueKey('food-cancellation-review-refresh'),
              onPressed: _busy ? null : () => _run(_load),
              child: Text(
                t(
                  'โหลดประวัติและสถานะปัจจุบัน',
                  'Reload history and current status',
                ),
              ),
            ),
          if (pending != null) ...[
            Text(
              '${t('คำขอเดิมยังไม่ทราบผลสำหรับออเดอร์', 'Saved unresolved review request for order')} ${pending.orderId}',
            ),
            if (pending.orderId == widget.orderId)
              FilledButton(
                onPressed: _busy ? null : () => _run(() => _submit(pending)),
                child: Text(
                  t(
                    'ลองคำขอที่บันทึกไว้เดิม',
                    'Retry exact saved review request',
                  ),
                ),
              )
            else
              Text(
                t(
                  'กลับไปออเดอร์เดิมเพื่อกู้คืนคำขอ ห้ามสร้างคำขอใหม่แทน',
                  'Return to that order to recover its request; do not replace it with a new command.',
                ),
              ),
          ] else if (page != null && !open) ...[
            for (final value in [
              'CHANGE_OF_PLANS',
              'LATE_ORDER',
              'OTHER',
              if (!widget.standalone || _moreReasons) ...[
                'NO_DRIVER',
                'WRONG_ORDER',
              ],
            ]) ...[
              Card(
                key: ValueKey('food-cancellation-reason.$value'),
                margin: widget.standalone ? EdgeInsets.zero : null,
                color: _reason == value
                    ? const Color(0xfff3eafa)
                    : Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: BorderSide(
                    color: _reason == value
                        ? const Color(0xff64188a)
                        : const Color(0xffe9e1f1),
                  ),
                ),
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: _busy ? null : () => setState(() => _reason = value),
                  child: ConstrainedBox(
                    constraints: widget.standalone
                        ? const BoxConstraints(minHeight: 82)
                        : const BoxConstraints(),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: const Color(0xffefe6f8),
                              borderRadius: BorderRadius.circular(13),
                            ),
                            alignment: Alignment.center,
                            child: Icon(
                              _reasonIcon(value),
                              color: const Color(0xff64188a),
                              size: 20,
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _reasonLabel(value),
                                  style: const TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xff29183f),
                                  ),
                                ),
                                if (widget.standalone)
                                  Text(
                                    _reasonDescription(value),
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: Color(0xff7b7088),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          if (_reason == value) ...[
                            const Icon(
                              Icons.radio_button_checked,
                              color: Color(0xff64188a),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.check, color: Color(0xff64188a)),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              if (widget.standalone &&
                  value != (_moreReasons ? 'WRONG_ORDER' : 'OTHER'))
                const SizedBox(height: 22),
            ],
            if (widget.standalone)
              TextButton(
                key: const ValueKey('food-cancellation-more-reasons'),
                onPressed: _busy
                    ? null
                    : () => setState(() => _moreReasons = !_moreReasons),
                child: Text(
                  _moreReasons
                      ? t('แสดงเหตุผลหลัก', 'Show main reasons')
                      : t('เหตุผลอื่นที่เลือกได้', 'More reasons'),
                ),
              ),
            if (_reason.isNotEmpty) ...[
              if (widget.standalone) const SizedBox(height: 12),
              TextField(
                key: const ValueKey('food-cancellation-review-detail'),
                controller: _detail,
                onChanged: (_) {
                  if (_detailMissing) setState(() => _detailMissing = false);
                },
                enabled: !_busy,
                maxLength: 2000,
                minLines: 2,
                maxLines: 5,
                decoration: InputDecoration(
                  labelText: t(
                    'รายละเอียดส่วนตัวสำหรับเจ้าหน้าที่',
                    'Private detail for support',
                  ),
                ),
              ),
            ],
            if (widget.standalone && _reason.isEmpty)
              const SizedBox(height: 128),
            if (widget.standalone)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  t(
                    'ตอนนี้ยกเลิกออเดอร์ทันทีในแอปไม่ได้ ส่งคำขอให้ทีมงานตรวจสอบแทน ออเดอร์ ยอดเงิน สต็อก และงานไรเดอร์จะยังไม่เปลี่ยนจนกว่าทีมงานจะดำเนินการ',
                    'The app cannot cancel an order instantly. This only asks staff to review; it does not cancel the order, refund payment, return stock or release the rider job until staff act.',
                  ),
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xff704d13),
                    height: 1.35,
                  ),
                ),
              ),
            Semantics(
              label: t(
                'ส่งคำขอให้เจ้าหน้าที่ตรวจสอบเท่านั้น ยังไม่ยกเลิกออเดอร์ คืนเงิน คืนสต็อก หรือปล่อยงานไรเดอร์',
                'Submit a staff review request only. This does not cancel the order, refund payment, return stock, or release a rider.',
              ),
              child: FilledButton(
                key: const ValueKey('food-cancellation-review-send'),
                onPressed: _busy || _reason.isEmpty
                    ? null
                    : () {
                        if (_detail.text.trim().isEmpty) {
                          setState(() {
                            _error = null;
                            _detailMissing = true;
                          });
                          return;
                        }
                        final command = widget.api.newCancellationReview(
                          orderId: widget.orderId,
                          shipmentId: widget.shipmentId,
                          shipmentVersion: page.shipmentVersion,
                          reasonCode: _reason,
                          detail: _detail.text,
                        );
                        unawaited(_run(() => _submit(command)));
                      },
                child: Text(
                  t(
                    'ส่งคำขอตรวจสอบ — ไม่ใช่ยกเลิกทันที',
                    'Submit review request — not instant cancellation',
                  ),
                ),
              ),
            ),
          ],
          if (open)
            Text(
              t(
                'มีคำขอที่รอตรวจสอบอยู่แล้ว การจัดส่งยังคงใช้สถานะจริง',
                'An open review already exists. Delivery continues under its actual state.',
              ),
            ),
          if (page != null) ...[
            Text(
              '${t('ประวัติล่าสุดไม่เกิน', 'Latest history, up to')} ${page.historyLimit}',
            ),
            for (final review in page.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: switch (review) {
                  FoodCancellationReviewOpen() => Text(
                    '${_reasonLabel(review.reasonCode)} · ${t('รอตรวจสอบ', 'Awaiting review')}\n${DateTime.parse(review.requestedAt).toLocal()}',
                  ),
                  FoodCancellationReviewReviewed() => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_reasonLabel(review.reasonCode)} · ${review.decision == 'DECLINED' ? t('ไม่รับคำขอนี้', 'Request declined') : t('ต้องตรวจสอบการชดเชยเพิ่มเติม', 'Further compensation review required')}',
                      ),
                      Text(review.customerExplanation),
                      Text(
                        t(
                          'ผลตรวจสอบไม่ใช่หลักฐานการคืนเงินหรือยกเลิกออเดอร์',
                          'Review outcome is not evidence of a refund or order cancellation.',
                        ),
                      ),
                    ],
                  ),
                },
              ),
          ],
          if (widget.standalone)
            OutlinedButton(
              key: const ValueKey('food-cancellation-review-refresh'),
              onPressed: _busy ? null : () => _run(_load),
              child: Text(
                t(
                  'โหลดประวัติและสถานะปัจจุบัน',
                  'Reload history and current status',
                ),
              ),
            ),
          if (_busy) const LinearProgressIndicator(),
        ],
      ),
    );
    return widget.standalone ? content : Card(child: content);
  }

  @override
  void dispose() {
    _epoch++;
    WidgetsBinding.instance.removeObserver(this);
    widget.owner?.removeListener(_ownerChanged);
    _detail.dispose();
    super.dispose();
  }
}
