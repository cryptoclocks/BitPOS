import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';

import 'customer_navigation.dart';
import 'ride_preview_pages.dart';

const _bg = Color(0xfff8f5fc);
const _ink = Color(0xff29183f);
const _purple = Color(0xff64188a);
const _tile = Color(0xffefe6f8);
const _border = Color(0xffe9e1f1);
const _muted = Color(0xff7b7088);

/// Shared frame for the presentation-only routes (U26, U27, U35-U37, U39-U43).
/// Nothing here calls an API or claims a business result: every route states
/// that its content is a sample and keeps its primary action disabled with a
/// concise reason until the matching backend lifecycle is admitted.
class PreviewFrame extends StatelessWidget {
  const PreviewFrame({
    super.key,
    required this.thai,
    required this.title,
    required this.children,
    this.cta,
    this.ctaReason,
    this.onNavigationSelected,
    this.selectedIndex = 3,
  });
  final bool thai;
  final String title;
  final List<Widget> children;
  final String? cta;
  final String? ctaReason;
  final ValueChanged<int>? onNavigationSelected;
  final int selectedIndex;

  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    final font = thai
        ? BitPosDesignTokens.fontThai
        : BitPosDesignTokens.fontLatin;
    return Scaffold(
      backgroundColor: _bg,
      bottomNavigationBar: SafeArea(
        top: false,
        child: CustomerNavigation(
          thai: thai,
          selectedIndex: selectedIndex,
          onSelected: onNavigationSelected,
        ),
      ),
      appBar: AppBar(
        backgroundColor: _bg,
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
              foregroundColor: _purple,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: _border),
              ),
            ),
            icon: const Icon(Icons.chevron_left, size: 22),
          ),
        ),
        title: Text(
          title,
          style: TextStyle(
            fontFamily: font,
            fontSize: 20,
            fontWeight: FontWeight.w600,
            color: _ink,
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                children: [
                  _SampleBadge(
                    label: t(
                      'ตัวอย่างหน้าจอ · ยังไม่เชื่อมระบบจริง',
                      'Sample screen · not connected to live data',
                    ),
                  ),
                  const SizedBox(height: 16),
                  ...children,
                ],
              ),
            ),
            if (cta != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (ctaReason != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          ctaReason!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 12, color: _muted),
                        ),
                      ),
                    FilledButton(
                      onPressed: null,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      child: Text(cta!),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SampleBadge extends StatelessWidget {
  const _SampleBadge({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: _tile,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        key: const ValueKey('preview-sample-badge'),
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: _purple,
        ),
      ),
    ),
  );
}

class PreviewHero extends StatelessWidget {
  const PreviewHero({
    super.key,
    required this.eyebrow,
    required this.headline,
    required this.caption,
  });
  final String eyebrow, headline, caption;
  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minHeight: 151),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: _purple,
      borderRadius: BorderRadius.circular(28),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          eyebrow,
          style: const TextStyle(fontSize: 15, color: Colors.white),
        ),
        const SizedBox(height: 9),
        Text(
          headline,
          style: const TextStyle(
            fontSize: 32,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 9),
        Text(
          caption,
          style: const TextStyle(fontSize: 13, color: Colors.white),
        ),
      ],
    ),
  );
}

class PreviewIntro extends StatelessWidget {
  const PreviewIntro({super.key, required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: _tile,
      borderRadius: BorderRadius.circular(28),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 32, color: _purple),
        const SizedBox(height: 14),
        Text(
          text,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w600,
            color: _ink,
          ),
        ),
      ],
    ),
  );
}

class PreviewRow extends StatelessWidget {
  const PreviewRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
    this.chevron = false,
  });
  final IconData icon;
  final String title, subtitle;
  final VoidCallback? onTap;
  final bool chevron;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: _border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
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
                    color: _tile,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(icon, color: _purple),
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
                          color: _ink,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        subtitle,
                        style: const TextStyle(fontSize: 12, color: _muted),
                      ),
                    ],
                  ),
                ),
                if (chevron) const Icon(Icons.chevron_right, color: _purple),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class PreviewField extends StatelessWidget {
  const PreviewField({super.key, required this.label, required this.value});
  final String label, value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 13, color: _muted)),
        const SizedBox(height: 8),
        Container(
          constraints: const BoxConstraints(minHeight: 52),
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _border),
          ),
          child: Text(value, style: const TextStyle(fontSize: 15, color: _ink)),
        ),
      ],
    ),
  );
}

class PreviewSectionTitle extends StatelessWidget {
  const PreviewSectionTitle(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 20, bottom: 12),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: _ink,
      ),
    ),
  );
}

/// U26 coupons.
class CouponsPreviewPage extends StatelessWidget {
  const CouponsPreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PreviewFrame(
      thai: thai,
      title: t('คูปองของคุณ', 'Your coupons'),
      onNavigationSelected: onNavigationSelected,
      cta: t('ใช้คูปอง', 'Apply coupon'),
      ctaReason: t(
        'ยังใช้คูปองกับออร์เดอร์ไม่ได้ ยอดในตะกร้าไม่เปลี่ยน',
        'Coupons cannot be applied yet. Your cart total will not change.',
      ),
      children: [
        PreviewHero(
          eyebrow: t('สิทธิพิเศษสำหรับคุณ', 'Offers for you'),
          headline: t('ตัวอย่างส่วนลด', 'Sample discount'),
          caption: t('เลือกใช้ก่อนยืนยันออเดอร์', 'Choose before you confirm'),
        ),
        PreviewSectionTitle(t('คูปองที่ใช้ได้', 'Available coupons')),
        PreviewRow(
          icon: Icons.local_offer_outlined,
          title: t('ตัวอย่างคูปองส่วนลด', 'Sample discount coupon'),
          subtitle: t(
            'เงื่อนไขจะมาจากเซิร์ฟเวอร์',
            'Terms will come from the server',
          ),
          chevron: true,
        ),
        PreviewRow(
          icon: Icons.local_shipping_outlined,
          title: t('ตัวอย่างส่งฟรีใกล้บ้าน', 'Sample nearby free delivery'),
          subtitle: t(
            'ระยะทางและขั้นต่ำกำหนดโดยร้าน',
            'Distance and minimum set by the merchant',
          ),
          chevron: true,
        ),
      ],
    );
  }
}

/// U27 rewards.
class RewardsPreviewPage extends StatelessWidget {
  const RewardsPreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PreviewFrame(
      thai: thai,
      title: 'BitPOS Rewards',
      onNavigationSelected: onNavigationSelected,
      cta: t('แลกรางวัล', 'Redeem reward'),
      ctaReason: t(
        'ยังไม่มียอดแต้มจริง การแลกรางวัลจะเปิดเมื่อเซิร์ฟเวอร์ยืนยันแต้ม',
        'No real points balance yet. Redemption opens once the server confirms points.',
      ),
      children: [
        PreviewHero(
          eyebrow: t('แต้มของคุณ', 'Your points'),
          headline: t('— แต้ม', '— points'),
          caption: t(
            'ยอดแต้มจริงจะแสดงเมื่อระบบเปิดใช้',
            'The real balance appears when rewards go live',
          ),
        ),
        PreviewSectionTitle(t('รางวัลที่แลกได้', 'Rewards you can redeem')),
        PreviewRow(
          icon: Icons.card_giftcard_outlined,
          title: t('ตัวอย่างรางวัล', 'Sample reward'),
          subtitle: t(
            'จำนวนแต้มกำหนดโดยร้าน',
            'Points cost is set by the merchant',
          ),
          chevron: true,
        ),
      ],
    );
  }
}

/// U35 scheduled order.
class SchedulePreviewPage extends StatelessWidget {
  const SchedulePreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PreviewFrame(
      thai: thai,
      title: t('สั่งล่วงหน้า', 'Schedule an order'),
      onNavigationSelected: onNavigationSelected,
      cta: t('ยืนยันเวลา', 'Confirm time'),
      ctaReason: t(
        'ยังไม่เปิดสั่งล่วงหน้า ร้านต้องยืนยันเวลารับก่อน',
        'Scheduling is not open yet. The merchant must confirm any time slot.',
      ),
      children: [
        PreviewIntro(
          icon: Icons.schedule,
          text: t('วางแผนความอร่อยไว้ล่วงหน้า', 'Plan your meal ahead'),
        ),
        const SizedBox(height: 24),
        PreviewField(
          label: t('วันที่รับอาหาร', 'Pickup day'),
          value: t('เลือกวัน (ตัวอย่าง)', 'Choose a day (sample)'),
        ),
        PreviewField(
          label: t('ช่วงเวลา', 'Time window'),
          value: t('เลือกช่วงเวลา (ตัวอย่าง)', 'Choose a window (sample)'),
        ),
        PreviewRow(
          icon: Icons.storefront_outlined,
          title: t('ร้านของคุณ', 'Your merchant'),
          subtitle: t(
            'เลือกจากตะกร้าที่บันทึกไว้',
            'Taken from your saved cart',
          ),
        ),
      ],
    );
  }
}

/// U36 group order.
class GroupOrderPreviewPage extends StatelessWidget {
  const GroupOrderPreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PreviewFrame(
      thai: thai,
      title: t('อร่อยด้วยกัน', 'Order together'),
      onNavigationSelected: onNavigationSelected,
      cta: t('แชร์ลิงก์กลุ่ม', 'Share group link'),
      ctaReason: t(
        'ยังไม่เปิดสั่งเป็นกลุ่ม จึงยังไม่สร้างลิงก์เชิญ',
        'Group ordering is not open yet, so no invite link is created.',
      ),
      children: [
        PreviewIntro(
          icon: Icons.group_outlined,
          text: t(
            'สั่งอาหารพร้อมเพื่อนในตะกร้าเดียว',
            'Order with friends in one cart',
          ),
        ),
        const SizedBox(height: 24),
        PreviewField(
          label: t('ชื่อกลุ่ม', 'Group name'),
          value: t('ชื่อกลุ่ม (ตัวอย่าง)', 'Group name (sample)'),
        ),
        PreviewRow(
          icon: Icons.person_outline,
          title: t('คุณ · ผู้สร้างกลุ่ม', 'You · group host'),
          subtitle: t(
            'รายการและยอดจะมาจากตะกร้าจริง',
            'Items and totals will come from the real cart',
          ),
        ),
        PreviewRow(
          icon: Icons.add,
          title: t('เชิญเพื่อนร่วมสั่ง', 'Invite friends'),
          subtitle: t('ลิงก์กลุ่ม', 'Group link'),
        ),
      ],
    );
  }
}

/// U37 multi-merchant.
class MultiMerchantPreviewPage extends StatelessWidget {
  const MultiMerchantPreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PreviewFrame(
      thai: thai,
      title: t('เลือกอร่อยจากหลายร้าน', 'Order from several merchants'),
      onNavigationSelected: onNavigationSelected,
      cta: t('ตรวจสอบออร์เดอร์แยกตามร้าน', 'Review orders per merchant'),
      ctaReason: t(
        'ยังไม่เปิดชำระหลายร้านรวมกัน แต่ละร้านต้องมีออร์เดอร์ของตัวเอง',
        'Combined multi-merchant checkout is not open. Each merchant needs its own order.',
      ),
      children: [
        PreviewIntro(
          icon: Icons.inventory_2_outlined,
          text: t(
            'สั่งจากหลายร้านในครั้งเดียว',
            'Order from more than one merchant',
          ),
        ),
        const SizedBox(height: 24),
        PreviewRow(
          icon: Icons.storefront_outlined,
          title: t('ร้านที่ 1 (ตัวอย่าง)', 'Merchant 1 (sample)'),
          subtitle: t(
            'รายการและยอดจากตะกร้าของร้านนี้',
            'Items and total from this merchant cart',
          ),
        ),
        PreviewRow(
          icon: Icons.storefront_outlined,
          title: t('ร้านที่ 2 (ตัวอย่าง)', 'Merchant 2 (sample)'),
          subtitle: t(
            'รายการและยอดจากตะกร้าของร้านนี้',
            'Items and total from this merchant cart',
          ),
        ),
        const SizedBox(height: 8),
        Text(
          t(
            'แต่ละร้านมีออร์เดอร์ ค่าจัดส่ง และสถานะคืนเงินของตัวเอง',
            'Each merchant has its own order, delivery fee and refund status.',
          ),
          style: const TextStyle(fontSize: 14, color: _muted),
        ),
      ],
    );
  }
}

/// Hub reached from the account overview for every presentation-only route.
class FeaturePreviewHubPage extends StatelessWidget {
  const FeaturePreviewHubPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
    this.rewardsBuilder,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;

  /// When set, BitPOS Rewards opens this real page instead of the sample screen.
  final WidgetBuilder? rewardsBuilder;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    void open(Widget page) =>
        Navigator.of(context)
            .push(MaterialPageRoute<void>(builder: (_) => page));
    return PreviewFrame(
      thai: thai,
      title: t('ฟีเจอร์ที่กำลังมา', 'Coming features'),
      onNavigationSelected: onNavigationSelected,
      children: [
        PreviewRow(
          icon: Icons.local_offer_outlined,
          title: t('คูปองของคุณ', 'Your coupons'),
          subtitle: t('ยังไม่เปิดใช้งานจริง', 'Not live yet'),
          chevron: true,
          onTap: () => open(
            CouponsPreviewPage(
              thai: thai,
              onNavigationSelected: onNavigationSelected,
            ),
          ),
        ),
        PreviewRow(
          icon: Icons.card_giftcard_outlined,
          title: 'BitPOS Rewards',
          subtitle: rewardsBuilder != null
              ? t('แต้มจากออเดอร์ที่ชำระแล้ว', 'Points from your paid orders')
              : t('ยังไม่เปิดใช้งานจริง', 'Not live yet'),
          chevron: true,
          onTap: () => rewardsBuilder != null
              ? Navigator.of(context)
                    .push(MaterialPageRoute<void>(builder: rewardsBuilder!))
              : open(
                  RewardsPreviewPage(
                    thai: thai,
                    onNavigationSelected: onNavigationSelected,
                  ),
                ),
        ),
        PreviewRow(
          icon: Icons.schedule,
          title: t('สั่งล่วงหน้า', 'Schedule an order'),
          subtitle: t('ยังไม่เปิดใช้งานจริง', 'Not live yet'),
          chevron: true,
          onTap: () => open(
            SchedulePreviewPage(
              thai: thai,
              onNavigationSelected: onNavigationSelected,
            ),
          ),
        ),
        PreviewRow(
          icon: Icons.group_outlined,
          title: t('อร่อยด้วยกัน', 'Order together'),
          subtitle: t('ยังไม่เปิดใช้งานจริง', 'Not live yet'),
          chevron: true,
          onTap: () => open(
            GroupOrderPreviewPage(
              thai: thai,
              onNavigationSelected: onNavigationSelected,
            ),
          ),
        ),
        PreviewRow(
          icon: Icons.inventory_2_outlined,
          title: t('เลือกอร่อยจากหลายร้าน', 'Several merchants'),
          subtitle: t('ยังไม่เปิดใช้งานจริง', 'Not live yet'),
          chevron: true,
          onTap: () => open(
            MultiMerchantPreviewPage(
              thai: thai,
              onNavigationSelected: onNavigationSelected,
            ),
          ),
        ),
        PreviewRow(
          icon: Icons.directions_car_outlined,
          title: t('เดินทางกับ BitPOS', 'Rides with BitPOS'),
          subtitle: t(
            'ตัวอย่างขั้นตอนการเดินทาง ยังจองจริงไม่ได้',
            'Ride flow sample, booking is not available',
          ),
          chevron: true,
          onTap: () => open(
            RideHomePreviewPage(
              thai: thai,
              onNavigationSelected: onNavigationSelected,
            ),
          ),
        ),
      ],
    );
  }
}
