import 'dart:async';

import 'package:flutter/material.dart';

/// Presentation expiry only: server remains authoritative; saved commands recover
/// through their separate action even after this quote expires.
class QuoteConfirmation extends StatefulWidget {
  const QuoteConfirmation({
    super.key,
    required this.validUntil,
    this.total,
    required this.thai,
    required this.delivery,
    required this.blocked,
    required this.onConfirm,
  });
  final String validUntil;
  final String? total;
  final bool thai, delivery, blocked;
  final VoidCallback onConfirm;
  @override
  State<QuoteConfirmation> createState() => _QuoteConfirmationState();
}

class _QuoteConfirmationState extends State<QuoteConfirmation>
    with WidgetsBindingObserver {
  Timer? timer;
  bool expired = false, foreground = true;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    schedule();
  }

  void schedule() {
    timer?.cancel();
    final remaining = DateTime.parse(widget.validUntil)
        .difference(DateTime.now());
    expired = remaining <= Duration.zero;
    if (!expired) {
      timer = Timer(remaining, () {
        if (mounted) setState(() => expired = true);
      });
    }
  }

  @override
  void didUpdateWidget(QuoteConfirmation old) {
    super.didUpdateWidget(old);
    if (old.validUntil != widget.validUntil) schedule();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    timer?.cancel();
    if (!mounted) return;
    setState(schedule);
  }

  String expiryLabel() {
    final local = DateTime.parse(widget.validUntil).toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
  }

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Semantics(
        liveRegion: true,
        child: Container(
          padding: EdgeInsets.all(expired ? 12 : 0),
          decoration: BoxDecoration(
            color: expired
                ? Theme.of(context).colorScheme.errorContainer
                : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(
            expired
                ? t(
                    'ราคานี้หมดอายุแล้ว กลับไปตรวจตะกร้าเพื่อรับราคาใหม่',
                    'This quote has expired. Review your cart for a new quote.',
                  )
                : '${t('ราคานี้ใช้ได้ถึง', 'Quote valid until')}: ${expiryLabel()}',
            style: TextStyle(
              fontSize: 13,
              color: expired
                  ? Theme.of(context).colorScheme.onErrorContainer
                  : Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
      const SizedBox(height: 12),
      FilledButton(
        onPressed: widget.blocked || expired || !foreground
            ? null
            : () {
                if (!DateTime.parse(widget.validUntil)
                    .isAfter(DateTime.now())) {
                  setState(() => expired = true);
                  return;
                }
                widget.onConfirm();
              },
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
        child: Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          runSpacing: 4,
          children: [
            Text(
              widget.delivery
                  ? t('ยืนยันออเดอร์จัดส่ง', 'Confirm delivery order')
                  : t('ยืนยันออเดอร์รับที่ร้าน', 'Confirm pickup order'),
            ),
            if (widget.total != null)
              Text(
                '· ${widget.total}',
                key: const ValueKey('quote-confirmation-total'),
              ),
          ],
        ),
      ),
    ],
  );
  @override
  void dispose() {
    timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
