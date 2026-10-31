import 'package:mobile_shared/food_chat_page.dart';

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/owned_route.dart';
import 'package:mobile_shared/food_navigation_map.dart';

import 'food_review_page.dart';

import 'presentation/customer_navigation.dart';
import 'food_cancellation_review_panel.dart';

/// U20: a private, order-scoped tracking route, not a payment confirmation.
class FoodDeliveryPage extends StatefulWidget {
  const FoodDeliveryPage({
    super.key,
    required this.api,
    required this.orderId,
    this.orderTotal,
    required this.thai,
    required this.onAuthenticationRequired,
    this.onViewReceipt,
    this.owner,
    this.onNavigationSelected,
  });
  final MobileApi api;
  final String orderId;
  final MobileMoney? orderTotal;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final VoidCallback? onViewReceipt;
  final ValueListenable<bool>? owner;
  final ValueChanged<int>? onNavigationSelected;
  @override
  State<FoodDeliveryPage> createState() => _FoodDeliveryPageState();
}

class _FoodDeliveryPageState extends State<FoodDeliveryPage> {
  bool? _matching;
  @override
  Widget build(BuildContext context) => Scaffold(
    bottomNavigationBar: SafeArea(
      top: false,
      child: CustomerNavigation(
        thai: widget.thai,
        selectedIndex: 1,
        onSelected: widget.onNavigationSelected,
      ),
    ),
    body: SafeArea(
      child: SingleChildScrollView(
        child: Column(
          children: [
            SizedBox(
              height: 72,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 18),
                child: Row(
                  children: [
                    SizedBox(
                      width: 44,
                      height: 44,
                      child: IconButton.filledTonal(
                        style: IconButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: const Color(0xff64188a),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                            side: const BorderSide(color: Color(0xffe9e1f1)),
                          ),
                        ),
                        tooltip: MaterialLocalizations.of(context)
                            .backButtonTooltip,
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.chevron_left, size: 22),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        _matching == true
                            ? widget.thai
                                  ? 'กำลังหาไรเดอร์ให้คุณ'
                                  : 'Finding your driver'
                            : _matching == false
                            ? widget.thai
                                  ? 'อาหารกำลังเดินทาง'
                                  : 'Food on the way'
                            : widget.thai
                            ? 'สถานะการจัดส่ง'
                            : 'Delivery status',
                        style: TextStyle(
                          fontFamily: widget.thai
                              ? BitPosDesignTokens.fontThai
                              : BitPosDesignTokens.fontLatin,
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            FoodDeliveryPanel(
              api: widget.api,
              orderId: widget.orderId,
              orderTotal: widget.orderTotal,
              thai: widget.thai,
              onAuthenticationRequired: widget.onAuthenticationRequired,
              onViewReceipt: widget.onViewReceipt,
              owner: widget.owner,
              onNavigationSelected: widget.onNavigationSelected,
              onMatchingChanged: (value) {
                if (mounted && _matching != value) {
                  setState(() => _matching = value);
                }
              },
            ),
          ],
        ),
      ),
    ),
  );
}

class FoodDeliveryPanel extends StatefulWidget {
  const FoodDeliveryPanel({
    super.key,
    required this.api,
    required this.orderId,
    this.orderTotal,
    required this.thai,
    required this.onAuthenticationRequired,
    this.onViewReceipt,
    this.owner,
    this.onNavigationSelected,
    this.onMatchingChanged,
  });
  final MobileApi api;
  final String orderId;
  final MobileMoney? orderTotal;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final VoidCallback? onViewReceipt;
  final ValueListenable<bool>? owner;
  final ValueChanged<int>? onNavigationSelected;
  final ValueChanged<bool>? onMatchingChanged;
  @override
  State<FoodDeliveryPanel> createState() => _FoodDeliveryPanelState();
}

class _FoodDeliveryPanelState extends State<FoodDeliveryPanel>
    with WidgetsBindingObserver {
  final _reviewOptionsKey = GlobalKey();
  FoodCustomerWork? _work;
  FoodDispatchMutation? _pending;
  FoodProofIssueReceipt? _receipt;
  Object? _error;
  bool _busy = false, _foreground = true;
  DateTime? _loadedAt;
  StreamSubscription<FoodRealtimeState<FoodCustomerRealtimeSnapshot>>?
  _subscription;
  int _watchEpoch = 0, _snapshotVersion = 0;
  MaterialPageRoute<void>? _chatRoute;
  MaterialPageRoute<void>? _deliveredRoute;
  bool _deliveredOpened = false;
  (String, String, String)? _chatFence;
  void _closeChat() {
    final route = _chatRoute;
    _chatRoute = null;
    _chatFence = null;
    removeOwnedRoute(route);
  }

  Future<void> _openChat(FoodCustomerAssignment a) async {
    if (!_current || _busy || !a.serviceAvailable || _chatRoute != null) return;
    final route = MaterialPageRoute<void>(
      builder: (_) => FoodChatPageView(
        api: widget.api,
        assignmentId: a.id,
        thai: widget.thai,
        rider: false,
        bottomNavigationBar: SafeArea(
          top: false,
          child: CustomerNavigation(
            thai: widget.thai,
            selectedIndex: 0,
            onSelected: (index) => widget.onNavigationSelected?.call(index),
          ),
        ),
      ),
    );
    _chatRoute = route;
    _chatFence = (a.id, a.generation, a.leaseGeneration);
    try {
      await Navigator.of(context).push(route);
    } finally {
      if (identical(_chatRoute, route)) {
        _chatRoute = null;
        _chatFence = null;
      }
    }
  }

  DialogRoute<bool>? _confirmationRoute;
  bool get _current => mounted && _foreground && (widget.owner?.value ?? true);
  String t(String th, String en) => widget.thai ? th : en;
  String _stateLabel(String state) => switch (state) {
    'WAITING_MERCHANT' => t('รอร้านรับออเดอร์', 'Waiting for merchant'),
    'WAITING_PAYMENT' => t('รอการชำระเงิน', 'Waiting for payment'),
    'READY_FOR_DISPATCH' => t('พร้อมส่งต่อให้ไรเดอร์', 'Ready for dispatch'),
    'OFFERING' => t('กำลังเสนองานให้ไรเดอร์', 'Offering to drivers'),
    'ASSIGNED' || 'ACCEPTED' => t('ไรเดอร์รับงานแล้ว', 'Driver accepted'),
    'AT_PICKUP' => t('ไรเดอร์อยู่ที่ร้าน', 'Driver at the merchant'),
    'PICKED_UP' => t('รับอาหารแล้ว', 'Food picked up'),
    'AT_DROPOFF' => t('ไรเดอร์ถึงจุดส่งแล้ว', 'Driver at drop-off'),
    'DELIVERED' => t('ส่งสำเร็จ', 'Delivered'),
    'CANCELLED' => t('ยกเลิกแล้ว', 'Cancelled'),
    'FAILED' => t('จัดส่งไม่สำเร็จ', 'Delivery unsuccessful'),
    'INCIDENT' => t('มีเหตุที่ต้องตรวจสอบ', 'Incident under review'),
    _ => state,
  };
  String _dispatchTitle(FoodCustomerDispatch progress) =>
      switch (progress.phase) {
        'NOT_STARTED' => t('รอระบบจัดส่งยืนยันงาน', 'Awaiting dispatch'),
        'SEARCHING' => t('กำลังค้นหาไรเดอร์', 'Matching a driver'),
        'OFFERED' => t(
          'รอไรเดอร์ตอบรับข้อเสนอ',
          'Waiting for driver acceptance',
        ),
        'ASSIGNED' => t('งานไรเดอร์ที่ได้รับมอบหมาย', 'Assigned delivery'),
        'NEEDS_ATTENTION' => t(
          'ฝ่ายปฏิบัติการต้องช่วยประสานงาน',
          'Dispatch needs staff assistance',
        ),
        'CLOSED' => t(
          'ระบบบันทึกสถานะปิดงานแล้ว',
          'Server recorded a closed delivery',
        ),
        _ => t('สถานะจากเซิร์ฟเวอร์', 'Server-confirmed dispatch'),
      };
  bool _matching(FoodCustomerWork? work) =>
      work != null &&
      work.assignment == null &&
      work.state != 'DELIVERED' &&
      work.state != 'FAILED' &&
      work.dispatch.phase != 'CLOSED';

  Widget _matchingHero(FoodCustomerWork work, ColorScheme colors) {
    final attention = work.dispatch.phase == 'NEEDS_ATTENTION';
    final noCandidate = work.dispatch.attentionReason == 'NO_CANDIDATE';
    return Container(
      key: const ValueKey('food-delivery-matching-hero'),
      padding: const EdgeInsets.fromLTRB(24, 80, 24, 100),
      color: colors.surfaceContainerLowest,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 12),
          Center(
            child: CircleAvatar(
              radius: 58,
              backgroundColor: colors.primaryContainer,
              child: Icon(Icons.pedal_bike, size: 54, color: colors.primary),
            ),
          ),
          const SizedBox(height: 26),
          Text(
            attention
                ? noCandidate
                      ? t('ยังไม่พบไรเดอร์', 'No driver available yet')
                      : t(
                          'การจัดส่งต้องการความช่วยเหลือ',
                          'Delivery needs assistance',
                        )
                : t('กำลังหาไรเดอร์ให้คุณ', 'Finding a driver for you'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: colors.onSurface,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            attention
                ? t(
                    'เจ้าหน้าที่กำลังตรวจสอบขั้นตอนถัดไป ออเดอร์ยังไม่ถูกยกเลิกหรือคืนเงิน',
                    'Staff will review the next step. Your order is not automatically cancelled or refunded.',
                  )
                : t(
                    'ร้านรับออเดอร์แล้ว เรากำลังค้นหาไรเดอร์ให้คุณ',
                    'The store has your order. We are finding a driver for you.',
                  ),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium
                ?.copyWith(color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: 30),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: colors.surface,
              border: Border.all(color: colors.outlineVariant),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: colors.primaryContainer,
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
                    children: [
                      Text(
                        '${t('ออเดอร์', 'Order')} #${widget.orderId.substring(0, 8)}',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 3),
                      Text(
                        attention
                            ? t(
                                'รอเจ้าหน้าที่ประสานงาน',
                                'Awaiting staff assistance',
                              )
                            : t('ระบบกำลังจับคู่', 'Driver search in progress'),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 26),
          FilledButton(
            onPressed: () => Navigator.of(context).maybePop(),
            child: Text(t('ดูสถานะออเดอร์', 'View order status')),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: () {
              final target = _reviewOptionsKey.currentContext;
              if (target != null) {
                Scrollable.ensureVisible(
                  target,
                  duration: const Duration(milliseconds: 250),
                );
              }
            },
            child: Text(t('ตรวจสอบตัวเลือกอื่น', 'Check other options')),
          ),
        ],
      ),
    );
  }

  String _dispatchDetail(
    FoodCustomerDispatch progress,
  ) => switch (progress.attentionReason) {
    'PROVIDER_UNAVAILABLE' => t(
      'ผู้ให้บริการเส้นทางสำหรับจับคู่อัตโนมัติไม่พร้อม รอเจ้าหน้าที่ประสานงาน',
      'Automatic matching route provider unavailable; staff assistance is needed.',
    ),
    'NO_CANDIDATE' => t(
      'ยังไม่พบไรเดอร์ที่เข้าเกณฑ์ ไม่ได้หมายความว่าออเดอร์ถูกยกเลิก',
      'No eligible driver was found. This does not cancel the order.',
    ),
    'DEADLINE' => t(
      'ช่วงค้นหารอบนี้สิ้นสุดแล้ว รอเจ้าหน้าที่ ไม่ได้ยกเลิกหรือคืนเงินอัตโนมัติ',
      'The matching window ended. Await staff; no automatic cancellation or refund.',
    ),
    'BUDGET' => t(
      'ครบจำนวนข้อเสนอในรอบนี้แล้ว รอเจ้าหน้าที่ประสานงาน',
      'This cycle used its offer allowance; await staff assistance.',
    ),
    'POLICY_UNAVAILABLE' => t(
      'นโยบายค้นหาอัตโนมัติไม่พร้อม รอเจ้าหน้าที่ประสานงาน',
      'Automatic matching policy unavailable; await staff assistance.',
    ),
    'MANUAL' => t(
      'เจ้าหน้าที่กำลังดูแลการจัดส่ง การตรวจคำขอไม่ใช่การยกเลิกหรือคืนเงิน',
      'Dispatch is under staff attention. A review is not cancellation or a refund.',
    ),
    _ => switch (progress.phase) {
      'SEARCHING' => t(
        'การค้นหาไม่ใช่การรับงาน ไรเดอร์ต้องตอบรับบนเซิร์ฟเวอร์ก่อน',
        'Searching is not acceptance. A driver must accept on the server.',
      ),
      'OFFERED' => t(
        'ข้อเสนอยังไม่ใช่การรับงานหรือการส่งมอบอาหาร',
        'An offer is not an accepted job or food delivery.',
      ),
      'NEEDS_ATTENTION' => t(
        'รอเจ้าหน้าที่ประสานงาน ขอให้ตรวจคำขอด้านล่างได้ แต่ไม่ใช่การยกเลิกหรือคืนเงินทันที',
        'Await staff assistance. Request a review below; it does not immediately cancel or refund.',
      ),
      'CLOSED' => t(
        'ไม่แชร์ตำแหน่งย้อนหลังของงานที่ปิดแล้ว',
        'Closed-job location history is not exposed.',
      ),
      _ => t(
        'รอข้อมูลที่เซิร์ฟเวอร์ยืนยัน',
        'Awaiting server-confirmed information',
      ),
    },
  };
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.owner?.addListener(_ownerChanged);
    _startWatch();
    unawaited(_run(_load));
  }

  void _stopWatch() {
    _watchEpoch++;
    _snapshotVersion++;
    unawaited(_subscription?.cancel());
    _subscription = null;
  }

  void _startWatch() {
    _stopWatch();
    if (!_current) return;
    final epoch = _watchEpoch;
    _subscription = widget.api.watchFoodDelivery(widget.orderId).listen((
      state,
    ) {
      if (!_current || epoch != _watchEpoch) return;
      _snapshotVersion++;
      final snapshot = state.snapshot;
      if (snapshot == null) {
        _closeConfirmation();
        setState(() {
          _work = null;
          _receipt = null;
          _loadedAt = null;
          _error = state.error;
        });
        if (state.error is MobileApiException &&
            (state.error as MobileApiException).code == 'AUTH_REQUIRED' &&
            !widget.api.signedIn)
          widget.onAuthenticationRequired();
        return;
      }
      _adopt(snapshot.work);
    });
  }

  void _adopt(FoodCustomerWork work) {
    final receipt = _receipt, a = work.assignment;
    if (_chatFence != null &&
        (a == null ||
            !a.serviceAvailable ||
            _chatFence != (a.id, a.generation, a.leaseGeneration)))
      _closeChat();
    if (a == null || !a.serviceAvailable) _closeConfirmation();
    setState(() {
      _work = work;
      _error = null;
      _loadedAt = DateTime.now();
      if (receipt != null &&
          (a == null ||
              !a.serviceAvailable ||
              a.id != receipt.assignmentId ||
              a.generation != receipt.generation ||
              a.leaseGeneration != receipt.leaseGeneration ||
              a.deliveryProof?.id != receipt.proofId))
        _receipt = null;
    });
    if (widget.onMatchingChanged != null) {
      final matching = _matching(work);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_current) widget.onMatchingChanged?.call(matching);
      });
    }
    if (work.state == 'DELIVERED' && !_deliveredOpened) {
      _deliveredOpened = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        unawaited(_openDeliveredReview());
      });
    }
  }

  Future<void> _openDeliveredReview() async {
    if (!_current ||
        _work?.state != 'DELIVERED' ||
        _deliveredRoute != null ||
        widget.orderTotal == null ||
        widget.onViewReceipt == null)
      return;
    final route = MaterialPageRoute<void>(
      builder: (_) => FoodReviewPage(
        api: widget.api,
        orderId: widget.orderId,
        thai: widget.thai,
        owner: widget.owner,
        onAuthenticationRequired: widget.onAuthenticationRequired,
        deliveryCompleteScreen: true,
        orderTotal: widget.orderTotal,
        onViewReceipt: widget.onViewReceipt,
        onNavigationSelected: widget.onNavigationSelected,
      ),
    );
    _deliveredRoute = route;
    try {
      await Navigator.of(context).push(route);
    } finally {
      if (identical(_deliveredRoute, route)) _deliveredRoute = null;
    }
  }

  void _closeConfirmation() {
    _closeChat();
    final route = _confirmationRoute;
    _confirmationRoute = null;
    removeOwnedRoute(route);
  }

  void _ownerChanged() {
    if (!(widget.owner?.value ?? true)) {
      _stopWatch();
      _closeConfirmation();
      if (mounted)
        setState(() {
          _work = null;
          _receipt = null;
          _pending = null;
        });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) {
      _startWatch();
      unawaited(_run(_load));
    } else {
      _stopWatch();
      _closeConfirmation();
      if (mounted)
        setState(() {
          _work = null;
          _receipt = null;
          _loadedAt = null;
        });
    }
  }

  Future<void> _load() async {
    final version = _snapshotVersion;
    try {
      final pending = await widget.api.pendingFoodDispatch(),
          work = await widget.api.foodCustomerWork(widget.orderId);
      if (!_current) return;
      setState(() => _pending = pending);
      if (version == _snapshotVersion) _adopt(work);
    } catch (error) {
      if (!_current) return;
      if (version != _snapshotVersion &&
          !(error is MobileApiException &&
              error.code == 'AUTH_REQUIRED' &&
              !widget.api.signedIn))
        return;
      rethrow;
    }
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
        setState(() {
          _error = error;
          _work = null;
          _receipt = null;
        });
        if (error is MobileApiException &&
            error.code == 'AUTH_REQUIRED' &&
            !widget.api.signedIn)
          widget.onAuthenticationRequired();
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _issue({required bool rotate}) async {
    final assignment = _work?.assignment;
    final saved = _pending;
    // The very same saved proof command (same idempotency key) is safe to resend, so the main button
    // never dead-ends on an unresolved marker that only the secondary retry button could clear.
    if (saved is FoodDeliveryProofMutation &&
        assignment != null &&
        assignment.serviceAvailable &&
        saved.targetId == assignment.id &&
        saved.command.rotate == rotate) {
      await _submit(saved);
      return;
    }
    if (saved != null)
      throw const MobileApiException('PENDING_DISPATCH_RECOVERY_REQUIRED', 409);
    if (assignment == null || !assignment.serviceAvailable)
      throw const MobileApiException('ASSIGNMENT_CHANGED', 409);
    await _submit(widget.api.deliveryProofCommand(assignment, rotate: rotate));
  }

  Future<void> _submit(FoodDeliveryProofMutation command) async {
    setState(() => _pending = command);
    try {
      final result = await widget.api.submitFoodDispatch(command);
      if (!_current) return;
      if (result is! FoodProofIssueReceipt)
        throw const FormatException('Unexpected delivery proof receipt');
      final a = _work?.assignment;
      if (a != null &&
          a.serviceAvailable &&
          a.id == result.assignmentId &&
          a.generation == result.generation &&
          a.leaseGeneration == result.leaseGeneration)
        setState(() => _receipt = result);
    } finally {
      if (_current) {
        final pending = await widget.api.pendingFoodDispatch();
        if (_current) setState(() => _pending = pending);
      }
    }
    await _load();
  }

  Future<void> _replace(FoodCustomerAssignment observed) async {
    if (!_current || _confirmationRoute != null) return;
    final identity = (
      observed.id,
      observed.generation,
      observed.leaseGeneration,
      observed.deliveryProof?.id,
    );
    final route = DialogRoute<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(t('เปลี่ยนรหัสส่งมอบ', 'Replace delivery proof')),
        content: Text(
          t(
            'รหัสเดิมจะใช้ไม่ได้ ออกใหม่เมื่อได้รับอาหารจริงเท่านั้น',
            'The old proof will stop working. Issue only when receiving this order.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(t('ยกเลิก', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(t('เปลี่ยนรหัส', 'Replace')),
          ),
        ],
      ),
    );
    _confirmationRoute = route;
    final confirmed = await Navigator.of(
      context,
      rootNavigator: true,
    ).push(route);
    if (identical(_confirmationRoute, route)) _confirmationRoute = null;
    if (confirmed == true && _current) {
      await _run(() async {
        final a = _work?.assignment;
        if ((a?.id, a?.generation, a?.leaseGeneration, a?.deliveryProof?.id) !=
            identity)
          throw const MobileApiException('ASSIGNMENT_CHANGED', 409);
        await _issue(rotate: true);
      });
    }
  }

  @override
  void dispose() {
    _stopWatch();
    widget.owner?.removeListener(_ownerChanged);
    _closeConfirmation();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!(widget.owner?.value ?? true)) return const SizedBox.shrink();
    final work = _work,
        a = work?.assignment,
        point = a?.serviceAvailable == true ? a?.location : null,
        receipt = _receipt;
    final stale =
        point != null &&
        (point.stale ||
            DateTime.now().toUtc().difference(
                  DateTime.parse(point.capturedAt),
                ) >
                const Duration(seconds: 30));
    final proof = a?.serviceAvailable == true ? a?.deliveryProof : null,
        secretValid =
            a?.serviceAvailable == true &&
            receipt?.secret != null &&
            proof?.id == receipt?.proofId &&
            DateTime.parse(receipt!.expiresAt).isAfter(DateTime.now());
    final colors = Theme.of(context).colorScheme;
    final matching = _matching(work);
    final titleStyle = TextStyle(
      fontFamily: widget.thai
          ? BitPosDesignTokens.fontThai
          : BitPosDesignTokens.fontLatin,
      fontSize: 26,
      fontWeight: FontWeight.w600,
      height: 1.35,
    );
    final actionStyle = FilledButton.styleFrom(
      minimumSize: const Size.fromHeight(52),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (matching)
          _matchingHero(work!, colors)
        else if (a != null && a.serviceAvailable)
          FoodNavigationMap(
            key: ValueKey((a.id, a.generation, a.leaseGeneration, a.state)),
            api: widget.api,
            orderId: widget.orderId,
            assignmentId: a.id,
            generation: a.generation,
            leaseGeneration: a.leaseGeneration,
            revision: a.location?.sequence ?? 'none',
            thai: widget.thai,
            height: 338,
            presentationBuilder:
                (context, viewport, controls, estimate, notices) => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Stack(
                      children: [
                        viewport,
                        Positioned(
                          right: 12,
                          top: 12,
                          child: Material(
                            color: colors.surface,
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                              side: BorderSide(color: colors.outlineVariant),
                            ),
                            clipBehavior: Clip.antiAlias,
                            child: SizedBox(width: 144, child: controls),
                          ),
                        ),
                      ],
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
                      child:
                          estimate ??
                          Text(
                            stale
                                ? t(
                                    'พิกัดเก่า ยังไม่แสดงเวลาเดินทาง',
                                    'Location is stale; route estimate unavailable',
                                  )
                                : t(
                                    'ยังไม่มีเวลาเดินทางที่ยืนยันได้',
                                    'Route estimate unavailable',
                                  ),
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                    ),
                    if (widget.api.fixture)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: Text(
                          t(
                            'ข้อมูลจำลอง ไม่ใช่การส่งจริง',
                            'Synthetic fixture, not a real delivery',
                          ),
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                      ),
                    ExpansionTile(
                      tilePadding: const EdgeInsets.symmetric(horizontal: 24),
                      title: Text(
                        t('ข้อมูลแผนที่และตำแหน่ง', 'Map and location details'),
                      ),
                      childrenPadding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
                      children: [notices],
                    ),
                  ],
                ),
          )
        else
          Container(
            constraints: const BoxConstraints(minHeight: 338),
            decoration: BoxDecoration(
              color: colors.surfaceContainerLow,
              borderRadius: BorderRadius.circular(22),
            ),
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.map_outlined, size: 40, color: colors.primary),
                const SizedBox(height: 16),
                Text(
                  t('แผนที่ยังไม่พร้อมใช้งาน', 'Map unavailable'),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Text(
                  a != null && !a.serviceAvailable
                      ? t(
                          'สิทธิ์ให้บริการงานนี้ไม่พร้อมใช้ ซ่อนตำแหน่งและรหัสส่งมอบ งานยังไม่ถูกยกเลิกหรือส่งมอบอัตโนมัติ',
                          'Service access is restricted. Location and proofs are hidden; the assignment is not automatically cancelled or completed.',
                        )
                      : work == null
                      ? t(
                          'รอข้อมูลงานที่เซิร์ฟเวอร์ยืนยัน ยังติดตามตำแหน่งส่วนตัวไม่ได้',
                          'Awaiting a server-confirmed assignment; private tracking is unavailable.',
                        )
                      : work.dispatch.phase == 'CLOSED'
                      ? t(
                          'ไม่แชร์ตำแหน่งย้อนหลังของงานที่ปิดแล้ว',
                          'Closed-job location history is not exposed.',
                        )
                      : t(
                          'ยังไม่มีงานไรเดอร์ปัจจุบัน การติดตามส่วนตัวเริ่มหลังไรเดอร์ตอบรับเท่านั้น',
                          'No current driver assignment. Private tracking starts only after a driver accepts.',
                        ),
                  textAlign: TextAlign.center,
                ),
                if (widget.api.fixture) ...[
                  const SizedBox(height: 16),
                  Text(
                    t(
                      'AVD / ข้อมูลจำลอง ไม่ใช่พิกัดหรือการส่งจริง',
                      'AVD / synthetic fixture, not real GPS or delivery',
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
        Material(
          color: colors.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          clipBehavior: Clip.antiAlias,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  matching
                      ? t('สถานะการค้นหา', 'Driver search status')
                      : a?.serviceAvailable == true
                      ? t('อาหารกำลังเดินทาง', 'Food on the way')
                      : t('สถานะการจัดส่ง', 'Delivery status'),
                  style: titleStyle,
                ),
                const SizedBox(height: 8),
                Text(
                  work == null
                      ? t(
                          'ยังไม่มีสถานะที่ยืนยันล่าสุด',
                          'No current confirmed snapshot',
                        )
                      : '${t('สถานะขนส่ง', 'Shipment')}: ${_stateLabel(work.state)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (work?.state == 'FAILED') ...[
                  const SizedBox(height: 12),
                  Text(
                    t('การจัดส่งไม่สำเร็จ', 'Delivery unsuccessful'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    t(
                      'งานจัดส่งปิดแล้ว ยังไม่ใช่หลักฐานคืนเงิน กรุณาตรวจสถานะคืนเงินในรายละเอียดออเดอร์ หรือติดต่อฝ่ายช่วยเหลือ',
                      'Delivery is closed. This does not confirm a refund. Check refund status in order details or contact support.',
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Container(
                  constraints: const BoxConstraints(minHeight: 82),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    border: Border.all(color: colors.outlineVariant),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: colors.primaryContainer,
                          borderRadius: BorderRadius.circular(13),
                        ),
                        child: Icon(
                          Icons.delivery_dining,
                          color: colors.primary,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              work == null
                                  ? t(
                                      'รอข้อมูลงานที่เซิร์ฟเวอร์ยืนยัน',
                                      'Awaiting a server-confirmed assignment',
                                    )
                                  : _dispatchTitle(work.dispatch),
                              key: const ValueKey(
                                'food-dispatch-progress-title',
                              ),
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              a == null
                                  ? (work == null
                                        ? t(
                                            'รอข้อมูลที่เซิร์ฟเวอร์ยืนยัน',
                                            'Awaiting server-confirmed information',
                                          )
                                        : _dispatchDetail(work.dispatch))
                                  : '${t('สถานะงาน', 'Job state')}: ${_stateLabel(a.state)}',
                              key: const ValueKey(
                                'food-dispatch-progress-detail',
                              ),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                if (a != null && a.serviceAvailable) ...[
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.tonalIcon(
                          onPressed: _busy ? null : () => _openChat(a),
                          icon: const Icon(Icons.chat_bubble_outline),
                          label: Text(t('แชท', 'Chat with rider')),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () {
                            final target = _reviewOptionsKey.currentContext;
                            if (target != null)
                              Scrollable.ensureVisible(
                                target,
                                duration: const Duration(milliseconds: 250),
                              );
                          },
                          child: Text(t('รายละเอียด', 'Details')),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                ],
                if (work?.dispatch.reassignment
                    case final FoodCustomerReassignment history) ...[
                  const SizedBox(height: 12),
                  Text(
                    '${t('ปล่อยงานก่อนรับอาหารแล้ว', 'Pre-pickup assignments released')}: ${history.count} · ${DateTime.parse(history.lastReleasedAt).toLocal()}',
                    key: const ValueKey('food-dispatch-reassignment'),
                  ),
                  Text(
                    t(
                      'ผู้รับงานแทนต้องตอบรับแยกต่างหาก ไม่ได้ยกเลิกออเดอร์หรือคืนเงิน',
                      'A replacement must accept separately. This does not cancel the order or refund payment.',
                    ),
                  ),
                ],
                if (work?.dispatch.search
                    case final FoodCustomerDispatchSearch search) ...[
                  const SizedBox(height: 12),
                  Text(
                    '${t('ช่วงค้นหาสิ้นสุด ไม่ใช่เวลาถึงโดยประมาณ', 'Matching window ends, not an arrival estimate')}: ${DateTime.parse(search.expiresAt).toLocal()}',
                    key: const ValueKey('food-dispatch-search-window'),
                  ),
                ],
                const SizedBox(height: 24),
                if (a != null && !a.serviceAvailable) ...[
                  Text(
                    t(
                      'งานยังคงอยู่ในความดูแลของระบบ รอฝ่ายปฏิบัติการประสานงาน ห้ามใช้รหัสเดิม',
                      'The assignment remains under custody control pending operations. Do not use an earlier proof.',
                    ),
                    style: TextStyle(color: colors.error),
                  ),
                  const SizedBox(height: 16),
                ],
                if (a?.state == 'AT_DROPOFF' &&
                    a?.serviceAvailable == true) ...[
                  Text(
                    t(
                      'ให้รหัสไรเดอร์เมื่อได้รับอาหารจริงเท่านั้น ไม่ใช่การยืนยันชำระเงิน',
                      'Share this code only after receiving the food. This does not confirm payment.',
                    ),
                    style: TextStyle(
                      color: colors.error,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (proof != null)
                    Text(
                      '${t('รหัสใช้ได้ถึง', 'Proof expires')}: ${DateTime.parse(proof.expiresAt).toLocal()}',
                    ),
                  if (secretValid)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      child: DeliveryCodeCard(
                        secret: receipt.secret!,
                        thai: widget.thai,
                      ),
                    ),
                  if (receipt?.secretRecoveryRequired ?? false)
                    Text(
                      t(
                        'ไม่สามารถอ่านรหัสเดิมซ้ำได้ เลือกเปลี่ยนรหัสเพื่อกู้คืน',
                        'Original secret cannot be recovered. Explicitly replace it if needed.',
                      ),
                    ),
                  const SizedBox(height: 12),
                  if (_pending == null)
                    FilledButton(
                      style: actionStyle,
                      onPressed: _busy
                          ? null
                          : () => proof == null
                                ? _run(() => _issue(rotate: false))
                                : _replace(a!),
                      child: Text(
                        proof == null
                            ? t('ออกรหัสส่งมอบ', 'Issue delivery proof')
                            : t('เปลี่ยนรหัสส่งมอบ', 'Replace delivery proof'),
                      ),
                    ),
                  const SizedBox(height: 12),
                ],
                if (_pending case final FoodDeliveryProofMutation saved) ...[
                  Text(
                    t(
                      'คำขอเดิมยังไม่ทราบผล ลองคำขอที่บันทึกไว้เดิมเท่านั้น',
                      'The original command is unresolved. Retry the exact saved command only.',
                    ),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                    ),
                    onPressed: _busy ? null : () => _run(() => _submit(saved)),
                    child: Text(
                      '${t('ลองคำขอรหัสเดิมอีกครั้งสำหรับงาน', 'Retry original proof command for job')} ${saved.targetId}',
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                if (_pending != null && _pending is! FoodDeliveryProofMutation)
                  Text(
                    t(
                      'มีคำขอไรเดอร์เดิมที่ยังไม่ทราบผล ต้องแก้ที่หน้าคนขับก่อน',
                      'An unresolved driver command must be recovered in the driver app first',
                    ),
                  ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      _error.toString(),
                      style: TextStyle(color: colors.error),
                    ),
                  ),
                FilledButton.tonal(
                  style: actionStyle,
                  onPressed: _busy ? null : () => _run(_load),
                  child: Text(
                    _busy
                        ? t('กำลังอัปเดต…', 'Updating…')
                        : t('อัปเดตการจัดส่ง', 'Refresh delivery snapshot'),
                  ),
                ),
                const SizedBox(height: 12),
                if (work != null)
                  FoodCancellationReviewPanel(
                    key: _reviewOptionsKey,
                    api: widget.api,
                    orderId: widget.orderId,
                    shipmentId: work.shipmentId,
                    thai: widget.thai,
                    owner: widget.owner,
                    onAuthenticationRequired: widget.onAuthenticationRequired,
                  ),
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  childrenPadding: const EdgeInsets.only(bottom: 16),
                  title: Text(
                    t('รายละเอียดตำแหน่งส่วนตัว', 'Private location details'),
                  ),
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text('${t('ออเดอร์', 'Order')}: ${widget.orderId}'),
                        if (_loadedAt != null)
                          Text(
                            '${t('โหลดสถานะล่าสุด', 'Snapshot loaded')}: ${_loadedAt!.toLocal()}',
                          ),
                        if (a != null)
                          Text(
                            '${t('งานไรเดอร์', 'Assigned job')}: ${a.id} · ${a.generation}/${a.leaseGeneration}',
                          ),
                        if (a != null && point == null)
                          Text(
                            a.serviceAvailable
                                ? t(
                                    'ยังไม่มีพิกัดที่เซิร์ฟเวอร์รับ',
                                    'No acknowledged driver location yet',
                                  )
                                : t(
                                    'ซ่อนตำแหน่งระหว่างระงับสิทธิ์บริการ',
                                    'Location hidden while service is restricted',
                                  ),
                          ),
                        if (point != null) ...[
                          SelectableText(
                            '${point.latitudeE7 / 10000000}, ${point.longitudeE7 / 10000000} · ±${point.accuracyMm / 1000}m',
                          ),
                          Text(
                            '${t('บันทึกพิกัด / เซิร์ฟเวอร์รับ', 'Captured / server received')}: ${DateTime.parse(point.capturedAt).toLocal()} / ${DateTime.parse(point.receivedAt).toLocal()}',
                          ),
                          Text(
                            stale
                                ? t(
                                    'พิกัดเก่า ห้ามถือว่าเป็นตำแหน่งปัจจุบัน',
                                    'Stale location; not the driver’s current position',
                                  )
                                : t(
                                    'พิกัดล่าสุดที่ได้รับ ไม่ใช่ ETA หรือเส้นทาง',
                                    'Latest acknowledged fix; not route or ETA',
                                  ),
                          ),
                        ],
                        if (a == null && work?.dispatch.phase == 'CLOSED')
                          Text(
                            t(
                              'ไม่แชร์ประวัติพิกัดของงานที่ปิด',
                              'Closed-job location history is not exposed.',
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Shows the one-time handover secret large and in groups of four so it can be read aloud or typed by the
/// rider; the copy button puts the exact original value on the clipboard (spaces are display-only).
class DeliveryCodeCard extends StatelessWidget {
  const DeliveryCodeCard({required this.secret, required this.thai});
  final String secret;
  final bool thai;
  static String grouped(String value) {
    final out = <String>[];
    for (var i = 0; i < value.length; i += 4)
      out.add(value.substring(i, i + 4 > value.length ? value.length : i + 4));
    return out.join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    String t(String th, String en) => thai ? th : en;
    return Container(
      key: const ValueKey('delivery-code-card'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.primaryContainer,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            t('รหัสส่งมอบอาหาร', 'Delivery code'),
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: 8),
          SelectableText(
            grouped(secret),
            key: const ValueKey('delivery-code-text'),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'monospace',
              // A slashed zero keeps 0 and O apart; the code is case- and shape-sensitive.
              fontFeatures: const [FontFeature.slashedZero()],
              letterSpacing: 1,
              fontSize: 24,
              height: 1.5,
              fontWeight: FontWeight.w700,
              color: colors.onPrimaryContainer,
            ),
            semanticsLabel: t('รหัสส่งมอบอาหาร', 'Delivery proof secret'),
          ),
          const SizedBox(height: 4),
          Text(
            t(
              'ช่องว่างใช้แบ่งอ่านเท่านั้น ไม่ต้องพิมพ์ ตัวพิมพ์เล็ก/ใหญ่มีความหมาย',
              'Spaces are only for reading; do not type them. Upper and lower case matter.',
            ),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            key: const ValueKey('delivery-code-copy'),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: secret));
              if (context.mounted)
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(t('คัดลอกรหัสแล้ว', 'Code copied'))),
                );
            },
            icon: const Icon(Icons.copy),
            label: Text(t('คัดลอกรหัส', 'Copy code')),
          ),
        ],
      ),
    );
  }
}
