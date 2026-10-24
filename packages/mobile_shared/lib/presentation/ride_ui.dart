import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'feature_ui.dart';

enum RideScreen {
  destination,
  vehicle,
  matching,
  passengerTrip,
  passengerReceipt,
  driverOffer,
  driverPickup,
  driverPin,
  driverTrip,
  driverFinished,
}

class UiRideVehicle {
  const UiRideVehicle({
    required this.id,
    required this.name,
    required this.details,
    required this.fare,
    required this.icon,
  });
  final String id, name, details, fare;
  final IconData icon;
}

class RideUiData {
  const RideUiData({
    required this.pickup,
    required this.destination,
    required this.fare,
    required this.eta,
    required this.distance,
    required this.person,
    required this.vehicle,
    required this.reference,
    required this.pin,
    required this.earnings,
    required this.waitLabel,
    required this.mapLabel,
  });
  final String pickup,
      destination,
      fare,
      eta,
      distance,
      person,
      vehicle,
      reference,
      pin,
      earnings,
      waitLabel,
      mapLabel;
}

/// No booking, GPS, payment or custody mutation: caller supplies facts/callbacks.
class RideFeaturePage extends StatefulWidget {
  const RideFeaturePage({
    super.key,
    required this.screen,
    required this.data,
    required this.thai,
    this.vehicles = const [],
    this.selectedVehicle,
    this.onVehicle,
    this.onNext,
    this.onCancel,
    this.onPickup,
    this.onDestination,
    this.onSafety,
    this.onDetails,
    this.onContact,
    this.onNavigate,
    this.onReceipt,
    this.onPin,
    this.onRating,
    this.notice,
  });
  final RideScreen screen;
  final RideUiData data;
  final bool thai;
  final List<UiRideVehicle> vehicles;
  final String? selectedVehicle, notice;
  final ValueChanged<String>? onVehicle, onPin;
  final ValueChanged<int>? onRating;
  final VoidCallback? onNext,
      onCancel,
      onPickup,
      onDestination,
      onSafety,
      onDetails,
      onContact,
      onNavigate,
      onReceipt;
  @override
  State<RideFeaturePage> createState() => _RideFeaturePageState();
}

class _RideFeaturePageState extends State<RideFeaturePage> {
  final pin = TextEditingController(), review = TextEditingController();
  int stars = 0;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void dispose() {
    pin.dispose();
    review.dispose();
    super.dispose();
  }

  Widget heading(String value) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Text(
      value,
      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
    ),
  );
  Widget map({double height = 280}) =>
      RouteIllustration(height: height, label: widget.data.mapLabel);
  Widget route() => Column(
    children: [
      FeatureTile(
        title: widget.data.pickup,
        subtitle: t('จุดรับ', 'Pickup'),
        icon: Icons.trip_origin,
        onTap: widget.onPickup,
      ),
      FeatureTile(
        title: widget.data.destination,
        subtitle: t('จุดหมาย', 'Destination'),
        icon: Icons.location_on_outlined,
        onTap: widget.onDestination,
      ),
    ],
  );
  Widget person() => FeatureTile(
    title: widget.data.person,
    subtitle: widget.data.vehicle,
    icon: Icons.person_outline,
    onTap: widget.onContact,
  );
  Widget support() => Wrap(
    spacing: 12,
    runSpacing: 8,
    children: [
      OutlinedButton.icon(
        onPressed: widget.onSafety,
        icon: const Icon(Icons.shield_outlined),
        label: Text(t('ความปลอดภัย', 'Safety')),
      ),
      OutlinedButton.icon(
        onPressed: widget.onDetails,
        icon: const Icon(Icons.receipt_long_outlined),
        label: Text(t('รายละเอียด', 'Details')),
      ),
    ],
  );
  Widget success(String message) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 24),
    child: Column(
      children: [
        CircleAvatar(
          radius: 54,
          child: Icon(
            Icons.check,
            size: 60,
            color: Theme.of(context).colorScheme.primary,
          ),
        ),
        const SizedBox(height: 24),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
        ),
      ],
    ),
  );
  @override
  Widget build(BuildContext context) {
    final d = widget.data;
    late String title, action;
    final children = <Widget>[];
    VoidCallback? next = widget.onNext;
    Widget? secondary;
    switch (widget.screen) {
      case RideScreen.destination:
        title = t('เดินทางกับ BitPOS', 'Travel with BitPOS');
        action = t('ค้นหารถ', 'Find a ride');
        children.addAll([
          map(),
          heading(t('วันนี้จะไปที่ไหน?', 'Where are you going?')),
          route(),
        ]);
      case RideScreen.vehicle:
        title = t('เลือกรถที่เหมาะกับคุณ', 'Choose your ride');
        action = t('ยืนยันเรียกรถ', 'Confirm ride');
        children.addAll([
          map(),
          heading(t('เลือกรถของคุณ', 'Your vehicle')),
          for (final v in widget.vehicles)
            FeatureTile(
              key: ValueKey('ride-vehicle.${v.id}'),
              title: v.name,
              subtitle: v.details,
              icon: v.icon,
              selected: widget.selectedVehicle == v.id,
              trailing: Text(v.fare),
              onTap: widget.onVehicle == null
                  ? null
                  : () => widget.onVehicle!(v.id),
            ),
        ]);
        if (widget.selectedVehicle == null) next = null;
      case RideScreen.matching:
        title = t('กำลังหาคนขับ', 'Finding a driver');
        action = t('ดูเที่ยวเดินทาง', 'View trip');
        children.addAll([
          map(),
          heading(t('กำลังค้นหาคนขับใกล้คุณ', 'Searching nearby drivers')),
          const LinearProgressIndicator(),
          const SizedBox(height: 24),
          route(),
          Text(d.fare),
        ]);
        secondary = TextButton(
          onPressed: widget.onCancel,
          child: Text(t('ยกเลิกการค้นหา', 'Cancel search')),
        );
      case RideScreen.passengerTrip:
        title = t('เดินทางอย่างอุ่นใจ', 'Your trip');
        action = t('รายละเอียดเที่ยวเดินทาง', 'Trip details');
        next = widget.onDetails;
        children.addAll([
          map(),
          heading(d.eta),
          person(),
          FeatureTile(
            title: 'PIN  ${d.pin}',
            subtitle: t(
              'แจ้งคนขับก่อนเริ่มเที่ยว',
              'Share with your driver before departure',
            ),
            icon: Icons.pin_outlined,
          ),
          support(),
        ]);
      case RideScreen.passengerReceipt:
        title = t('ถึงจุดหมายแล้ว', 'You have arrived');
        action = t('ส่งรีวิว', 'Submit review');
        next = stars == 0 ? null : widget.onNext;
        children.addAll([
          success(t('ขอบคุณที่เดินทางด้วยกัน', 'Thank you for riding with us')),
          Center(child: Text('${d.reference} · ${d.fare}')),
          const SizedBox(height: 28),
          Wrap(
            alignment: WrapAlignment.center,
            children: [
              for (var n = 1; n <= 5; n++)
                IconButton(
                  tooltip: '$n / 5',
                  onPressed: () {
                    setState(() => stars = n);
                    widget.onRating?.call(n);
                  },
                  icon: Icon(
                    n <= stars ? Icons.star : Icons.star_outline,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),
          TextField(
            controller: review,
            maxLength: 1000,
            minLines: 2,
            maxLines: 4,
            decoration: InputDecoration(
              labelText: t(
                'บอกเล่าประสบการณ์ของคุณ',
                'Tell us about your trip',
              ),
            ),
          ),
        ]);
        secondary = TextButton(
          onPressed: widget.onReceipt,
          child: Text(t('ดูใบเสร็จ', 'View receipt')),
        );
      case RideScreen.driverOffer:
        title = t('งานรับส่งผู้โดยสาร', 'Passenger trip offer');
        action = t('รับงานนี้', 'Accept trip');
        children.addAll([
          map(height: 180),
          heading(t('งานรับส่งผู้โดยสาร', 'Passenger trip')),
          Text(d.earnings),
          const SizedBox(height: 12),
          Text('${d.distance} · ${d.eta}'),
          const SizedBox(height: 24),
          route(),
        ]);
        secondary = TextButton(
          onPressed: widget.onCancel,
          child: Text(t('ข้ามงาน', 'Skip offer')),
        );
      case RideScreen.driverPickup:
        title = t('ถึงจุดรับผู้โดยสาร', 'Passenger pickup');
        action = t('ผู้โดยสารมาถึงแล้ว', 'Passenger has arrived');
        children.addAll([
          Text(d.reference),
          const SizedBox(height: 24),
          FeatureTile(
            title: d.pickup,
            subtitle: d.person,
            icon: Icons.location_on_outlined,
          ),
          heading(t('ยืนยันก่อนเริ่มเที่ยว', 'Confirm before departure')),
          FeatureHero(
            title: d.waitLabel,
            subtitle: t('เวลารอผู้โดยสาร', 'Passenger wait time'),
            icon: Icons.timer_outlined,
          ),
          OutlinedButton.icon(
            onPressed: widget.onContact,
            icon: const Icon(Icons.chat_bubble_outline),
            label: Text(t('ติดต่อผู้โดยสาร', 'Contact passenger')),
          ),
        ]);
      case RideScreen.driverPin:
        title = t('ยืนยันก่อนเริ่มเดินทาง', 'Confirm trip PIN');
        action = t('ยืนยัน PIN และเริ่มเที่ยว', 'Verify PIN and start trip');
        next = RegExp(r'^\d{4}$').hasMatch(pin.text)
            ? () => widget.onPin?.call(pin.text)
            : null;
        if (widget.onPin == null) next = null;
        children.addAll([
          Text(d.reference),
          const SizedBox(height: 24),
          FeatureTile(
            title: d.pickup,
            subtitle: d.person,
            icon: Icons.location_on_outlined,
          ),
          heading(t('ยืนยันก่อนเริ่มเที่ยว', 'Confirm before departure')),
          Text(
            t(
              'กรอก PIN ที่ผู้โดยสารแจ้งให้คุณ',
              'Enter the PIN supplied by the passenger',
            ),
          ),
          const SizedBox(height: 32),
          TextField(
            key: const ValueKey('ride-pin-input'),
            controller: pin,
            keyboardType: TextInputType.number,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(4),
            ],
            onChanged: (_) => setState(() {}),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 32, letterSpacing: 20),
            decoration: InputDecoration(
              labelText: t('PIN 4 หลัก', '4-digit PIN'),
              counterText: '',
            ),
          ),
        ]);
      case RideScreen.driverTrip:
        title = t('กำลังเดินทาง', 'Trip in progress');
        action = t('จบเที่ยวเดินทาง', 'Complete trip');
        children.addAll([
          map(height: 340),
          heading('${d.eta} · ${d.distance}'),
          Text(d.destination),
          const SizedBox(height: 20),
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: widget.onNavigate,
                icon: const Icon(Icons.navigation_outlined),
                label: Text(t('นำทาง', 'Navigate')),
              ),
              OutlinedButton.icon(
                onPressed: widget.onContact,
                icon: const Icon(Icons.chat_bubble_outline),
                label: Text(t('แชท', 'Chat')),
              ),
            ],
          ),
        ]);
      case RideScreen.driverFinished:
        title = t('จบเที่ยวเดินทาง', 'Trip complete');
        action = t('พร้อมรับงานถัดไป', 'Ready for the next trip');
        children.addAll([
          success(t('จบเที่ยวเดินทางแล้ว', 'Trip completed')),
          FeatureHero(
            title: d.earnings,
            subtitle: d.reference,
            icon: Icons.account_balance_wallet_outlined,
          ),
          FeatureTile(
            title: t('รายละเอียดรายได้', 'Earnings details'),
            subtitle: t(
              'ดูสถานะจากระบบรายได้',
              'Check the earnings system for status',
            ),
            icon: Icons.receipt_long,
            onTap: widget.onReceipt,
          ),
        ]);
    }
    return FeaturePage(
      title: title,
      actionLabel: action,
      action: next,
      secondary: secondary,
      notice: widget.notice,
      children: children,
    );
  }
}
