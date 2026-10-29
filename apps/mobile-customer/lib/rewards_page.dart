import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/owned_route.dart';

/// Derived loyalty points and demo-grade reward vouchers. The server recomputes points from
/// paid online orders on every read (one point per whole currency unit, refunded orders
/// excluded, minus redemptions). A shop may offer 1-3 rewards; redeeming one debits points and
/// issues a single-use voucher in one server transaction. The voucher is priced only through
/// the normal cart coupon entry. Unused expired vouchers are not refunded.
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
  List<MobileRewardOffer>? offers;
  List<MobileVoucher>? vouchers;
  bool loading = true;
  String? error;
  String? rewardsError, redeemError, redeemed;
  final _redeeming = <String>{};
  final _keys = <String, String>{};
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
    unawaited(_loadRewards());
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

  /// Offers and vouchers are independent of the points figure: a failure here never hides the points.
  Future<void> _loadRewards() async {
    try {
      final catalog = await widget.api.rewardCatalog();
      final list = await widget.api.vouchers();
      if (_current) {
        setState(() {
          offers = catalog.rewards;
          vouchers = list.vouchers;
          rewardsError = null;
        });
      }
    } catch (e) {
      if (!_current) return;
      if (e is MobileApiException && e.code == 'AUTH_REQUIRED') {
        widget.onAuthenticationRequired();
        return;
      }
      setState(
        () => rewardsError = t(
          'โหลดรางวัลไม่สำเร็จ ลองอีกครั้ง',
          'Could not load rewards. Try again.',
        ),
      );
    }
  }

  String _name(String th, String en) => widget.thai ? th : en;

  static String minorText(String minor, int decimals, String currency) {
    final padded = minor.padLeft(decimals + 1, '0');
    final whole = padded.substring(0, padded.length - decimals);
    final fraction = decimals == 0 ? '' : padded.substring(padded.length - decimals);
    return '$currency ${decimals == 0 ? whole : '$whole.$fraction'}';
  }

  Future<void> _redeem(MobileRewardOffer offer) async {
    if (_redeeming.contains(offer.id)) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('redeem-dialog'),
        title: Text(t('แลกรางวัลนี้?', 'Redeem this reward?')),
        content: Text(
          t(
            'ใช้ ${offer.pointsCost} แต้มเพื่อรับคูปอง "${offer.nameTh}" ของ ${offer.merchantName} (ลด ${minorText(offer.discountMinor, offer.decimals, offer.currency)} เมื่อสั่งอาหารขั้นต่ำ ${minorText(offer.minimumSpendMinor, offer.decimals, offer.currency)}) ใช้ได้ภายใน ${offer.validityDays} วัน ใช้ครั้งเดียว คูปองที่หมดอายุโดยไม่ได้ใช้จะไม่คืนแต้ม',
            'Spend ${offer.pointsCost} points on "${offer.nameEn}" from ${offer.merchantName} (${minorText(offer.discountMinor, offer.decimals, offer.currency)} off when you order at least ${minorText(offer.minimumSpendMinor, offer.decimals, offer.currency)} of food). Valid for ${offer.validityDays} days, single use. A voucher that expires unused is not refunded.',
          ),
        ),
        actions: [
          TextButton(
            key: const ValueKey('redeem-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(t('ยกเลิก', 'Cancel')),
          ),
          FilledButton(
            key: const ValueKey('redeem-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(t('แลก', 'Redeem')),
          ),
        ],
      ),
    );
    if (confirmed != true || !_current) return;
    // One key per reward until it settles, so a retry after a lost response replays the same voucher.
    final key = _keys.putIfAbsent(offer.id, widget.api.newCommandKey);
    setState(() {
      _redeeming.add(offer.id);
      redeemError = null;
      redeemed = null;
    });
    try {
      await widget.api.redeemReward(
        MobileRewardRedeemRequest(rewardId: offer.id, idempotencyKey: key),
      );
      _keys.remove(offer.id);
      if (!_current) return;
      setState(() => redeemed = offer.id);
      await _load();
    } catch (e) {
      if (!_current) return;
      if (e is MobileApiException && e.code == 'AUTH_REQUIRED') {
        widget.onAuthenticationRequired();
        return;
      }
      final definite = e is MobileApiException && e.status >= 400 && e.status < 500;
      if (definite) _keys.remove(offer.id);
      setState(() {
        redeemError = switch (e is MobileApiException ? e.code : '') {
          'REWARD_INSUFFICIENT_POINTS' => t('แต้มไม่พอสำหรับรางวัลนี้', 'You do not have enough points for this reward.'),
          'REWARD_UNAVAILABLE' => t('ร้านปิดรางวัลนี้แล้ว', 'The shop has turned this reward off.'),
          'RESOURCE_NOT_FOUND' => t('ไม่พบรางวัลนี้', 'This reward is no longer available.'),
          _ => t('แลกไม่สำเร็จ ลองอีกครั้ง ระบบจะไม่หักแต้มซ้ำ', 'Could not redeem. Try again; you will not be charged points twice.'),
        };
      });
      if (definite) unawaited(_loadRewards());
    } finally {
      if (_current) setState(() => _redeeming.remove(offer.id));
    }
  }

  String _stateLabel(String state) => switch (state) {
    'AVAILABLE' => t('พร้อมใช้', 'Ready to use'),
    'IN_USE' => t('กำลังใช้อยู่ในออเดอร์', 'In use on an order'),
    'USED' => t('ใช้แล้ว', 'Used'),
    _ => t('หมดอายุ', 'Expired'),
  };

  Widget _offerCard(MobileRewardOffer o) {
    final busy = _redeeming.contains(o.id);
    final missing = o.pointsCost - o.balance;
    return Card(
      key: ValueKey('reward-offer-${o.id}'),
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_name(o.nameTh, o.nameEn), style: Theme.of(context).textTheme.titleMedium),
            Text(o.merchantName),
            const SizedBox(height: 6),
            Text(
              t(
                'ลด ${minorText(o.discountMinor, o.decimals, o.currency)} เมื่อสั่งอาหารขั้นต่ำ ${minorText(o.minimumSpendMinor, o.decimals, o.currency)} · ใช้ ${o.pointsCost} แต้ม · มีอายุ ${o.validityDays} วัน',
                '${minorText(o.discountMinor, o.decimals, o.currency)} off food orders of at least ${minorText(o.minimumSpendMinor, o.decimals, o.currency)} · ${o.pointsCost} points · valid ${o.validityDays} days',
              ),
            ),
            Text(t('คุณมี ${o.balance} แต้มที่ร้านนี้', 'You have ${o.balance} points at this shop')),
            const SizedBox(height: 8),
            FilledButton(
              key: ValueKey('redeem-${o.id}'),
              onPressed: o.redeemable && !busy ? () => _redeem(o) : null,
              child: busy
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(o.redeemable ? t('แลก', 'Redeem') : t('ต้องการอีก $missing แต้ม', 'Need $missing more points')),
            ),
          ],
        ),
      ),
    );
  }

  Widget _voucherCard(MobileVoucher v) => Card(
    key: ValueKey('voucher-${v.id}'),
    margin: const EdgeInsets.only(top: 12),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_name(v.nameTh, v.nameEn), style: Theme.of(context).textTheme.titleMedium),
          Text(v.merchantName),
          Text(
            t(
              'ลด ${minorText(v.discountMinor, v.decimals, v.currency)} เมื่อสั่งอาหารขั้นต่ำ ${minorText(v.minimumSpendMinor, v.decimals, v.currency)} · หมดอายุ ${v.expiresAt.substring(0, 10)}',
              '${minorText(v.discountMinor, v.decimals, v.currency)} off food of at least ${minorText(v.minimumSpendMinor, v.decimals, v.currency)} · expires ${v.expiresAt.substring(0, 10)}',
            ),
          ),
          Text(_stateLabel(v.state), key: ValueKey('voucher-state-${v.id}'), style: const TextStyle(fontWeight: FontWeight.w600)),
          if (v.state == 'AVAILABLE') ...[
            Row(
              children: [
                Expanded(child: SelectableText('${t('รหัส', 'Code')}: ${v.code}', key: ValueKey('voucher-code-${v.id}'))),
                TextButton(
                  key: ValueKey('voucher-copy-${v.id}'),
                  onPressed: () => Clipboard.setData(ClipboardData(text: v.code)),
                  child: Text(t('คัดลอก', 'Copy')),
                ),
              ],
            ),
            Text(
              t(
                'ใช้ได้ที่ตะกร้า > คูปองส่วนลด ของร้านนี้ เซิร์ฟเวอร์เป็นผู้คิดส่วนลด',
                'Use it in your cart under Discount coupons for this shop. The server works out the discount.',
              ),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
      ),
    ),
  );

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
              'แต้มคำนวณจากออเดอร์อาหารที่ชำระแล้วของคุณ 1 แต้มต่อเงิน 1 หน่วยเต็ม ไม่นับออเดอร์ที่มีการคืนเงิน หักด้วยแต้มที่แลกไปแล้ว แต้มนับแยกตามร้าน ร้านที่เปิดรางวัลเท่านั้นที่แลกได้ (เดโม) คูปองที่หมดอายุโดยไม่ได้ใช้จะไม่คืนแต้ม',
              'Points are worked out from your paid food orders: 1 point per whole currency unit, excluding orders with a refund, minus points you already redeemed. Points are counted per shop and only shops that offer a reward can be redeemed (demo). A voucher that expires unused is not refunded.',
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
          const SizedBox(height: 24),
          Text(t('รางวัลที่แลกได้', 'Rewards you can redeem'), style: Theme.of(context).textTheme.titleLarge),
          if (rewardsError != null) ...[
            Semantics(liveRegion: true, child: Text(rewardsError!, key: const ValueKey('rewards-load-error'))),
            OutlinedButton(
              key: const ValueKey('rewards-retry'),
              onPressed: _loadRewards,
              child: Text(t('ลองอีกครั้ง', 'Try again')),
            ),
          ] else if (offers != null && offers!.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                t('ยังไม่มีร้านที่คุณสั่งเปิดรางวัลแลกแต้ม', 'None of the shops you ordered from offer a reward yet.'),
                key: const ValueKey('rewards-offers-empty'),
              ),
            ),
          if (redeemError != null)
            Semantics(liveRegion: true, child: Text(redeemError!, key: const ValueKey('redeem-error'), style: TextStyle(color: Theme.of(context).colorScheme.error))),
          if (redeemed != null)
            Semantics(
              liveRegion: true,
              child: Text(
                t('แลกสำเร็จ คูปองอยู่ในรายการด้านล่าง', 'Redeemed. Your voucher is listed below.'),
                key: const ValueKey('redeem-success'),
              ),
            ),
          for (final offer in offers ?? const <MobileRewardOffer>[]) _offerCard(offer),
          const SizedBox(height: 24),
          Text(t('คูปองของคุณ', 'Your vouchers'), style: Theme.of(context).textTheme.titleLarge),
          if (vouchers != null && vouchers!.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(t('ยังไม่มีคูปอง', 'No vouchers yet.'), key: const ValueKey('vouchers-empty')),
            ),
          for (final voucher in vouchers ?? const <MobileVoucher>[]) _voucherCard(voucher),
        ],
      ),
    );
  }
}
