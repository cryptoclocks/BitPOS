import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'presentation/food_presentation.dart' show resolveMediaUrl;

/// "Regulars" membership: a lifetime-point tier per shop and, when the customer opts in and proves a wallet, a
/// non-transferable devnet badge. All facts (tier, points, badge state) come from the server; this widget only
/// presents them, with motion that respects the system "reduce motion" setting. The badge has no monetary value.
class LoyaltySection extends StatefulWidget {
  const LoyaltySection({
    super.key,
    required this.api,
    required this.thai,
    required this.onAuthenticationRequired,
    this.pollInterval = const Duration(seconds: 4),
  });
  final MobileApi api;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final Duration pollInterval;
  @override
  State<LoyaltySection> createState() => _LoyaltySectionState();
}

class _LoyaltySectionState extends State<LoyaltySection> {
  List<MobileLoyaltyShop>? shops;
  final _busy = <String>{};
  String? error;
  String t(String th, String en) => widget.thai ? th : en;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final next = await widget.api.loyalty();
      if (mounted) setState(() { shops = next.shops; error = null; });
    } catch (e) {
      if (!mounted) return;
      // The page's own points/voucher loads own sign-out handling, so a passive load stays quiet about auth.
      // Fail soft: points and vouchers below must never be hidden by a membership outage.
      final auth = e is MobileApiException && e.code == 'AUTH_REQUIRED';
      setState(() => error = auth || isConnectivityError(e) ? null : t('โหลดสถานะสมาชิกไม่สำเร็จ', 'Could not load membership'));
    }
  }

  Future<void> _consent(MobileLoyaltyShop shop, bool granted) async {
    if (_busy.contains(shop.merchantId)) return;
    setState(() => _busy.add(shop.merchantId));
    try {
      await widget.api.setLoyaltyConsent(MobileLoyaltyConsentRequest(merchantId: shop.merchantId, granted: granted));
      await _load();
    } catch (e) {
      if (mounted && e is MobileApiException && e.code == 'AUTH_REQUIRED') widget.onAuthenticationRequired();
      if (mounted) setState(() => error = t('บันทึกความยินยอมไม่สำเร็จ ลองอีกครั้ง', 'Could not save your choice. Try again.'));
    } finally {
      if (mounted) setState(() => _busy.remove(shop.merchantId));
    }
  }

  Future<void> _connect() async {
    final connected = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => _BindSheet(api: widget.api, thai: widget.thai, pollInterval: widget.pollInterval),
    );
    if (connected == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final list = shops;
    if (list == null || list.isEmpty) {
      if (error == null) return const SizedBox.shrink();
      return Semantics(liveRegion: true, child: Text(error!, key: const ValueKey('loyalty-error')));
    }
    return Column(
      key: const ValueKey('loyalty-section'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 8),
        Text('Regulars', style: Theme.of(context).textTheme.titleLarge),
        Text(
          t('ระดับสมาชิกของร้านที่คุณสั่งประจำ', 'Your membership level at shops you order from'),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (error != null) Semantics(liveRegion: true, child: Text(error!, key: const ValueKey('loyalty-error'))),
        for (var i = 0; i < list.length; i++)
          _Reveal(
            key: ValueKey('loyalty-reveal-${list[i].merchantId}'),
            delay: Duration(milliseconds: 90 * i),
            child: _ShopCard(
              shop: list[i],
              thai: widget.thai,
              busy: _busy.contains(list[i].merchantId),
              onConsent: (granted) => _consent(list[i], granted),
              onConnect: _connect,
            ),
          ),
        const SizedBox(height: 12),
        Row(
          children: [
            const Icon(Icons.lock_outline, size: 14, color: Color(0xff7b7088)),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                t('ตราโอนให้คนอื่นไม่ได้ ไม่มีมูลค่าเงิน และอยู่บนเครือข่ายทดสอบ Solana devnet', 'Badges cannot be transferred, have no monetary value and live on Solana devnet (test network)'),
                key: const ValueKey('loyalty-footnote'),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xff7b7088)),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

/// Staggered entrance: fade + rise. Instant when the system asks to reduce motion.
class _Reveal extends StatelessWidget {
  const _Reveal({super.key, required this.child, required this.delay});
  final Widget child;
  final Duration delay;
  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 520) + delay,
      curve: Interval(delay.inMilliseconds / (520 + delay.inMilliseconds), 1, curve: Curves.easeOutCubic),
      builder: (context, v, c) => Opacity(opacity: v, child: Transform.translate(offset: Offset(0, 18 * (1 - v)), child: c)),
      child: child,
    );
  }
}

class _ShopCard extends StatelessWidget {
  const _ShopCard({required this.shop, required this.thai, required this.busy, required this.onConsent, required this.onConnect});
  final MobileLoyaltyShop shop;
  final bool thai;
  final bool busy;
  final ValueChanged<bool> onConsent;
  final VoidCallback onConnect;
  String t(String th, String en) => thai ? th : en;
  String tierName(MobileLoyaltyTier x) => thai ? x.nameTh : x.nameEn;

  @override
  Widget build(BuildContext context) {
    final cur = shop.current, next = shop.next;
    final span = next == null ? 1 : (next.minPoints - (cur?.minPoints ?? 0));
    final done = next == null ? 1.0 : ((shop.lifetimePoints - (cur?.minPoints ?? 0)) / span).clamp(0.0, 1.0);
    final reduce = MediaQuery.disableAnimationsOf(context);
    return Container(
      key: ValueKey('loyalty-${shop.merchantId}'),
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xff64188a), Color(0xff3c0f5a)]),
        boxShadow: const [BoxShadow(color: Color(0x3364188a), blurRadius: 24, offset: Offset(0, 12))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text(shop.merchantName, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600))),
              AnimatedSwitcher(
                duration: reduce ? Duration.zero : const Duration(milliseconds: 420),
                transitionBuilder: (c, a) => ScaleTransition(scale: CurvedAnimation(parent: a, curve: Curves.easeOutBack), child: FadeTransition(opacity: a, child: c)),
                child: Container(
                  key: ValueKey('loyalty-tier-${cur?.slot ?? 0}'),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: cur == null ? const Color(0x33ffffff) : const Color(0xffffd36b), borderRadius: BorderRadius.circular(999)),
                  child: Text(
                    cur == null ? t('ยังไม่มีระดับ', 'No level yet') : tierName(cur),
                    style: TextStyle(color: cur == null ? Colors.white : const Color(0xff3c0f5a), fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              _Ring(key: ValueKey('loyalty-ring-${shop.merchantId}'), fraction: done, points: shop.lifetimePoints, label: t('แต้มสะสม', 'lifetime pts'), reduce: reduce),
              const SizedBox(width: 20),
              Expanded(
                child: Text(
                  next == null
                      ? (cur == null ? t('ร้านนี้ยังไม่เปิดระดับ', 'No levels open yet') : t('ถึงระดับสูงสุดแล้ว', 'You are at the top level'))
                      : t('อีก ${shop.pointsToNext} แต้มถึงระดับ ${tierName(next)}', '${shop.pointsToNext} more points to ${tierName(next)}'),
                  key: ValueKey('loyalty-next-${shop.merchantId}'),
                  style: const TextStyle(color: Colors.white, fontSize: 15, height: 1.35),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _BadgeRow(shop: shop, thai: thai, reduce: reduce),
          const Divider(color: Color(0x33ffffff), height: 28),
          _ConsentRow(shop: shop, thai: thai, busy: busy, onConsent: onConsent, onConnect: onConnect),
        ],
      ),
    );
  }
}

class _Ring extends StatelessWidget {
  const _Ring({super.key, required this.fraction, required this.points, required this.label, required this.reduce});
  final double fraction;
  final int points;
  final String label;
  final bool reduce;
  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: fraction),
      duration: reduce ? Duration.zero : const Duration(milliseconds: 1100),
      curve: Curves.easeOutCubic,
      builder: (context, v, _) => SizedBox(
        width: 112,
        height: 112,
        child: CustomPaint(
          painter: _RingPainter(v),
          child: Center(
            child: TweenAnimationBuilder<int>(
              tween: IntTween(begin: 0, end: points),
              duration: reduce ? Duration.zero : const Duration(milliseconds: 1100),
              curve: Curves.easeOutCubic,
              builder: (context, n, _) => Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('$n', key: const ValueKey('loyalty-points'), style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800)),
                  Text(label, style: const TextStyle(color: Color(0xccffffff), fontSize: 11)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.fraction);
  final double fraction;
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final track = Paint()..style = PaintingStyle.stroke..strokeWidth = 9..strokeCap = StrokeCap.round..color = const Color(0x33ffffff);
    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 9
      ..strokeCap = StrokeCap.round
      ..shader = const SweepGradient(startAngle: -math.pi / 2, endAngle: 3 * math.pi / 2, colors: [Color(0xffffd36b), Color(0xffff9bd2), Color(0xffffd36b)]).createShader(rect);
    final inner = rect.deflate(8);
    canvas.drawArc(inner, 0, math.pi * 2, false, track);
    canvas.drawArc(inner, -math.pi / 2, math.pi * 2 * fraction, false, arc);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.fraction != fraction;
}

class _BadgeRow extends StatefulWidget {
  const _BadgeRow({required this.shop, required this.thai, required this.reduce});
  final MobileLoyaltyShop shop;
  final bool thai;
  final bool reduce;
  @override
  State<_BadgeRow> createState() => _BadgeRowState();
}

class _BadgeRowState extends State<_BadgeRow> with TickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));
  late final AnimationController _tilt = AnimationController(vsync: this, duration: const Duration(milliseconds: 4200));
  String t(String th, String en) => widget.thai ? th : en;

  bool get _issuing => widget.shop.badge?.status == 'PENDING' || widget.shop.badge?.status == 'SENT';

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(covariant _BadgeRow old) {
    super.didUpdateWidget(old);
    _sync();
  }

  void _sync() {
    if (widget.shop.badge?.status == 'CONFIRMED' && !widget.reduce) {
      if (!_tilt.isAnimating) _tilt.repeat(reverse: true);
    } else {
      _tilt.stop();
      _tilt.value = 0.5;
    }
    if (_issuing && !widget.reduce) {
      if (!_pulse.isAnimating) _pulse.repeat(reverse: true);
    } else {
      _pulse.stop();
      _pulse.value = 0;
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    _tilt.dispose();
    super.dispose();
  }

  void _showCard(int slot) {
    showDialog<void>(
      context: context,
      builder: (_) => Dialog(
        key: const ValueKey('loyalty-card-dialog'),
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.all(28),
        child: GestureDetector(
          onTap: () => Navigator.of(context).pop(),
          child: Hero(tag: 'loyalty-card-${widget.shop.merchantId}', child: ClipRRect(borderRadius: BorderRadius.circular(22), child: _cardImage(slot, fit: BoxFit.contain))),
        ),
      ),
    );
  }

  Widget _cardImage(int slot, {BoxFit fit = BoxFit.cover}) => Image.network(
        resolveMediaUrl('/loyalty/card-$slot.png'),
        fit: fit,
        errorBuilder: (_, _, _) => Container(
          decoration: const BoxDecoration(gradient: LinearGradient(colors: [Color(0xffffe9a8), Color(0xffffb347)])),
          child: const Icon(Icons.workspace_premium, color: Color(0xff3c0f5a), size: 26),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final badge = widget.shop.badge;
    final held = badge?.status == 'CONFIRMED';
    final slot = badge?.tierSlot ?? 1;
    final String label;
    if (badge == null) {
      label = widget.shop.consentGranted && widget.shop.walletBound
          ? t('ตราจะถูกส่งเมื่อถึงระดับ', 'Your badge is sent when you reach a level')
          : t('ยังไม่มีตรา', 'No badge yet');
    } else {
      label = switch (badge.status) {
        'CONFIRMED' => t('ถือตราอยู่ในกระเป๋า (devnet)', 'Held in your wallet (devnet)'),
        'PENDING' || 'SENT' => t('กำลังส่งตรา…', 'Sending your badge…'),
        'REVOKING' || 'REVOKED' => t('ตราถูกเรียกคืนแล้ว', 'Badge returned'),
        _ => t('ส่งตราไม่สำเร็จ ระบบจะลองใหม่', 'Could not send. We will retry.'),
      };
    }
    return Row(
      key: ValueKey('loyalty-badge-${widget.shop.merchantId}'),
      children: [
        AnimatedBuilder(
          animation: _pulse,
          builder: (context, child) => Transform.scale(scale: 1 + 0.06 * _pulse.value, child: child),
          child: TweenAnimationBuilder<double>(
            key: ValueKey('badge-medal-${badge?.status}'),
            tween: Tween(begin: held && !widget.reduce ? 0.0 : 1.0, end: 1),
            duration: const Duration(milliseconds: 700),
            curve: Curves.elasticOut,
            builder: (context, v, child) => Transform.scale(scale: v.clamp(0.0, 1.4), child: child),
            child: held
                ? GestureDetector(
                    key: ValueKey('loyalty-card-${widget.shop.merchantId}'),
                    onTap: () => _showCard(slot),
                    child: AnimatedBuilder(
                      animation: _tilt,
                      builder: (context, child) => Transform(
                        alignment: Alignment.center,
                        transform: Matrix4.identity()
                          ..setEntry(3, 2, 0.0012)
                          ..rotateY((_tilt.value - 0.5) * 0.5),
                        child: child,
                      ),
                      child: Hero(
                        tag: 'loyalty-card-${widget.shop.merchantId}',
                        child: Container(
                          width: 52,
                          height: 73,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xffffffff), width: 1.5),
                            boxShadow: const [BoxShadow(color: Color(0x66000000), blurRadius: 10, offset: Offset(0, 5))],
                          ),
                          child: ClipRRect(borderRadius: BorderRadius.circular(6.5), child: _cardImage(slot)),
                        ),
                      ),
                    ),
                  )
                : Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: const Color(0x22ffffff), border: Border.all(color: const Color(0x55ffffff), width: 2)),
                    child: const Icon(Icons.lock_outline, color: Colors.white70, size: 24),
                  ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, key: ValueKey('loyalty-badge-label-${widget.shop.merchantId}'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ],
    );
  }
}

class _ConsentRow extends StatefulWidget {
  const _ConsentRow({required this.shop, required this.thai, required this.busy, required this.onConsent, required this.onConnect});
  final MobileLoyaltyShop shop;
  final bool thai;
  final bool busy;
  final ValueChanged<bool> onConsent;
  final VoidCallback onConnect;
  @override
  State<_ConsentRow> createState() => _ConsentRowState();
}

class _ConsentRowState extends State<_ConsentRow> {
  bool open = false;
  String t(String th, String en) => widget.thai ? th : en;
  static String shortWallet(String w) => w.length <= 10 ? w : '${w.substring(0, 4)}…${w.substring(w.length - 4)}';

  @override
  Widget build(BuildContext context) {
    final shop = widget.shop;
    final reduce = MediaQuery.disableAnimationsOf(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                t('ส่งตราไปที่กระเป๋าของฉัน', 'Send the badge to my wallet'),
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
              ),
            ),
            Switch(
              key: ValueKey('loyalty-consent-${shop.merchantId}'),
              value: shop.consentGranted,
              onChanged: widget.busy ? null : widget.onConsent,
              thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? const Color(0xff3c0f5a) : Colors.white),
              trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? const Color(0xffffd36b) : const Color(0x44ffffff)),
              trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
            ),
          ],
        ),
        InkWell(
          key: ValueKey('loyalty-details-${shop.merchantId}'),
          borderRadius: BorderRadius.circular(8),
          onTap: () => setState(() => open = !open),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Text(t('ข้อมูลที่ควรรู้', 'What to know'), style: const TextStyle(color: Color(0xccffffff), fontSize: 13, decoration: TextDecoration.underline, decorationColor: Color(0x66ffffff))),
                const SizedBox(width: 4),
                AnimatedRotation(turns: open ? 0.5 : 0, duration: reduce ? Duration.zero : const Duration(milliseconds: 240), child: const Icon(Icons.expand_more, size: 18, color: Color(0xccffffff))),
              ],
            ),
          ),
        ),
        AnimatedSize(
          duration: reduce ? Duration.zero : const Duration(milliseconds: 260),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: open
              ? Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    t(
                      'ข้อมูลบนบล็อกเชนเป็นสาธารณะ: ใครก็เห็นได้ว่ากระเป๋านี้ถือตราของร้านนี้ ไม่ใส่ข้อมูลการสั่งซื้อ ปิดได้ทุกเมื่อ และร้านเรียกตราคืนได้หากมีการคืนเงิน',
                      'Blockchain data is public: anyone can see that this wallet holds this shop\'s badge. No order details are included. You can turn it off any time, and the shop can take the badge back after a refund.',
                    ),
                    key: ValueKey('loyalty-details-text-${shop.merchantId}'),
                    style: const TextStyle(color: Color(0xb3ffffff), fontSize: 12.5, height: 1.4),
                  ),
                )
              : const SizedBox(width: double.infinity),
        ),
        if (shop.consentGranted) ...[
          const SizedBox(height: 4),
          if (shop.walletBound)
            Row(
              children: [
                const Icon(Icons.check_circle, color: Color(0xffa5f3b4), size: 18),
                const SizedBox(width: 8),
                Text('${t('กระเป๋าที่ยืนยันแล้ว', 'Verified wallet')}: ${shortWallet(shop.walletAddress ?? '')}', key: ValueKey('loyalty-wallet-${shop.merchantId}'), style: const TextStyle(color: Colors.white)),
              ],
            )
          else
            SizedBox(
              height: 48,
              child: FilledButton.icon(
                key: ValueKey('loyalty-connect-${shop.merchantId}'),
                onPressed: widget.onConnect,
                style: FilledButton.styleFrom(backgroundColor: const Color(0xffffd36b), foregroundColor: const Color(0xff3c0f5a), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
                icon: const Icon(Icons.account_balance_wallet_outlined, size: 20),
                label: Text(t('ยืนยันกระเป๋า', 'Verify my wallet'), style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
        ],
      ],
    );
  }
}

/// Shows the one-time code and polls until the wallet is proven on the web page. The code is the only credential in play; the wallet signature is what proves ownership.
class _BindSheet extends StatefulWidget {
  const _BindSheet({required this.api, required this.thai, required this.pollInterval});
  final MobileApi api;
  final bool thai;
  final Duration pollInterval;
  @override
  State<_BindSheet> createState() => _BindSheetState();
}

class _BindSheetState extends State<_BindSheet> {
  MobileLoyaltyBindCode? code;
  String? failure;
  bool done = false;
  Timer? _poll;
  String t(String th, String en) => widget.thai ? th : en;

  @override
  void initState() {
    super.initState();
    unawaited(_issue());
  }

  Future<void> _issue() async {
    try {
      final next = await widget.api.loyaltyBindCode();
      if (!mounted) return;
      setState(() { code = next; failure = null; });
      _poll?.cancel();
      _poll = Timer.periodic(widget.pollInterval, (_) => unawaited(_check()));
    } catch (_) {
      if (mounted) setState(() => failure = t('สร้างรหัสไม่สำเร็จ ลองอีกครั้ง', 'Could not create a code. Try again.'));
    }
  }

  Future<void> _check() async {
    try {
      final overview = await widget.api.loyalty();
      if (mounted && overview.shops.any((s) => s.walletBound) && !done) {
        _poll?.cancel();
        setState(() => done = true);
        await Future<void>.delayed(MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 1200));
        if (mounted) Navigator.of(context).pop(true);
      }
    } catch (_) {/* keep polling; the code stays valid for 10 minutes */}
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
      child: AnimatedSwitcher(
        duration: reduce ? Duration.zero : const Duration(milliseconds: 380),
        child: done
            ? Column(
                key: const ValueKey('bind-done'),
                mainAxisSize: MainAxisSize.min,
                children: [
                  TweenAnimationBuilder<double>(
                    tween: Tween(begin: reduce ? 1 : 0, end: 1),
                    duration: const Duration(milliseconds: 700),
                    curve: Curves.elasticOut,
                    builder: (c, v, child) => Transform.scale(scale: v, child: child),
                    child: const Icon(Icons.verified, size: 72, color: Color(0xff2e9e55)),
                  ),
                  const SizedBox(height: 12),
                  Text(t('ยืนยันกระเป๋าแล้ว', 'Wallet verified'), style: Theme.of(context).textTheme.titleLarge),
                ],
              )
            : Column(
                key: const ValueKey('bind-code'),
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(t('ยืนยันกระเป๋าของคุณ', 'Verify your wallet'), style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  for (final (i, step) in [
                    t('เปิดลิงก์ด้านล่างในเบราว์เซอร์ของ Phantom', 'Open the link below in the Phantom browser'),
                    t('ใส่รหัสที่เห็นด้านล่าง', 'Enter the code shown below'),
                    t('เซ็นข้อความ (ไม่ใช่การจ่ายเงิน และไม่เสียค่าธรรมเนียม)', 'Sign the message (it is not a payment and costs no fee)'),
                  ].indexed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 22,
                            height: 22,
                            alignment: Alignment.center,
                            decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xff64188a)),
                            child: Text('${i + 1}', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
                          ),
                          const SizedBox(width: 10),
                          Expanded(child: Text(step, key: ValueKey('bind-step-${i + 1}'))),
                        ],
                      ),
                    ),
                  const SizedBox(height: 16),
                  if (failure != null) ...[
                    Semantics(liveRegion: true, child: Text(failure!, key: const ValueKey('bind-error'))),
                    OutlinedButton(onPressed: _issue, child: Text(t('ลองอีกครั้ง', 'Try again'))),
                  ] else if (code == null)
                    const Center(child: CircularProgressIndicator())
                  else ...[
                    Center(child: SelectableText(code!.code, key: const ValueKey('bind-code-text'), style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: 4))),
                    const SizedBox(height: 8),
                    SelectableText(code!.bindUrl, key: const ValueKey('bind-url'), style: Theme.of(context).textTheme.bodySmall),
                    Row(
                      children: [
                        TextButton.icon(
                          key: const ValueKey('bind-copy-code'),
                          onPressed: () => Clipboard.setData(ClipboardData(text: code!.code)),
                          icon: const Icon(Icons.copy, size: 16),
                          label: Text(t('คัดลอกรหัส', 'Copy code')),
                        ),
                        TextButton.icon(
                          key: const ValueKey('bind-copy-url'),
                          onPressed: () => Clipboard.setData(ClipboardData(text: code!.bindUrl)),
                          icon: const Icon(Icons.link, size: 16),
                          label: Text(t('คัดลอกลิงก์', 'Copy link')),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(children: [
                      const SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                      const SizedBox(width: 10),
                      Expanded(child: Text(t('รอการเซ็นจากกระเป๋า… รหัสใช้ได้ 10 นาที', 'Waiting for the wallet to sign… the code works for 10 minutes'), style: Theme.of(context).textTheme.bodySmall)),
                    ]),
                  ],
                ],
              ),
      ),
    );
  }
}
