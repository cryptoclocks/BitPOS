import 'dart:async';

import 'package:flutter/material.dart';

/// Presentation expiry only: server remains authoritative; saved commands recover
/// through their separate action even after this quote expires.
class QuoteConfirmation extends StatefulWidget {
  const QuoteConfirmation({
    super.key,
    required this.validUntil,
    required this.thai,
    required this.delivery,
    required this.blocked,
    required this.onConfirm,
  });
  final String validUntil;
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
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: expired ? const Color(0xFFFFF0DF) : const Color(0xFFEFE6F8),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(
            expired
                ? t(
                    'ราคานี้หมดอายุแล้ว กลับไปตรวจตะกร้าเพื่อรับราคาใหม่',
                    'This quote has expired. Review your cart for a new quote.',
                  )
                : '${t('ราคานี้ใช้ได้ถึง', 'Quote valid until')}: ${expiryLabel()}',
            style: const TextStyle(fontSize: 13, color: Color(0xFF29183F)),
          ),
        ),
      ),
      const SizedBox(height: 16),
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
        child: Text(
          widget.delivery
              ? t('ยืนยันออร์เดอร์จัดส่ง', 'Confirm delivery order')
              : t('ยืนยันออร์เดอร์รับที่ร้าน', 'Confirm pickup order'),
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
