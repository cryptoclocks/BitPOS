import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_layout.dart';

import 'driver_navigation.dart';

const _bg = Color(0xfff8f5fc);
const _ink = Color(0xff29183f);
const _purple = Color(0xff64188a);
const _tile = Color(0xffefe6f8);
const _border = Color(0xffe9e1f1);
const _muted = Color(0xff7b7088);

/// Presentation-only passenger job flow (R27-R31). No assignment, PIN, fare or
/// earning is produced here: primary actions stay disabled with a reason and
/// the only enabled control walks to the next sample screen.
class PassengerPreviewFrame extends StatelessWidget {
  const PassengerPreviewFrame({
    super.key,
    required this.thai,
    required this.title,
    required this.heading,
    required this.children,
    required this.cta,
    required this.ctaReason,
    this.next,
  });
  final bool thai;
  final String title, heading, cta, ctaReason;
  final List<Widget> children;
  final Widget? next;

  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return Scaffold(
      backgroundColor: _bg,
      bottomNavigationBar: SafeArea(
        top: false,
        child: DriverNavigation(thai: thai, selectedIndex: 3),
      ),
      appBar: AppBar(
        backgroundColor: _bg,
        toolbarHeight: 72,
        leadingWidth: BitPosLayout.leadingWidth,
        titleSpacing: 0,
        leading: const BitPosBackButton(),
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
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          children: [
            Align(
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
                    'ตัวอย่างขั้นตอน · ไม่ใช่งานจริง',
                    'Sample flow · not a real job',
                  ),
                  key: const ValueKey('passenger-sample-badge'),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: _purple,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
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
            const SizedBox(height: 16),
            Text(
              ctaReason,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: _muted),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: null,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: Text(cta),
            ),
            if (next != null) ...[
              const SizedBox(height: 10),
              OutlinedButton(
                key: const ValueKey('passenger-next-sample'),
                onPressed: () =>
                    Navigator.of(context)
                        .push(MaterialPageRoute<void>(builder: (_) => next!)),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                  foregroundColor: _purple,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                child: Text(
                  t('ดูขั้นตอนถัดไป (ตัวอย่าง)', 'View next sample step'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.icon, this.title, this.subtitle);
  final IconData icon;
  final String title, subtitle;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Container(
      constraints: const BoxConstraints(minHeight: 82),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _border),
      ),
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
        ],
      ),
    ),
  );
}

/// R27 passenger job offer.
class PassengerOfferPreviewPage extends StatelessWidget {
  const PassengerOfferPreviewPage({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PassengerPreviewFrame(
      thai: thai,
      title: t('งานรับส่งผู้โดยสาร', 'Passenger job'),
      heading: t(
        'รายได้จะแสดงจากใบเสนอราคาจริง',
        'Earnings come from a real quote',
      ),
      cta: t('รับงานนี้', 'Accept this job'),
      ctaReason: t(
        'ยังไม่มีงานผู้โดยสารจริง จึงรับงานไม่ได้',
        'There is no real passenger job, so nothing can be accepted.',
      ),
      next: PassengerArrivalPreviewPage(thai: thai),
      children: [
        _Fact(
          Icons.my_location,
          t('จุดรับ (ตัวอย่าง)', 'Pickup (sample)'),
          t(
            'ระยะห่างจะมาจากตำแหน่งที่ยินยอมแชร์',
            'Distance will use location you consented to share',
          ),
        ),
        _Fact(
          Icons.flag_outlined,
          t('จุดส่ง (ตัวอย่าง)', 'Drop-off (sample)'),
          t('รายละเอียดหลังรับงาน', 'Details after acceptance'),
        ),
      ],
    );
  }
}

/// R28 arrival at pickup.
class PassengerArrivalPreviewPage extends StatelessWidget {
  const PassengerArrivalPreviewPage({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PassengerPreviewFrame(
      thai: thai,
      title: t('ถึงจุดรับผู้โดยสาร', 'Arrived at pickup'),
      heading: t('แจ้งถึงจุดรับ', 'Confirm arrival'),
      cta: t('ถึงจุดรับแล้ว', 'I have arrived'),
      ctaReason: t(
        'การแจ้งถึงต้องใช้ตำแหน่งที่เซิร์ฟเวอร์ยืนยัน ตัวอย่างนี้ไม่ส่งสถานะ',
        'Arrival needs server-verified location. This sample sends no status.',
      ),
      next: PassengerPinPreviewPage(thai: thai),
      children: [
        _Fact(
          Icons.place_outlined,
          t('จุดนัดรับ (ตัวอย่าง)', 'Meeting point (sample)'),
          t(
            'ผู้โดยสารจะเห็นสถานะเมื่อมีเที่ยวจริง',
            'The passenger sees status once a real trip exists',
          ),
        ),
      ],
    );
  }
}

/// R29 PIN before trip.
class PassengerPinPreviewPage extends StatelessWidget {
  const PassengerPinPreviewPage({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PassengerPreviewFrame(
      thai: thai,
      title: t('ยืนยันก่อนเริ่มเดินทาง', 'Confirm before starting'),
      heading: t('ยืนยันก่อนเริ่มเที่ยว', 'Confirm before the trip'),
      cta: t('ยืนยัน PIN และเริ่มเที่ยว', 'Confirm PIN and start'),
      ctaReason: t(
        'ไม่มี PIN จริง ช่องกรอกนี้ไม่ตรวจหรือบันทึกรหัส',
        'No real PIN exists. Nothing is checked or stored here.',
      ),
      next: PassengerTripPreviewPage(thai: thai),
      children: [
        Text(
          t(
            'กรอก PIN ที่ผู้โดยสารแจ้งให้คุณ',
            'Enter the PIN the passenger gives you',
          ),
          style: const TextStyle(color: _muted),
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            for (var i = 0; i < 4; i++)
              Container(
                width: 72,
                height: 76,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: _border),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// R30 trip in progress.
class PassengerTripPreviewPage extends StatelessWidget {
  const PassengerTripPreviewPage({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PassengerPreviewFrame(
      thai: thai,
      title: t('กำลังเดินทาง', 'Trip in progress'),
      heading: t('นำทางไปจุดหมาย', 'Navigate to destination'),
      cta: t('ถึงจุดหมายแล้ว', 'Arrived at destination'),
      ctaReason: t(
        'ยังไม่มีเส้นทางหรือค่าโดยสารจริง การแจ้งความปลอดภัยต้องมีเที่ยวจริง',
        'No real route or fare. Safety reports need a real trip.',
      ),
      next: PassengerCompletePreviewPage(thai: thai),
      children: [
        _Fact(
          Icons.navigation_outlined,
          t('เส้นทาง (ตัวอย่าง)', 'Route (sample)'),
          t(
            'ไม่มีผู้ให้บริการแผนที่เชื่อมอยู่',
            'No map provider is connected',
          ),
        ),
      ],
    );
  }
}

/// R31 trip complete.
class PassengerCompletePreviewPage extends StatelessWidget {
  const PassengerCompletePreviewPage({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return PassengerPreviewFrame(
      thai: thai,
      title: t('จบเที่ยวเดินทาง', 'Trip complete'),
      heading: t('สรุปเที่ยว', 'Trip summary'),
      cta: t('กลับไปรับงาน', 'Back to work'),
      ctaReason: t(
        'ตัวอย่างเท่านั้น ไม่มีรายได้หรือยอดโอนจากเที่ยวนี้',
        'Sample only. This trip produces no earning or transfer.',
      ),
      children: [
        _Fact(
          Icons.receipt_long_outlined,
          t('รายได้ (ยังไม่มี)', 'Earning (none yet)'),
          t(
            'รายได้จริงมาจากบัญชีรายได้ของเซิร์ฟเวอร์',
            'Real earnings come from the server ledger',
          ),
        ),
      ],
    );
  }
}
