import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_layout.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

const _bg = Color(0xfff8f5fc);
const _ink = Color(0xff29183f);
const _purple = Color(0xff64188a);
const _tile = Color(0xffefe6f8);
const _border = Color(0xffe9e1f1);
const _muted = Color(0xff7b7088);

/// The ride calls this page needs, so tests can drive it without a network.
class DriverRideGateway {
  const DriverRideGateway({
    required this.current,
    required this.open,
    required this.accept,
    required this.arrive,
    required this.start,
    required this.complete,
    required this.cancel,
    required this.location,
    required this.consentLocation,
    required this.sendLocation,
    required this.positions,
  });
  factory DriverRideGateway.fromApi(MobileApi api) => DriverRideGateway(
    current: api.currentRide,
    open: api.openRides,
    accept: api.acceptRide,
    arrive: api.arriveRide,
    start: api.startRide,
    complete: api.completeRide,
    cancel: api.cancelRide,
    location: api.rideLocation,
    consentLocation: api.setRideLocationConsent,
    sendLocation: api.sendRideLocation,
    positions: rideForegroundPositions,
  );
  final Future<MobileRideCurrent> Function() current;
  final Future<MobileRideOpen> Function() open;
  final Future<MobileRideTrip> Function(String) accept,
      arrive,
      complete,
      cancel;
  final Future<MobileRideTrip> Function(String, String) start;
  final Future<MobileRideLocation> Function(String) location;
  final Future<MobileRideLocationConsent> Function(String, bool)
  consentLocation;
  final Future<MobileRideLocationConsent> Function(String, MobileRidePoint)
  sendLocation;
  final Future<Stream<MobileRidePoint>> Function() positions;
}

/// Foreground-only native location source. It does not request background
/// permission and stops when the passenger-jobs page closes.
Future<Stream<MobileRidePoint>> rideForegroundPositions() async {
  if (!await Geolocator.isLocationServiceEnabled())
    throw const MobileApiException('LOCATION_SERVICE_DISABLED', 409);
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied)
    permission = await Geolocator.requestPermission();
  if (permission == LocationPermission.denied ||
      permission == LocationPermission.deniedForever)
    throw MobileApiException(
      permission == LocationPermission.deniedForever
          ? 'LOCATION_PERMISSION_SETTINGS_REQUIRED'
          : 'LOCATION_PERMISSION_DENIED',
      403,
    );
  return Geolocator.getPositionStream(
    locationSettings: const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 10,
    ),
  ).map(
    (p) => MobileRidePoint(
      latitudeE7: (p.latitude * 10000000).round(),
      longitudeE7: (p.longitude * 10000000).round(),
    ),
  );
}

/// Minor units -> "75.00 THB" without floating point.
String rideMoney(MobileMoney m) {
  final digits = m.amountMinor.padLeft(m.decimals + 1, '0');
  final whole = digits.substring(0, digits.length - m.decimals);
  final frac = digits.substring(digits.length - m.decimals);
  return '$whole${m.decimals == 0 ? '' : '.$frac'} ${m.currency}';
}

String _coord(int e7) => (e7 / 1e7).toStringAsFixed(5);

/// Real passenger jobs for an approved driver (replaces the sample flow for live use).
/// Distance and duration are the rider's estimates; no payment or earning is shown or created.
class DriverRidesPage extends StatefulWidget {
  const DriverRidesPage({super.key, required this.gateway, required this.thai});
  final DriverRideGateway gateway;
  final bool thai;
  @override
  State<DriverRidesPage> createState() => _DriverRidesPageState();
}

class _DriverRidesPageState extends State<DriverRidesPage> {
  MobileRideTrip? _trip;
  List<MobileRideTrip> _open = const [];
  bool _loading = true, _busy = false;
  bool _locationSharing = false, _locationBusy = false;
  String? _error;
  StreamSubscription<MobileRidePoint>? _positions;
  Future<void> _uploads = Future<void>.value();
  final _pin = TextEditingController();
  String t(String th, String en) => widget.thai ? th : en;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    final trip = _trip;
    if (_locationSharing && trip != null)
      unawaited(
        widget.gateway
            .consentLocation(trip.id, false)
            .catchError((_) => MobileRideLocationConsent(enabled: false)),
      );
    unawaited(_positions?.cancel());
    _pin.dispose();
    super.dispose();
  }

  String _message(Object error) {
    final code = error is MobileApiException ? error.code : '';
    return switch (code) {
      'PIN_INVALID' => t(
        'PIN ไม่ถูกต้อง',
        'Wrong PIN. Ask the passenger to check it.',
      ),
      'PIN_LOCKED' => t(
        'PIN ถูกล็อก ยกเลิกเที่ยวนี้',
        'PIN locked after 3 wrong tries. Cancel this trip.',
      ),
      'DRIVER_NOT_APPROVED' => t(
        'บัญชียังไม่ได้รับอนุมัติให้รับงานผู้โดยสาร',
        'Your account is not approved for passenger jobs.',
      ),
      'DRIVER_BUSY' => t(
        'คุณมีเที่ยวที่ยังไม่จบ',
        'You already have an unfinished trip.',
      ),
      'TRIP_STATE_CONFLICT' => t(
        'สถานะเที่ยวเปลี่ยนไป โหลดใหม่แล้ว',
        'The trip changed. Reloaded.',
      ),
      'RESOURCE_NOT_FOUND' => t(
        'ไม่พบเที่ยวนี้ อาจถูกรับไปแล้ว',
        'Trip not found; another driver may have taken it.',
      ),
      'LOCATION_PERMISSION_DENIED' => t(
        'ไม่ได้อนุญาตตำแหน่ง',
        'Location permission was denied.',
      ),
      'LOCATION_PERMISSION_SETTINGS_REQUIRED' => t(
        'เปิดสิทธิ์ตำแหน่งใน Settings ก่อน',
        'Enable location permission in Settings.',
      ),
      'LOCATION_SERVICE_DISABLED' => t(
        'กรุณาเปิดบริการตำแหน่ง',
        'Turn on location services.',
      ),
      _ => t('ทำรายการไม่สำเร็จ ลองใหม่', 'Something went wrong. Try again.'),
    };
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final current = await widget.gateway.current();
      final open = current.trip == null
          ? (await widget.gateway.open()).trips
          : const <MobileRideTrip>[];
      if (!mounted) return;
      setState(() {
        _trip = current.trip;
        _open = open;
        _loading = false;
      });
      if (current.trip?.state == 'IN_TRIP') {
        final location = await widget.gateway.location(current.trip!.id);
        if (mounted && _trip?.id == current.trip!.id)
          setState(() => _locationSharing = location.enabled);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error);
        _loading = false;
      });
    }
  }

  Future<void> _run(Future<MobileRideTrip> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final next = await action();
      _pin.clear();
      if (!mounted) return;
      final finished = next.state == 'COMPLETED' || next.state == 'CANCELLED';
      setState(() {
        _trip = finished ? null : next;
        _busy = false;
      });
      if (finished) await _refresh();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error);
        _busy = false;
      });
      final code = error is MobileApiException ? error.code : '';
      if (code == 'TRIP_STATE_CONFLICT' || code == 'RESOURCE_NOT_FOUND')
        await _refresh();
    }
  }

  Future<void> _setLocation(bool enabled) async {
    final trip = _trip;
    if (trip == null || trip.state != 'IN_TRIP' || _locationBusy) return;
    setState(() {
      _locationBusy = true;
      _error = null;
    });
    try {
      if (enabled) {
        final stream = await widget.gateway.positions();
        await widget.gateway.consentLocation(trip.id, true);
        await _positions?.cancel();
        _positions = stream.listen(
          (point) {
            _uploads = _uploads
                .then((_) => widget.gateway.sendLocation(trip.id, point))
                .then<void>(
                  (_) {},
                  onError: (Object error, StackTrace stack) {
                    if (mounted) setState(() => _error = _message(error));
                  },
                );
          },
          onError: (Object error) {
            if (mounted) setState(() => _error = _message(error));
          },
        );
      } else {
        await _positions?.cancel();
        _positions = null;
        await widget.gateway.consentLocation(trip.id, false);
      }
      if (mounted) setState(() => _locationSharing = enabled);
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _locationBusy = false);
    }
  }

  Future<MobileRideTrip> _complete(MobileRideTrip trip) async {
    if (_locationSharing) await _setLocation(false);
    return widget.gateway.complete(trip.id);
  }

  Widget _card(List<Widget> children) => Container(
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: _border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: children,
    ),
  );

  Widget _summary(MobileRideTrip trip) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        rideMoney(trip.fare),
        key: const ValueKey('ride-fare'),
        style: const TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w600,
          color: _ink,
        ),
      ),
      const SizedBox(height: 4),
      Text(
        t(
          'ราคาจากระบบ ยังไม่มีการชำระเงินหรือรายได้ในหน้านี้',
          'Server fare. No payment or earning is created here.',
        ),
        style: const TextStyle(fontSize: 12, color: _muted),
      ),
      const SizedBox(height: 10),
      Text(
        '${t('รับ', 'Pickup')}: ${_coord(trip.pickup.latitudeE7)}, ${_coord(trip.pickup.longitudeE7)}',
      ),
      Text(
        '${t('ส่ง', 'Drop-off')}: ${_coord(trip.dropoff.latitudeE7)}, ${_coord(trip.dropoff.longitudeE7)}',
      ),
      Text(
        '${trip.seats} ${t('ที่นั่ง', trip.seats == 1 ? 'seat' : 'seats')}${trip.shared ? ' · ${t('แชร์', 'shared')}' : ''} · ~${(trip.distanceMetres / 1000).toStringAsFixed(1)} km (${t('ประมาณการ', 'rider estimate')})',
      ),
    ],
  );

  Widget _current(MobileRideTrip trip) {
    final id = trip.id;
    final actions = <Widget>[];
    if (trip.state == 'MATCHED') {
      actions.add(
        FilledButton(
          key: const ValueKey('ride-arrive'),
          onPressed: _busy ? null : () => _run(() => widget.gateway.arrive(id)),
          child: Text(t('ถึงจุดรับแล้ว', 'Arrived at pickup')),
        ),
      );
    } else if (trip.state == 'ARRIVED') {
      actions.addAll([
        TextField(
          key: const ValueKey('ride-pin-field'),
          controller: _pin,
          keyboardType: TextInputType.number,
          maxLength: 4,
          decoration: InputDecoration(
            labelText: t('PIN จากผู้โดยสาร', 'PIN from the passenger'),
            border: const OutlineInputBorder(),
          ),
          onChanged: (_) => setState(() {}),
        ),
        FilledButton(
          key: const ValueKey('ride-start'),
          onPressed: _busy || !RegExp(r'^\d{4}$').hasMatch(_pin.text)
              ? null
              : () => _run(() => widget.gateway.start(id, _pin.text)),
          child: Text(t('เริ่มเดินทาง', 'Start trip')),
        ),
      ]);
    } else if (trip.state == 'IN_TRIP') {
      actions.addAll([
        Material(
          color: Colors.transparent,
          child: SwitchListTile(
            key: const ValueKey('ride-location-sharing'),
            contentPadding: EdgeInsets.zero,
            value: _locationSharing,
            onChanged: _busy || _locationBusy ? null : _setLocation,
            title: Text(
              t('แชร์ตำแหน่งกับผู้โดยสาร', 'Share location with the passenger'),
            ),
            subtitle: Text(
              t(
                'เปิดเฉพาะเที่ยวนี้ พิกัดล่าสุดหมดอายุใน 60 วินาที และหยุดเมื่อออกจากหน้านี้',
                'For this trip only. The latest point expires after 60 seconds and stops when you leave this page.',
              ),
            ),
          ),
        ),
        FilledButton(
          key: const ValueKey('ride-complete'),
          onPressed: _busy ? null : () => _run(() => _complete(trip)),
          child: Text(t('จบเที่ยว', 'Complete trip')),
        ),
      ]);
    }
    if (trip.state == 'MATCHED' || trip.state == 'ARRIVED') {
      actions.add(
        OutlinedButton(
          key: const ValueKey('ride-cancel'),
          onPressed: _busy ? null : () => _run(() => widget.gateway.cancel(id)),
          child: Text(t('ยกเลิกเที่ยว', 'Cancel trip')),
        ),
      );
    }
    return _card([
      Text(
        switch (trip.state) {
          'MATCHED' => t(
            'รับงานแล้ว · ไปรับผู้โดยสาร',
            'Accepted · go to the passenger',
          ),
          'ARRIVED' => t(
            'ถึงแล้ว · ขอ PIN จากผู้โดยสาร',
            'Arrived · ask for the PIN',
          ),
          _ => t('กำลังเดินทาง', 'Trip in progress'),
        },
        key: const ValueKey('ride-state'),
        style: const TextStyle(fontWeight: FontWeight.w600, color: _purple),
      ),
      const SizedBox(height: 10),
      _summary(trip),
      const SizedBox(height: 14),
      for (final a in actions)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: SizedBox(width: double.infinity, child: a),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: _bg,
    appBar: bitPosAppBar(
      context,
      title: Text(
        t('งานผู้โดยสาร', 'Passenger jobs'),
        style: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: _ink,
        ),
      ),
      actions: [
        IconButton(
          key: const ValueKey('ride-refresh'),
          tooltip: t('โหลดใหม่', 'Refresh'),
          onPressed: _loading || _busy ? null : _refresh,
          icon: const Icon(Icons.refresh),
          constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        ),
        const SizedBox(width: 12),
      ],
    ),
    body: SafeArea(
      child: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
              children: [
                if (_error != null)
                  Container(
                    key: const ValueKey('ride-error'),
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: _tile,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(_error!, style: const TextStyle(color: _ink)),
                  ),
                if (_trip != null)
                  _current(_trip!)
                else if (_open.isEmpty && _error == null)
                  _card([
                    const SizedBox(height: 8),
                    const Center(
                      child: Icon(Icons.directions_car_outlined, size: 40),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: Text(
                        t(
                          'ยังไม่มีคำขอเดินทางใกล้คุณ',
                          'No open passenger requests right now.',
                        ),
                        key: const ValueKey('ride-empty'),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 8),
                  ])
                else
                  for (final trip in _open)
                    _card([
                      _summary(trip),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          key: ValueKey('ride-accept.${trip.id}'),
                          onPressed: _busy
                              ? null
                              : () =>
                                    _run(() => widget.gateway.accept(trip.id)),
                          child: Text(t('รับงานนี้', 'Accept this trip')),
                        ),
                      ),
                    ]),
              ],
            ),
    ),
  );
}
