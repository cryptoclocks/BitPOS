import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_layout.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/presentation/bitpos_info.dart';

import '../food_labels.dart';

/// Result popped when the customer asks to drop the coupon and refresh the price.
class CouponRemoveRequest {
  const CouponRemoveRequest();
}

/// Coupon code entry for the quote under review. The app only sends a code and an
/// idempotency key; the server decides eligibility and returns the discounted
/// replacement quote. [onApply] == null renders an honest disabled state.
class CartCouponPage extends StatefulWidget {
  const CartCouponPage({
    super.key,
    required this.thai,
    this.onApply,
    this.newKey,
    this.appliedCode,
    this.disabledReason,
    this.vouchers = const [],
  });
  final bool thai;

  /// Calls the server with the typed code; the page owns the idempotency key.
  final Future<MobileCouponQuote> Function(String code, String commandKey)?
  onApply;
  /// Generates the account-scoped command UUID (MobileApi.newCommandKey).
  final String Function()? newKey;
  final String? appliedCode;
  final String? disabledReason;

  /// Unused reward vouchers of this shop (already filtered by the caller). Tapping one only fills the code; the server still decides.
  final List<MobileVoucher> vouchers;
  @override
  State<CartCouponPage> createState() => _CartCouponPageState();
}

class _CartCouponPageState extends State<CartCouponPage> {
  final _controller = TextEditingController();
  bool _busy = false;
  Object? _error;
  String? _keyCode, _key;
  static final _shape = RegExp(r'^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$');
  String t(String th, String en) => widget.thai ? th : en;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    final code = _controller.text.trim().toUpperCase();
    if (!_shape.hasMatch(code)) {
      setState(
        () => _error = const MobileApiException(
          'INVALID_REQUEST',
          422,
          'COUPON_NOT_FOUND',
        ),
      );
      return;
    }
    // Same code keeps the same key so an ambiguous network failure replays on the server.
    if (_keyCode != code) {
      _keyCode = code;
      _key = null;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.onApply!(
        code,
        _key ??= widget.newKey!(),
      );
      if (mounted) Navigator.of(context).pop(result);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final enabled =
        widget.onApply != null &&
        widget.newKey != null &&
        widget.appliedCode == null;
    return Scaffold(
      appBar: bitPosAppBar(
        context,
        title: Text(t('คูปองส่วนลด', 'Discount coupons')),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(
                    Icons.local_offer_outlined,
                    size: 56,
                    color: colors.primary,
                  ),
                  const SizedBox(height: 24),
                  if (widget.appliedCode != null) ...[
                    Text(
                      key: const ValueKey('coupon-applied-title'),
                      t(
                        'ใช้คูปอง ${widget.appliedCode} แล้ว',
                        'Coupon ${widget.appliedCode} applied',
                      ),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    BitPosInfoLine(
                      key: const ValueKey('coupon-applied-info'),
                      thai: widget.thai,
                      summary: t('เซิร์ฟเวอร์คำนวณส่วนลดและยอดสุทธิ', 'The server calculates the discount and total'),
                      title: t('เกี่ยวกับคูปอง', 'About this coupon'),
                      paragraphs: [
                        t(
                          'ยอดส่วนลดและยอดสุทธิในตะกร้าคำนวณโดยเซิร์ฟเวอร์ หากต้องการเปลี่ยนคูปอง ให้อัปเดตราคาก่อน (สิทธิ์ของคูปองเดิมจะคืนเมื่อราคาหมดอายุ)',
                          'The discount and total in your cart are computed by the server. To change the coupon, refresh the price first (the earlier coupon is released when that price expires).',
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    OutlinedButton(
                      key: const ValueKey('coupon-remove'),
                      onPressed: () => Navigator.of(
                        context,
                      ).pop(const CouponRemoveRequest()),
                      child: Text(
                        t('อัปเดตราคาโดยไม่ใช้คูปอง', 'Refresh price without coupon'),
                      ),
                    ),
                  ] else if (!enabled) ...[
                    Text(
                      key: const ValueKey('coupon-unavailable-title'),
                      t('ยังใช้คูปองไม่ได้', 'Coupons are not available right now'),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      widget.disabledReason ??
                          t(
                            'ออเดอร์นี้ยังเลือกคูปองไม่ได้ ยอดในตะกร้ายังไม่เปลี่ยนแปลง',
                            'Coupons cannot be selected for this order right now. Your cart total has not changed.',
                          ),
                      textAlign: TextAlign.center,
                    ),
                  ] else ...[
                    Text(
                      t('ใส่รหัสคูปอง', 'Enter a coupon code'),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      key: const ValueKey('coupon-code-field'),
                      controller: _controller,
                      enabled: !_busy,
                      textCapitalization: TextCapitalization.characters,
                      autocorrect: false,
                      maxLength: 32,
                      decoration: InputDecoration(
                        labelText: t('รหัสคูปอง', 'Coupon code'),
                        border: const OutlineInputBorder(),
                      ),
                      onChanged: (_) {
                        if (_error != null && !_busy) setState(() => _error = null);
                      },
                      onSubmitted: (_) => _apply(),
                    ),
                    if (widget.vouchers.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(
                        t('คูปองรางวัลของคุณที่ร้านนี้', 'Your reward vouchers at this shop'),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final v in widget.vouchers)
                            ActionChip(
                              key: ValueKey('coupon-voucher-${v.id}'),
                              label: Text('${widget.thai ? v.nameTh : v.nameEn} · ${v.code}'),
                              onPressed: _busy ? null : () => setState(() => _controller.text = v.code),
                            ),
                        ],
                      ),
                      const SizedBox(height: 24),
                    ],
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(
                          checkoutRefusalMessage(_error!, widget.thai),
                          key: const ValueKey('coupon-error'),
                          style: TextStyle(color: colors.error),
                        ),
                      ),
                    FilledButton(
                      key: const ValueKey('coupon-apply-button'),
                      onPressed: _busy ? null : _apply,
                      child: _busy
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(t('ใช้คูปอง', 'Apply coupon')),
                    ),
                  ],
                  const SizedBox(height: 24),
                  TextButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    child: Text(t('กลับไปตะกร้า', 'Back to cart')),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
