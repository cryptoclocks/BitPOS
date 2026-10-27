import 'package:flutter/material.dart';

import 'figcraft_coupon_metrics.dart';
import 'figcraft_commerce_metrics.dart';

/// Presentation only. All displayed facts and actions are supplied by callers.
class FeatureUiScope extends InheritedWidget {
  const FeatureUiScope({
    super.key,
    required this.navigation,
    required super.child,
  });
  final Widget navigation;
  static FeatureUiScope? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<FeatureUiScope>();
  @override
  bool updateShouldNotify(FeatureUiScope oldWidget) =>
      navigation != oldWidget.navigation;
}

class FeaturePage extends StatelessWidget {
  const FeaturePage({
    super.key,
    required this.title,
    required this.children,
    this.action,
    this.actionLabel,
    this.onBack,
    this.secondary,
    this.notice,
  });
  final String title;
  final List<Widget> children;
  final VoidCallback? action, onBack;
  final String? actionLabel, notice;
  final Widget? secondary;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      centerTitle: false,
      toolbarHeight: 44,
      leadingWidth: 76,
      titleSpacing: 0,
      title: Text(
        title,
        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
      ),
      leading: Padding(
        padding: const EdgeInsets.fromLTRB(18, 0, 14, 0),
        child: IconButton.filledTonal(
          tooltip: MaterialLocalizations.of(context).backButtonTooltip,
          onPressed: onBack ?? () => Navigator.maybePop(context),
          style: IconButton.styleFrom(
            backgroundColor: Theme.of(context).brightness == Brightness.dark
                ? Theme.of(context).colorScheme.surface
                : Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
          icon: const Icon(Icons.chevron_left, size: 22),
        ),
      ),
    ),
    body: SafeArea(
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: ListView(
            key: const ValueKey('feature-page-scroll'),
            padding: const EdgeInsets.fromLTRB(24, 44, 24, 24),
            children: [
              if (notice != null && FeatureUiScope.of(context) == null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    notice!,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ...children,
            ],
          ),
        ),
      ),
    ),
    bottomNavigationBar: SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (actionLabel != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 520),
                    child: SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: action,
                        child: Text(actionLabel!, textAlign: TextAlign.center),
                      ),
                    ),
                  ),
                  ?secondary,
                ],
              ),
            ),
          if (FeatureUiScope.of(context) case final scope?) scope.navigation,
        ],
      ),
    ),
  );
}

class FeatureHero extends StatelessWidget {
  const FeatureHero({
    super.key,
    required this.title,
    required this.subtitle,
    this.icon = Icons.restaurant_outlined,
    this.commerce = false,
    this.bottomGap = 26,
  });
  final String title, subtitle;
  final bool commerce;
  final double bottomGap;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Container(
    constraints: BoxConstraints(
      minHeight: commerce ? FigCraftCommerceMetrics.heroMinHeight : 138,
    ),
    padding: const EdgeInsets.all(21),
    margin: EdgeInsets.only(bottom: bottomGap),
    decoration: BoxDecoration(
      color: Theme.of(context).brightness == Brightness.dark
          ? Theme.of(context).colorScheme.primaryContainer
          : const Color(0xffefe6f8),
      borderRadius: BorderRadius.circular(24),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 40),
        SizedBox(
          height: commerce ? FigCraftCommerceMetrics.heroIconTextGap : 20,
        ),
        if (title.isNotEmpty)
          Text(
            title,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
          ),
        if (!commerce || title.isNotEmpty) const SizedBox(height: 10),
        Text(
          subtitle,
          style: commerce
              ? const TextStyle(
                  fontSize: FigCraftCommerceMetrics.heroTitleFontSize,
                  height: FigCraftCommerceMetrics.heroTitleLineHeight,
                  fontWeight: FontWeight.w600,
                )
              : null,
        ),
      ],
    ),
  );
}

class FeatureTile extends StatelessWidget {
  const FeatureTile({
    super.key,
    required this.title,
    required this.subtitle,
    this.icon = Icons.local_offer_outlined,
    this.trailing,
    this.selected = false,
    this.onTap,
    this.bottomGap = 22,
  });
  final String title, subtitle;
  final IconData icon;
  final Widget? trailing;
  final bool selected;
  final VoidCallback? onTap;
  final double bottomGap;
  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: bottomGap),
    child: Material(
      color: Theme.of(context).brightness == Brightness.dark
          ? Theme.of(context).colorScheme.surface
          : (selected ? const Color(0xffefe6f8) : Colors.white),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: selected
              ? Theme.of(context).colorScheme.primary
              : const Color(0xffe9e1f1),
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 82),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Theme.of(context).colorScheme.primaryContainer
                        : const Color(0xffefe6f8),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(icon, size: 22),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        subtitle,
                        style: TextStyle(
                          fontSize: 12,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                if (trailing != null) ...[const SizedBox(width: 8), trailing!],
                if (onTap != null && trailing == null)
                  const Icon(Icons.chevron_right, size: 20),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

/// Explicit schematic artwork. Never presented as provider-backed map/GPS.
class RouteIllustration extends StatelessWidget {
  const RouteIllustration({super.key, this.height = 280, required this.label});
  final double height;
  final String label;
  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    child: Container(
      height: height,
      margin: const EdgeInsets.only(bottom: 24),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Theme.of(context).colorScheme.primaryContainer
            : const Color(0xffefe6f8),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: CustomPaint(
              painter: _RoutePainter(Theme.of(context).colorScheme),
            ),
          ),
          const Align(
            alignment: Alignment(-.6, .4),
            child: Icon(Icons.location_on, size: 34),
          ),
          const Align(
            alignment: Alignment(.6, -.5),
            child: Icon(Icons.flag_outlined, size: 34),
          ),
          Positioned(
            left: 12,
            bottom: 12,
            right: 12,
            child: Text(label, style: const TextStyle(fontSize: 12)),
          ),
        ],
      ),
    ),
  );
}

class _RoutePainter extends CustomPainter {
  _RoutePainter(this.colors);
  final ColorScheme colors;
  @override
  void paint(Canvas canvas, Size size) {
    final road = Paint()
      ..color = colors.surface
      ..strokeWidth = 18;
    for (var n = 1; n < 5; n++) {
      canvas.drawLine(
        Offset(size.width * n / 5, 0),
        Offset(size.width * n / 5, size.height),
        road,
      );
      canvas.drawLine(
        Offset(0, size.height * n / 5),
        Offset(size.width, size.height * n / 5),
        road,
      );
    }
    final path = Path()
      ..moveTo(size.width * .2, size.height * .7)
      ..lineTo(size.width * .4, size.height * .7)
      ..lineTo(size.width * .4, size.height * .25)
      ..lineTo(size.width * .8, size.height * .25);
    canvas.drawPath(
      path,
      Paint()
        ..color = colors.primary
        ..strokeWidth = 5
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_RoutePainter old) => old.colors != colors;
}

class UiCoupon {
  const UiCoupon({
    required this.id,
    required this.title,
    required this.terms,
    this.eligible = true,
  });
  final String id, title, terms;
  final bool eligible;
}

class CouponSelectionPage extends StatelessWidget {
  const CouponSelectionPage({
    super.key,
    required this.title,
    required this.coupons,
    required this.selected,
    required this.onSelect,
    this.onApply,
    required this.applyLabel,
    this.notice,
    this.hero,
    this.sectionLabel = 'Available coupons',
  });
  final String title, applyLabel, sectionLabel;
  final List<UiCoupon> coupons;
  final String? selected, notice;
  final ValueChanged<String> onSelect;
  final VoidCallback? onApply;
  final Widget? hero;
  @override
  Widget build(BuildContext context) => FeaturePage(
    title: title,
    notice: notice,
    actionLabel: applyLabel,
    action: coupons.any((c) => c.id == selected && c.eligible) ? onApply : null,
    children: [
      ?hero,
      Text(
        sectionLabel,
        style: const TextStyle(
          fontSize: 19,
          height: 1.5,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(height: 12),
      for (final c in coupons)
        FeatureTile(
          key: ValueKey('coupon.${c.id}'),
          title: c.title,
          subtitle: c.terms,
          selected: c.id == selected,
          onTap: c.eligible ? () => onSelect(c.id) : null,
          trailing: Icon(
            c.id == selected
                ? Icons.radio_button_checked
                : Icons.radio_button_off,
          ),
        ),
    ],
  );
}

class ScheduleOrderPage extends StatelessWidget {
  const ScheduleOrderPage({
    super.key,
    required this.title,
    required this.day,
    required this.slot,
    required this.merchant,
    required this.onDay,
    required this.onSlot,
    this.onConfirm,
    required this.thai,
  });
  final String title, day, slot, merchant;
  final bool thai;
  final VoidCallback onDay, onSlot;
  final VoidCallback? onConfirm;
  @override
  Widget build(BuildContext context) => FeaturePage(
    title: title,
    actionLabel: thai ? 'ยืนยันเวลา' : 'Confirm time',
    action: onConfirm,
    children: [
      FeatureHero(
        title: '',
        subtitle: thai ? 'วางแผนความอร่อยไว้ล่วงหน้า' : 'Plan your next meal',
        icon: Icons.event_outlined,
        commerce: true,
      ),
      Text(
        thai ? 'วันที่รับอาหาร' : 'Pickup date',
        style: const TextStyle(fontSize: 14, height: 1.5),
      ),
      const SizedBox(height: 9),
      FeatureChoice(label: day, onPressed: onDay),
      const SizedBox(height: 29),
      Text(
        thai ? 'ช่วงเวลา' : 'Time slot',
        style: const TextStyle(fontSize: 14, height: 1.5),
      ),
      const SizedBox(height: 9),
      FeatureChoice(label: slot, onPressed: onSlot),
      const SizedBox(height: 42),
      FeatureTile(
        title: merchant,
        subtitle: thai ? 'รับเองที่ร้าน' : 'Pickup at merchant',
        icon: Icons.storefront,
      ),
    ],
  );
}

class GroupOrderPage extends StatelessWidget {
  const GroupOrderPage({
    super.key,
    required this.title,
    required this.nameController,
    required this.members,
    required this.thai,
    this.onInvite,
    this.onShare,
  });
  final String title;
  final TextEditingController nameController;
  final List<({String name, String summary})> members;
  final bool thai;
  final VoidCallback? onInvite, onShare;
  @override
  Widget build(BuildContext context) => FeaturePage(
    title: title,
    actionLabel: thai ? 'แชร์ลิงก์กลุ่ม' : 'Share group link',
    action: onShare,
    children: [
      FeatureHero(
        title: '',
        subtitle: thai ? 'เลือกมื้อโปรดด้วยกัน' : 'Build a meal together',
        icon: Icons.groups_outlined,
        commerce: true,
      ),
      Text(
        thai ? 'ชื่อกลุ่ม' : 'Group name',
        style: const TextStyle(fontSize: 14, height: 1.5),
      ),
      const SizedBox(height: FigCraftCommerceMetrics.labelFieldGap),
      ConstrainedBox(
        constraints: const BoxConstraints(
          minHeight: FigCraftCommerceMetrics.fieldMinHeight,
        ),
        child: Semantics(
          label: thai ? 'ชื่อกลุ่ม' : 'Group name',
          child: TextField(
            key: const ValueKey('group-name-input'),
            controller: nameController,
            decoration: InputDecoration(
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? Theme.of(context).colorScheme.outline
                      : const Color(0xffe9e1f1),
                ),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 14,
              ),
            ),
          ),
        ),
      ),
      const SizedBox(height: FigCraftCommerceMetrics.groupFieldMembersGap),
      for (final member in members)
        FeatureTile(
          title: member.name,
          subtitle: member.summary,
          icon: Icons.person_outline,
        ),
      FeatureTile(
        title: thai ? 'เชิญเพื่อนร่วมสั่ง' : 'Invite your friends',
        subtitle: thai ? 'แชร์ลิงก์กลุ่ม' : 'Share group link',
        icon: Icons.person_add_alt,
        onTap: onInvite,
      ),
    ],
  );
}

class UiMerchantOrder {
  const UiMerchantOrder({
    required this.id,
    required this.name,
    required this.summary,
  });
  final String id, name, summary;
}

class MultiMerchantPage extends StatelessWidget {
  const MultiMerchantPage({
    super.key,
    required this.title,
    required this.orders,
    required this.onOpen,
    required this.thai,
    this.onReview,
  });
  final String title;
  final List<UiMerchantOrder> orders;
  final ValueChanged<String> onOpen;
  final bool thai;
  final VoidCallback? onReview;
  @override
  Widget build(BuildContext context) => FeaturePage(
    title: title,
    actionLabel: thai ? 'ตรวจสอบแยกตามร้าน' : 'Review each merchant',
    action: onReview,
    children: [
      FeatureHero(
        title: '',
        subtitle: thai
            ? 'เลือกมื้อโปรดจากร้านที่คุณชอบ'
            : 'Your favourite meals, by merchant',
        icon: Icons.storefront_outlined,
        commerce: true,
        bottomGap: FigCraftCommerceMetrics.multiHeroBottomGap,
      ),
      for (final order in orders)
        FeatureTile(
          bottomGap: FigCraftCommerceMetrics.multiRowBottomGap,
          title: order.name,
          subtitle: order.summary,
          icon: Icons.storefront,
          onTap: () => onOpen(order.id),
        ),
      const SizedBox(height: FigCraftCommerceMetrics.multiNoteTopGap),
      Text(
        thai ? 'แต่ละร้านมีออเดอร์ ค่าจัดส่ง และสถานะคืนเงินของตัวเอง' : 'Each merchant has a separate order, delivery fee and refund status.',
      ),
    ],
  );
}

class CouponOfferBanner extends StatelessWidget {
  const CouponOfferBanner({
    super.key,
    required this.title,
    required this.amount,
    required this.subtitle,
  });
  final String title, amount, subtitle;
  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(
      minHeight: FigCraftCouponMetrics.heroMinHeight,
    ),
    margin: const EdgeInsets.only(bottom: FigCraftCouponMetrics.heroBottomGap),
    padding: const EdgeInsets.all(FigCraftCouponMetrics.heroPadding),
    decoration: BoxDecoration(
      color: const Color(0xff64188a),
      borderRadius: BorderRadius.circular(24),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontSize: FigCraftCouponMetrics.titleFontSize,
            height: 1.5,
          ),
        ),
        const SizedBox(height: FigCraftCouponMetrics.titleAmountGap),
        Text(
          amount,
          style: const TextStyle(
            color: Colors.white,
            fontSize: FigCraftCouponMetrics.amountFontSize,
            height: 1.5,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: FigCraftCouponMetrics.amountSubtitleGap),
        Text(
          subtitle,
          style: const TextStyle(
            color: Colors.white,
            fontSize: FigCraftCouponMetrics.subtitleFontSize,
            height: 1.5,
          ),
        ),
      ],
    ),
  );
}

class FeatureChoice extends StatelessWidget {
  const FeatureChoice({
    super.key,
    required this.label,
    required this.onPressed,
  });
  final String label;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) => OutlinedButton(
    onPressed: onPressed,
    style: OutlinedButton.styleFrom(
      minimumSize: const Size.fromHeight(52),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      backgroundColor: Theme.of(context).brightness == Brightness.dark
          ? Theme.of(context).colorScheme.surface
          : Colors.white,
      side: const BorderSide(color: Color(0xffe9e1f1)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        const SizedBox(width: 12),
        const Icon(Icons.expand_more, size: 22),
      ],
    ),
  );
}
