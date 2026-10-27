import 'package:flutter/material.dart';

import 'feature_ui.dart';
import 'ride_ui.dart';

enum UiPreviewStatus { ready, loading, empty, error, offline }

const missingUiScreens = <String, String>{
  'U26': 'คูปองของคุณ',
  'U35': 'สั่งล่วงหน้า',
  'U36': 'อร่อยด้วยกัน',
  'U37': 'เลือกอร่อยจากหลายร้าน',
  'U39': 'เดินทางกับ BitPOS',
  'U40': 'เลือกรถที่เหมาะกับคุณ',
  'U41': 'กำลังหาคนขับ',
  'U42': 'เดินทางอย่างอุ่นใจ',
  'U43': 'ถึงจุดหมายแล้ว',
  'R27': 'งานรับส่งผู้โดยสาร',
  'R28': 'ถึงจุดรับผู้โดยสาร',
  'R29': 'ยืนยันก่อนเริ่มเดินทาง',
  'R30': 'กำลังเดินทาง',
  'R31': 'จบเที่ยวเดินทาง',
};
const _english = <String, String>{
  'U26': 'Your coupons',
  'U35': 'Schedule an order',
  'U36': 'Order together',
  'U37': 'Orders from multiple merchants',
  'U39': 'Travel with BitPOS',
  'U40': 'Choose your ride',
  'U41': 'Finding a driver',
  'U42': 'Your trip',
  'U43': 'You have arrived',
  'R27': 'Passenger trip offer',
  'R28': 'Passenger pickup',
  'R29': 'Confirm trip PIN',
  'R30': 'Trip in progress',
  'R31': 'Trip complete',
};

/// Compile-time opt-in catalog. Contains no API client, wallet or provider.
class BitPosUiCatalog extends StatefulWidget {
  const BitPosUiCatalog({super.key, required this.rider});
  final bool rider;
  @override
  State<BitPosUiCatalog> createState() => _BitPosUiCatalogState();
}

class _BitPosUiCatalogState extends State<BitPosUiCatalog> {
  bool thai = true;
  UiPreviewStatus status = UiPreviewStatus.ready;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('BitPOS · UI catalog'),
      actions: [
        PopupMenuButton<UiPreviewStatus>(
          tooltip: 'UI states',
          initialValue: status,
          onSelected: (value) => setState(() => status = value),
          itemBuilder: (_) => [
            for (final value in UiPreviewStatus.values)
              PopupMenuItem(value: value, child: Text(value.name)),
          ],
        ),
        TextButton(
          onPressed: () => setState(() => thai = !thai),
          child: Text(thai ? 'English' : 'ไทย'),
        ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          thai
              ? 'แบบ UI เท่านั้น · ข้อมูลสมมติ · ไม่เชื่อมบริการจริง'
              : 'UI preview only · fictional data · no live services',
        ),
        const SizedBox(height: 20),
        for (final e in missingUiScreens.entries.where(
          (e) => widget.rider ? e.key.startsWith('R') : e.key.startsWith('U'),
        ))
          ListTile(
            key: ValueKey('catalog.${e.key}'),
            title: Text('${e.key} · ${thai ? e.value : _english[e.key]}'),
            subtitle: Text(
              e.key.startsWith('R') || int.parse(e.key.substring(1)) >= 39
                  ? (thai
                        ? 'รับส่งผู้โดยสาร · เฟสถัดไป'
                        : 'Passenger service · later phase')
                  : (thai
                        ? 'ชุด UI ก่อนเชื่อมบริการ'
                        : 'Presentation before integration'),
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute<void>(
                builder: (_) => UiPreviewRoute(
                  id: e.key,
                  thai: thai,
                  initialStatus: status,
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

class UiPreviewRoute extends StatefulWidget {
  const UiPreviewRoute({
    super.key,
    required this.id,
    required this.thai,
    this.vehicleId,
    this.initialStatus = UiPreviewStatus.ready,
  });
  final UiPreviewStatus initialStatus;
  final String? vehicleId;
  final String id;
  final bool thai;
  @override
  State<UiPreviewRoute> createState() => _UiPreviewRouteState();
}

class _UiPreviewRouteState extends State<UiPreviewRoute> {
  String? coupon, vehicle;
  late UiPreviewStatus status;
  DateTime day = DateTime(2026, 10, 17);
  String slot = '08:30–09:00';
  final group = TextEditingController();
  String t(String th, String en) => widget.thai ? th : en;
  String get notice => t(
    'ตัวอย่าง UI · ข้อมูลสมมติ · ยังไม่เชื่อมบริการจริง',
    'UI preview · fictional data · services are not connected',
  );
  @override
  void initState() {
    super.initState();
    group.text = t('มื้อเช้าทีมเรา', 'Our team breakfast');
    vehicle = widget.vehicleId;
    status = widget.initialStatus;
  }

  @override
  void dispose() {
    group.dispose();
    super.dispose();
  }

  void open(String id) => Navigator.push(
    context,
    MaterialPageRoute<void>(
      builder: (_) =>
          UiPreviewRoute(id: id, thai: widget.thai, vehicleId: vehicle),
    ),
  );
  void preview(String text) => showDialog<void>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(t('ตัวอย่าง UI', 'UI preview')),
      content: Text('$text\n\n$notice'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c),
          child: Text(t('ปิด', 'Close')),
        ),
      ],
    ),
  );
  Future<void> chooseDay() async {
    final value = await showDatePicker(
      context: context,
      initialDate: day,
      firstDate: DateTime(2026),
      lastDate: DateTime(2027),
    );
    if (value != null && mounted) setState(() => day = value);
  }

  Future<void> chooseSlot() async {
    final value = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final s in ['08:30–09:00', '09:00–09:30', '12:00–12:30'])
              ListTile(title: Text(s), onTap: () => Navigator.pop(c, s)),
          ],
        ),
      ),
    );
    if (value != null && mounted) setState(() => slot = value);
  }

  @override
  Widget build(BuildContext context) => Banner(
    message: 'UI PREVIEW',
    location: BannerLocation.topEnd,
    child: FeatureUiScope(
      navigation: _navigation(context),
      child: _page(context),
    ),
  );

  Widget _navigation(BuildContext context) {
    final rider = widget.id.startsWith('R');
    return NavigationBarTheme(
      data: NavigationBarThemeData(
        backgroundColor: Theme.of(context).brightness == Brightness.dark
            ? Theme.of(context).colorScheme.surface
            : Colors.white,
        indicatorColor: Colors.transparent,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 11,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w400,
            color: states.contains(WidgetState.selected)
                ? const Color(0xff64188a)
                : const Color(0xff7b7088),
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            size: 22,
            color: states.contains(WidgetState.selected)
                ? const Color(0xff64188a)
                : const Color(0xff7b7088),
          ),
        ),
      ),
      child: NavigationBar(
        height: 62,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        selectedIndex: 0,
        onDestinationSelected: (index) {
          if (index == 0) {
            Navigator.maybePop(context);
          } else {
            preview(t('เมนูตัวอย่าง', 'Navigation preview'));
          }
        },
        destinations: [
          NavigationDestination(
            icon: Icon(rider ? Icons.two_wheeler : Icons.home_outlined),
            label: t(rider ? 'รับงาน' : 'หน้าแรก', rider ? 'Work' : 'Home'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.receipt_long_outlined),
            label: t('กิจกรรม', 'Activity'),
          ),
          NavigationDestination(
            icon: Icon(
              rider
                  ? Icons.account_balance_wallet_outlined
                  : Icons.favorite_border,
            ),
            label: t(
              rider ? 'รายได้' : 'รายการโปรด',
              rider ? 'Earnings' : 'Favourites',
            ),
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline),
            label: t('บัญชี', 'Account'),
          ),
        ],
      ),
    );
  }

  Widget _page(BuildContext context) {
    final title = widget.thai
        ? missingUiScreens[widget.id]!
        : _english[widget.id]!;
    if (status != UiPreviewStatus.ready) {
      final message = switch (status) {
        UiPreviewStatus.loading => t('กำลังโหลดข้อมูล', 'Loading'),
        UiPreviewStatus.empty => t(
          'ยังไม่มีข้อมูลสำหรับหน้านี้',
          'Nothing here yet',
        ),
        UiPreviewStatus.offline => t(
          'ออฟไลน์ · ตรวจสอบการเชื่อมต่อ',
          'Offline · check your connection',
        ),
        _ => t('ยังโหลดข้อมูลไม่ได้ ลองอีกครั้ง', 'Unable to load. Try again'),
      };
      return FeaturePage(
        title: title,
        actionLabel: status == UiPreviewStatus.loading
            ? null
            : t('ลองอีกครั้ง', 'Try again'),
        action: () => setState(() => status = UiPreviewStatus.ready),
        children: [
          const SizedBox(height: 72),
          if (status == UiPreviewStatus.loading)
            const Center(child: CircularProgressIndicator())
          else
            Icon(
              status == UiPreviewStatus.offline
                  ? Icons.cloud_off_outlined
                  : Icons.inbox_outlined,
              size: 64,
            ),
          const SizedBox(height: 24),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          Text(notice, textAlign: TextAlign.center),
        ],
      );
    }
    switch (widget.id) {
      case 'U26':
        return CouponSelectionPage(
          title: title,
          selected: coupon,
          sectionLabel: t('คูปองที่ใช้ได้', 'Available coupons'),
          onSelect: (v) => setState(() => coupon = v),
          notice: notice,
          applyLabel: t('ดูคูปองที่เลือก', 'View selected coupon'),
          onApply: () => preview(coupon!),
          hero: CouponOfferBanner(
            amount: t('ลดทันที ฿20', '฿20 off'),
            title: t('สิทธิพิเศษสำหรับคุณ', 'Offers for you'),
            subtitle: t(
              'เลือกใช้ก่อนยืนยันออเดอร์',
              'Choose before confirming an order',
            ),
          ),
          coupons: [
            UiCoupon(
              id: 'breakfast',
              title: t('มื้อเช้าคู่โปรด · ลด ฿20', 'Breakfast · ฿20 off'),
              terms: t('ตัวอย่าง · ขั้นต่ำ ฿150', 'Example · minimum ฿150'),
            ),
            UiCoupon(
              id: 'delivery',
              title: t('ส่งฟรีใกล้บ้าน', 'Nearby free delivery'),
              terms: t(
                'ตัวอย่าง · ระยะทางไม่เกิน 3 กม.',
                'Example · within 3 km',
              ),
            ),
            UiCoupon(
              id: 'reward',
              title: t('แลกเครื่องดื่ม 1 แก้ว', 'Redeem one drink'),
              terms: t('ตัวอย่าง · ใช้ 500 แต้ม', 'Example · 500 points'),
            ),
          ],
        );
      case 'U35':
        return ScheduleOrderPage(
          title: title,
          thai: widget.thai,
          day: '${day.day}/${day.month}/${day.year}',
          slot: slot,
          merchant:
              'BitPOS Coffee House · ${t('ร้านตัวอย่าง', 'example merchant')}',
          onDay: chooseDay,
          onSlot: chooseSlot,
          onConfirm: () => preview('$day · $slot'),
        );
      case 'U36':
        return GroupOrderPage(
          title: title,
          thai: widget.thai,
          nameController: group,
          members: [
            (
              name: t(
                'นัท · ผู้สร้างกลุ่มตัวอย่าง',
                'Nat · example group owner',
              ),
              summary: t('2 รายการตัวอย่าง · ฿170', '2 example items · ฿170'),
            ),
          ],
          onInvite: () =>
              preview(t('ตัวอย่างลิงก์เชิญกลุ่ม', 'Group invitation preview')),
          onShare: () => preview(group.text),
        );
      case 'U37':
        return MultiMerchantPage(
          title: title,
          thai: widget.thai,
          orders: [
            UiMerchantOrder(
              id: 'coffee',
              name: 'BitPOS Coffee House',
              summary: t('2 รายการตัวอย่าง · ฿170', '2 example items · ฿170'),
            ),
            UiMerchantOrder(
              id: 'bake',
              name: 'Morning Bake',
              summary: t('1 รายการตัวอย่าง · ฿75', '1 example item · ฿75'),
            ),
          ],
          onOpen: (id) => preview(id),
          onReview: () => preview(
            t('ตรวจออเดอร์แยกแต่ละร้าน', 'Review separate merchant orders'),
          ),
        );
    }
    final screens = <String, RideScreen>{
      'U39': RideScreen.destination,
      'U40': RideScreen.vehicle,
      'U41': RideScreen.matching,
      'U42': RideScreen.passengerTrip,
      'U43': RideScreen.passengerReceipt,
      'R27': RideScreen.driverOffer,
      'R28': RideScreen.driverPickup,
      'R29': RideScreen.driverPin,
      'R30': RideScreen.driverTrip,
      'R31': RideScreen.driverFinished,
    };
    final next = <String, String>{
      'U39': 'U40',
      'U40': 'U41',
      'U41': 'U42',
      'R27': 'R28',
      'R28': 'R29',
      'R30': 'R31',
      'R31': 'R27',
    };
    return RideFeaturePage(
      screen: screens[widget.id]!,
      thai: widget.thai,
      notice: notice,
      data: RideUiData(
        pickup: t(
          'บ้าน · สุขุมวิท 49 (ตัวอย่าง)',
          'Home · Sukhumvit49 (example)',
        ),
        destination: 'EmQuartier (${t('ตัวอย่าง', 'example')})',
        fare: vehicle == 'bike' ? '฿65' : '฿149',
        eta: t('ประมาณ 12 นาที · ตัวอย่าง', 'About12 min · example'),
        distance: '3.2 km',
        person: widget.id.startsWith('R')
            ? t('นัท · ผู้โดยสารตัวอย่าง', 'Nat · example passenger')
            : t('ปกรณ์ · คนขับตัวอย่าง', 'Pakorn · example driver'),
        vehicle: vehicle == 'bike'
            ? 'BitPOS Bike · ${t('ทะเบียนตัวอย่าง', 'example plate')}'
            : 'Toyota Corolla · ${t('ทะเบียนตัวอย่าง', 'example plate')}',
        reference: 'DEMO-BP1024',
        pin: '4821',
        earnings: '฿129',
        waitLabel: '02:15',
        mapLabel: t(
          'แผนที่ตัวอย่าง · ไม่ใช่ GPS จริง',
          'Schematic preview · not real GPS',
        ),
      ),
      vehicles: [
        UiRideVehicle(
          id: 'car',
          name: 'BitPOS Car',
          details: t('ตัวอย่าง · 4 ที่นั่ง', 'Example · 4 seats'),
          fare: '฿149',
          icon: Icons.directions_car_outlined,
        ),
        UiRideVehicle(
          id: 'bike',
          name: 'BitPOS Bike',
          details: t('ตัวอย่าง · 1 ที่นั่ง', 'Example · 1 seat'),
          fare: '฿65',
          icon: Icons.two_wheeler,
        ),
      ],
      selectedVehicle: vehicle,
      onVehicle: (v) => setState(() => vehicle = v),
      onNext: () {
        if (next.containsKey(widget.id)) {
          open(next[widget.id]!);
        } else {
          preview(t('ตัวอย่างการส่งรีวิว', 'Review submission preview'));
        }
      },
      onPin: (value) {
        if (value == '4821') {
          open('R30');
        } else {
          preview(t('PIN ตัวอย่างไม่ตรงกัน', 'Example PIN does not match'));
        }
      },
      onCancel: () => Navigator.maybePop(context),
      onPickup: () =>
          preview(t('เลือกจุดรับตัวอย่าง', 'Choose example pickup')),
      onDestination: () =>
          preview(t('เลือกจุดหมายตัวอย่าง', 'Choose example destination')),
      onSafety: () =>
          preview(t('ศูนย์ความปลอดภัยตัวอย่าง', 'Safety center preview')),
      onDetails: () => open('U43'),
      onContact: () => preview(
        t('หน้าติดต่อ · ยังไม่ส่งข้อความ', 'Contact preview · no message sent'),
      ),
      onNavigate: () => preview(
        t(
          'ตัวอย่างนำทาง · ไม่เปิด GPS',
          'Navigation preview · GPS not started',
        ),
      ),
      onReceipt: () => preview(
        t(
          'ใบเสร็จตัวอย่าง · ไม่ใช่หลักฐานชำระเงิน',
          'Example receipt · not payment evidence',
        ),
      ),
    );
  }
}
