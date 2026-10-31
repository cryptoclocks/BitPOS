import 'package:flutter/material.dart';

import 'customer_navigation.dart';
import 'feature_preview_pages.dart';

const _bg = Color(0xfff8f5fc);
const _ink = Color(0xff29183f);
const _purple = Color(0xff64188a);
const _tile = Color(0xffefe6f8);
const _muted = Color(0xff7b7088);

class _RoutePainter extends CustomPainter {
  const _RoutePainter();
  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = const Color(0xffefeae3),
    );
    final road = Paint()..color = Colors.white;
    for (final y in [size.height * .3, size.height * .62, size.height * .85]) {
      canvas.drawRect(Rect.fromLTWH(0, y - 8, size.width, 16), road);
    }
    final line = Paint()
      ..color = _purple
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    final path = Path()
      ..moveTo(size.width * .15, size.height * .9)
      ..lineTo(size.width * .15, size.height * .5)
      ..lineTo(size.width * .6, size.height * .5)
      ..lineTo(size.width * .6, size.height * .2);
    canvas.drawPath(path, line);
    canvas.drawCircle(
      Offset(size.width * .6, size.height * .2),
      14,
      Paint()..color = const Color(0xffff8a00),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Shared frame for U39-U42: sample route canvas (not a map provider) with a
/// bottom sheet. Navigation between steps is presentation-only.
class RideFrame extends StatelessWidget {
  const RideFrame({
    super.key,
    required this.thai,
    required this.title,
    required this.heading,
    required this.children,
    this.cta,
    this.ctaReason,
    this.next,
    this.nextLabel,
    this.onNavigationSelected,
  });
  final bool thai;
  final String title, heading;
  final List<Widget> children;
  final String? cta, ctaReason, nextLabel;
  final Widget? next;
  final ValueChanged<int>? onNavigationSelected;

  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return Scaffold(
      backgroundColor: _bg,
      bottomNavigationBar: SafeArea(
        top: false,
        child: CustomerNavigation(
          thai: thai,
          selectedIndex: 3,
          onSelected: onNavigationSelected,
        ),
      ),
      appBar: AppBar(
        backgroundColor: _bg,
        toolbarHeight: 72,
        leadingWidth: 84,
        titleSpacing: 0,
        leading: Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 12, 12),
          child: IconButton.filledTonal(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.of(context).maybePop(),
            style: IconButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: _purple,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: Color(0xffe9e1f1)),
              ),
            ),
            icon: const Icon(Icons.chevron_left, size: 22),
          ),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w600,
            color: _ink,
          ),
        ),
      ),
      body: SafeArea(
        child: ListView(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: _tile,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    t(
                      'ตัวอย่างขั้นตอน · ยังจองรถจริงไม่ได้',
                      'Sample flow · real booking is not available',
                    ),
                    key: const ValueKey('ride-sample-badge'),
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: _purple,
                    ),
                  ),
                ),
              ),
            ),
            SizedBox(
              height: 190,
              child: Semantics(
                label: t(
                  'ภาพเส้นทางตัวอย่าง ไม่ใช่แผนที่จริง',
                  'Sample route sketch, not a real map',
                ),
                child: const CustomPaint(
                  painter: _RoutePainter(),
                  size: Size.infinite,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    heading,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w600,
                      color: _ink,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ...children,
                  if (ctaReason != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(
                        ctaReason!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 12, color: _muted),
                      ),
                    ),
                  if (cta != null)
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
                  if (next != null) ...[
                    const SizedBox(height: 10),
                    OutlinedButton(
                      key: const ValueKey('ride-next-sample'),
                      onPressed: () => Navigator.of(context)
                          .push(MaterialPageRoute<void>(builder: (_) => next!)),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                        foregroundColor: _purple,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      child: Text(
                        nextLabel ??
                            t(
                              'ดูขั้นตอนถัดไป (ตัวอย่าง)',
                              'View next sample step',
                            ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// U39 ride home.
class RideHomePreviewPage extends StatelessWidget {
  const RideHomePreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return RideFrame(
      thai: thai,
      title: t('เดินทางกับ BitPOS', 'Rides with BitPOS'),
      heading: t('วันนี้จะไปที่ไหน?', 'Where to today?'),
      onNavigationSelected: onNavigationSelected,
      cta: t('ค้นหารถ', 'Find a ride'),
      ctaReason: t(
        'ยังไม่มีบริการเรียกรถและราคาจริง',
        'Ride service and real fares are not available yet.',
      ),
      next: RideQuotePreviewPage(
        thai: thai,
        onNavigationSelected: onNavigationSelected,
      ),
      children: [
        PreviewField(
          label: t('จุดรับ', 'Pickup'),
          value: t('จุดรับ (ตัวอย่าง)', 'Pickup (sample)'),
        ),
        PreviewField(
          label: t('จุดหมาย', 'Destination'),
          value: t('เลือกสถานที่ (ตัวอย่าง)', 'Choose a place (sample)'),
        ),
      ],
    );
  }
}

/// U40 vehicle quote.
class RideQuotePreviewPage extends StatelessWidget {
  const RideQuotePreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return RideFrame(
      thai: thai,
      title: t('เลือกรถที่เหมาะกับคุณ', 'Choose your ride'),
      heading: t('เลือกรถของคุณ', 'Your ride'),
      onNavigationSelected: onNavigationSelected,
      cta: t('ยืนยันเรียกรถ', 'Confirm ride'),
      ctaReason: t(
        'ยังไม่มีราคาที่เซิร์ฟเวอร์ยืนยัน จึงยังเรียกรถไม่ได้',
        'No server-confirmed fare yet, so a ride cannot be requested.',
      ),
      next: RideMatchingPreviewPage(
        thai: thai,
        onNavigationSelected: onNavigationSelected,
      ),
      children: [
        PreviewRow(
          icon: Icons.directions_car_outlined,
          title: t('รถยนต์ (ตัวอย่าง)', 'Car (sample)'),
          subtitle: t(
            'ราคาและเวลารอจะมาจากเซิร์ฟเวอร์',
            'Fare and wait time will come from the server',
          ),
        ),
        PreviewRow(
          icon: Icons.two_wheeler_outlined,
          title: t('มอเตอร์ไซค์ (ตัวอย่าง)', 'Bike (sample)'),
          subtitle: t(
            'ราคาและเวลารอจะมาจากเซิร์ฟเวอร์',
            'Fare and wait time will come from the server',
          ),
        ),
      ],
    );
  }
}

/// U41 matching.
class RideMatchingPreviewPage extends StatelessWidget {
  const RideMatchingPreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return RideFrame(
      thai: thai,
      title: t('กำลังหาคนขับ', 'Finding a driver'),
      heading: t('กำลังค้นหาคนขับใกล้คุณ', 'Looking for a driver nearby'),
      onNavigationSelected: onNavigationSelected,
      cta: t('ยกเลิกการค้นหา', 'Cancel search'),
      ctaReason: t(
        'ตัวอย่างเท่านั้น ไม่มีการค้นหาหรือเรียกคนขับจริง',
        'Sample only. No driver search or request is made.',
      ),
      next: RideTripPreviewPage(
        thai: thai,
        onNavigationSelected: onNavigationSelected,
      ),
      children: [
        Text(
          t('จุดรับ → จุดหมาย (ตัวอย่าง)', 'Pickup → destination (sample)'),
          style: const TextStyle(color: _muted),
        ),
        const SizedBox(height: 16),
      ],
    );
  }
}

/// U42 trip in progress.
class RideTripPreviewPage extends StatelessWidget {
  const RideTripPreviewPage({
    super.key,
    required this.thai,
    this.onNavigationSelected,
  });
  final bool thai;
  final ValueChanged<int>? onNavigationSelected;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return RideFrame(
      thai: thai,
      title: t('เดินทางอย่างอุ่นใจ', 'Travel with peace of mind'),
      heading: t(
        'เวลาถึงจุดหมายจะแสดงเมื่อมีข้อมูลจริง',
        'Arrival time appears once real data exists',
      ),
      onNavigationSelected: onNavigationSelected,
      cta: t('ความปลอดภัยและแชร์เที่ยว', 'Safety and trip sharing'),
      ctaReason: t(
        'ยังไม่มีเที่ยวจริง จึงยังแชร์หรือแจ้งเหตุไม่ได้',
        'No real trip yet, so sharing and incident reports are unavailable.',
      ),
      next: RideArrivedPreviewPage(
        thai: thai,
        onNavigationSelected: onNavigationSelected,
      ),
      children: [
        PreviewRow(
          icon: Icons.directions_car_outlined,
          title: t(
            'ข้อมูลรถและคนขับ (ตัวอย่าง)',
            'Vehicle and driver (sample)',
          ),
          subtitle: t(
            'ทะเบียนและ PIN จะมาจากเซิร์ฟเวอร์',
            'Plate and PIN will come from the server',
          ),
        ),
      ],
    );
  }
}

/// U43 arrival and review.
class RideArrivedPreviewPage extends StatelessWidget {
  const RideArrivedPreviewPage({
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
      title: t('ถึงจุดหมายแล้ว', 'You have arrived'),
      onNavigationSelected: onNavigationSelected,
      cta: t('ส่งรีวิว', 'Submit review'),
      ctaReason: t(
        'ตัวอย่างเท่านั้น ไม่มีเที่ยวหรือค่าโดยสารจริงให้รีวิว',
        'Sample only. There is no real trip or fare to review.',
      ),
      children: [
        PreviewIntro(
          icon: Icons.check_circle_outline,
          text: t('ขอบคุณที่เดินทางด้วยกัน', 'Thanks for riding with us'),
        ),
        const SizedBox(height: 24),
        PreviewField(
          label: t('บอกเล่าประสบการณ์ของคุณ', 'Tell us about your ride'),
          value: t('เล่าประสบการณ์การเดินทาง…', 'Describe your ride…'),
        ),
      ],
    );
  }
}
