import 'dart:async';

import 'package:flutter/material.dart';

import 'figcraft_offer_metrics.dart';

/// R07 presentation. The owner supplies quote text, deadline and guarded actions.
/// No fixture route, distance, countdown, recipient or paid-income claim is added.
class DriverFoodOfferCard extends StatefulWidget {
  const DriverFoodOfferCard({
    super.key,
    required this.thai,
    required this.expiryLabel,
    required this.earning,
    required this.pickup,
    required this.declineAction,
    this.onAccept,
    this.deadline,
  });
  final bool thai;
  final String expiryLabel, earning, pickup;
  final Widget declineAction;
  final VoidCallback? onAccept;

  /// Presentation-only expiry; the owner/server still authorizes commands.
  final DateTime? deadline;

  @override
  State<DriverFoodOfferCard> createState() => _DriverFoodOfferCardState();
}

class _DriverFoodOfferCardState extends State<DriverFoodOfferCard> {
  Timer? _deadlineTimer;
  bool _expired = false;

  @override
  void initState() {
    super.initState();
    _armDeadline();
  }

  @override
  void didUpdateWidget(covariant DriverFoodOfferCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.deadline != widget.deadline) _armDeadline();
  }

  void _armDeadline() {
    _deadlineTimer?.cancel();
    _deadlineTimer = null;
    final remaining = widget.deadline?.difference(DateTime.now());
    _expired = remaining != null && remaining <= Duration.zero;
    if (remaining != null && !_expired) {
      _deadlineTimer = Timer(remaining, () {
        setState(() => _expired = true);
      });
    }
  }

  @override
  void dispose() {
    _deadlineTimer?.cancel();
    super.dispose();
  }
  String t(String th, String en) => widget.thai ? th : en;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(FigCraftOfferMetrics.padding),
      decoration: BoxDecoration(
        color: dark ? colors.surfaceContainer : Colors.white,
        borderRadius: BorderRadius.circular(FigCraftOfferMetrics.radius),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: dark
                    ? colors.secondaryContainer
                    : const Color(0xfffff0df),
                borderRadius: BorderRadius.circular(15),
              ),
              child: Text(
                _expired
                    ? t('ข้อเสนองานหมดอายุแล้ว', 'Offer expired')
                    : widget.expiryLabel,
                style: TextStyle(
                  fontSize: 12,
                  color: dark
                      ? colors.onSecondaryContainer
                      : const Color(0xffa94800),
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          Text(
            t('ค่าตอบแทนคนขับตามใบเสนอราคา', 'Quoted driver compensation'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            widget.earning,
            key: const ValueKey('food-offer-quoted-earning'),
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            t('ยังไม่ใช่รายได้ที่ชำระแล้ว', 'Not a paid earning'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 24),
          _place(
            context,
            Icons.storefront_outlined,
            t('จุดรับอาหาร', 'Pickup store'),
            widget.pickup,
          ),
          const SizedBox(height: 24),
          _place(
            context,
            Icons.location_on_outlined,
            t('จุดส่งอาหาร', 'Delivery destination'),
            t('รายละเอียดหลังรับงาน', 'Details after accepting'),
          ),
          const SizedBox(height: 32),
          ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: FigCraftOfferMetrics.actionHeight,
            ),
            child: FilledButton(
              onPressed: _expired ? null : widget.onAccept,
              child: Text(
                t('รับงานนี้', 'Accept this offer'),
                textAlign: TextAlign.center,
              ),
            ),
          ),
          const SizedBox(height: 12),
          ExcludeSemantics(
            excluding: _expired,
            child: ExcludeFocus(
              excluding: _expired,
              child: AbsorbPointer(
                absorbing: _expired,
                child: Opacity(
                  opacity: _expired ? 0.5 : 1,
                  child: widget.declineAction,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _place(
    BuildContext context,
    IconData icon,
    String title,
    String subtitle,
  ) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(icon, size: 22, color: Theme.of(context).colorScheme.primary),
      const SizedBox(width: 14),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    ],
  );
}

/// Compact local deadline; raw server timestamp remains in the owned snapshot.
String driverOfferExpiryLabel(
  BuildContext context, {
  required bool thai,
  required String expiresAt,
  DateTime? now,
}) {
  final expiry = DateTime.parse(expiresAt).toLocal();
  final current = (now ?? DateTime.now()).toLocal();
  if (!expiry.isAfter(current)) {
    return thai ? 'ข้อเสนองานหมดอายุแล้ว' : 'Offer expired';
  }
  final localizations = MaterialLocalizations.of(context);
  final sameDay =
      expiry.year == current.year &&
      expiry.month == current.month &&
      expiry.day == current.day;
  final time = localizations.formatTimeOfDay(
    TimeOfDay.fromDateTime(expiry),
    alwaysUse24HourFormat: true,
  );
  final date = sameDay ? '' : '${localizations.formatShortDate(expiry)} · ';
  return '${thai ? 'งานใหม่ · รับก่อน' : 'New offer · accept by'} $date$time';
}
