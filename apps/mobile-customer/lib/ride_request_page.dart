import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

const _bg = Color(0xfff8f5fc);
const _ink = Color(0xff29183f);
const _purple = Color(0xff64188a);
const _tile = Color(0xffefe6f8);
const _border = Color(0xffe9e1f1);
const _muted = Color(0xff7b7088);

/// Distance and duration have no route provider yet: they are estimated from the straight-line
/// distance (x1.3 for roads, 25 km/h average) and labelled as estimates on screen.
class RideEstimate {
  const RideEstimate(this.distanceMetres, this.durationSeconds);
  final int distanceMetres, durationSeconds;
  factory RideEstimate.between(MobileRidePoint a, MobileRidePoint b) {
    const r = 6371000.0, toRad = math.pi / 180 / 1e7;
    final la1 = a.latitudeE7 * toRad, la2 = b.latitudeE7 * toRad;
    final dLa = la2 - la1, dLo = (b.longitudeE7 - a.longitudeE7) * toRad;
    final h =
        math.pow(math.sin(dLa / 2), 2) +
        math.cos(la1) * math.cos(la2) * math.pow(math.sin(dLo / 2), 2);
    final line = 2 * r * math.asin(math.sqrt(h.toDouble()));
    final metres = (line * 1.3).round().clamp(100, 500000);
    final seconds = (metres / (25000 / 3600)).round().clamp(60, 86400);
    return RideEstimate(metres, seconds);
  }
}

/// Replaceable route boundary. The local estimator remains the explicit fallback
/// until an authenticated route provider is configured and tested.
abstract interface class RideRouteProvider {
  Future<RideEstimate> estimate(
    MobileRidePoint pickup,
    MobileRidePoint dropoff,
  );
}

class LocalRideRouteEstimator implements RideRouteProvider {
  const LocalRideRouteEstimator();
  @override
  Future<RideEstimate> estimate(
    MobileRidePoint pickup,
    MobileRidePoint dropoff,
  ) async => RideEstimate.between(pickup, dropoff);
}

/// RFC 4122 version 4 id from a secure random source (the idempotency key for a ride request).
String newRideKey([math.Random? random]) {
  final r = random ?? math.Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
  return '${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}';
}

String rideMoneyText(MobileMoney m) {
  final digits = m.amountMinor.padLeft(m.decimals + 1, '0');
  final whole = digits.substring(0, digits.length - m.decimals);
  final frac = digits.substring(digits.length - m.decimals);
  return '$whole${m.decimals == 0 ? '' : '.$frac'} ${m.currency}';
}

class RiderRideGateway {
  const RiderRideGateway({
    required this.addresses,
    required this.current,
    required this.quote,
    required this.request,
    required this.cancel,
    required this.share,
    required this.revoke,
    required this.report,
    required this.location,
  });
  factory RiderRideGateway.fromApi(MobileApi api) => RiderRideGateway(
    addresses: () async =>
        (await api.addresses()).addresses.where((a) => !a.archived).toList(),
    current: api.currentRide,
    quote: api.quoteRide,
    request: api.requestRide,
    cancel: api.cancelRide,
    share: api.shareRide,
    revoke: api.revokeRideShares,
    report: api.reportRideIncident,
    location: api.rideLocation,
  );
  final Future<List<MobileAddress>> Function() addresses;
  final Future<MobileRideCurrent> Function() current;
  final Future<MobileRideQuote> Function(MobileRideQuoteRequest) quote;
  final Future<MobileRideRequested> Function(MobileRideRequest) request;
  final Future<MobileRideTrip> Function(String) cancel;
  final Future<MobileRideShare> Function(String) share;
  final Future<MobileRideShareRevoked> Function(String) revoke;
  final Future<MobileRideIncidentReceipt> Function(String, String, String)
  report;
  final Future<MobileRideLocation> Function(String) location;
}

/// Request a ride between two saved addresses, follow it, cancel it, share a safety link and
/// report a problem. No payment is taken here: the fare is the server's quote only.
class RideRequestPage extends StatefulWidget {
  const RideRequestPage({
    super.key,
    required this.gateway,
    required this.thai,
    this.pollInterval = const Duration(seconds: 5),
    this.routeProvider = const LocalRideRouteEstimator(),
  });
  final RiderRideGateway gateway;
  final bool thai;
  final Duration? pollInterval;
  final RideRouteProvider routeProvider;
  @override
  State<RideRequestPage> createState() => _RideRequestPageState();
}

class _RideRequestPageState extends State<RideRequestPage> {
  List<MobileAddress> _addresses = const [];
  MobileRideTrip? _trip;
  String? _pin, _shareToken, _error;
  MobileAddress? _from, _to;
  int _seats = 1;
  bool _shared = false, _loading = true, _busy = false;
  MobileRideQuote? _quote;
  MobileRideLocation? _location;
  RideEstimate? _estimate;
  Timer? _poll;
  String t(String th, String en) => widget.thai ? th : en;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    final every = widget.pollInterval;
    if (every != null)
      _poll = Timer.periodic(every, (_) => unawaited(_refreshTrip()));
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  String _message(Object error) {
    final code = error is MobileApiException ? error.code : '';
    return switch (code) {
      'FARES_UNPUBLISHED' => t(
        'ยังไม่เปิดให้บริการเรียกรถในพื้นที่นี้',
        'Rides are not available yet: no fare has been published.',
      ),
      'TRIP_STATE_CONFLICT' => t(
        'คุณมีเที่ยวที่ยังไม่จบ หรือสถานะเที่ยวเปลี่ยนไป',
        'You already have an unfinished trip, or it changed.',
      ),
      'INVALID_REQUEST' => t(
        'ข้อมูลไม่ถูกต้อง ตรวจจุดรับ จุดส่ง และจำนวนที่นั่ง',
        'Check the pickup, drop-off and seats.',
      ),
      _ => t('ทำรายการไม่สำเร็จ ลองใหม่', 'Something went wrong. Try again.'),
    };
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final current = await widget.gateway.current();
      final addresses = current.trip == null
          ? await widget.gateway.addresses()
          : _addresses;
      if (!mounted) return;
      setState(() {
        _trip = current.trip;
        if (current.trip?.state != 'IN_TRIP') _location = null;
        _addresses = addresses
            .where(
              (a) =>
                  a.address.latitudeE7 != null && a.address.longitudeE7 != null,
            )
            .toList();
        _loading = false;
      });
      await _loadLocation(current.trip);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error);
        _loading = false;
      });
    }
  }

  Future<void> _refreshTrip() async {
    if (_busy || _trip == null || !mounted) return;
    try {
      final current = await widget.gateway.current();
      if (!mounted) return;
      setState(() {
        if (current.trip == null) {
          _pin = null;
          _shareToken = null;
        }
        _trip = current.trip;
      });
      if (current.trip == null && _addresses.isEmpty) await _load();
      await _loadLocation(current.trip);
    } catch (_) {}
  }

  Future<void> _loadLocation(MobileRideTrip? trip) async {
    if (trip?.state != 'IN_TRIP') {
      if (mounted) setState(() => _location = null);
      return;
    }
    try {
      final location = await widget.gateway.location(trip!.id);
      if (mounted && _trip?.id == trip.id) setState(() => _location = location);
    } catch (_) {
      if (mounted && _trip?.id == trip!.id) setState(() => _location = null);
    }
  }

  Future<void> _act(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    }
    if (mounted) setState(() => _busy = false);
  }

  MobileRidePoint _point(MobileAddress a) => MobileRidePoint(
    latitudeE7: a.address.latitudeE7!,
    longitudeE7: a.address.longitudeE7!,
  );

  Future<void> _getQuote() => _act(() async {
    final from = _from, to = _to;
    if (from == null || to == null || from.id == to.id) {
      setState(
        () =>
            _error = _message(const MobileApiException('INVALID_REQUEST', 422)),
      );
      return;
    }
    final estimate = await widget.routeProvider.estimate(
      _point(from),
      _point(to),
    );
    final quote = await widget.gateway.quote(
      MobileRideQuoteRequest(
        distanceMetres: estimate.distanceMetres,
        durationSeconds: estimate.durationSeconds,
        seats: _seats,
        shared: _shared,
      ),
    );
    if (mounted) {
      setState(() {
        _estimate = estimate;
        _quote = quote;
      });
    }
  });

  Future<void> _request() => _act(() async {
    final from = _from!, to = _to!, estimate = _estimate!;
    final made = await widget.gateway.request(
      MobileRideRequest(
        idempotencyKey: newRideKey(),
        distanceMetres: estimate.distanceMetres,
        durationSeconds: estimate.durationSeconds,
        seats: _seats,
        shared: _shared,
        pickup: _point(from),
        dropoff: _point(to),
      ),
    );
    if (mounted) {
      setState(() {
        _trip = made.trip;
        _pin = made.pin;
        _quote = null;
      });
    }
  });

  Future<void> _cancel() => _act(() async {
    await widget.gateway.cancel(_trip!.id);
    if (mounted) {
      setState(() {
        _trip = null;
        _pin = null;
        _shareToken = null;
      });
      await _load();
    }
  });

  Future<void> _share() => _act(() async {
    final s = await widget.gateway.share(_trip!.id);
    if (mounted) setState(() => _shareToken = s.token);
  });

  Future<void> _revoke() => _act(() async {
    await widget.gateway.revoke(_trip!.id);
    if (mounted) setState(() => _shareToken = null);
  });

  Future<void> _reportDialog() async {
    final result = await showDialog<(String, String)>(
      context: context,
      builder: (_) => _ReportDialog(thai: widget.thai),
    );
    if (result == null || _trip == null) return;
    final (kind, body) = result;
    await _act(() async {
      await widget.gateway.report(_trip!.id, kind, body);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              t(
                'ส่งเรื่องแล้ว ทีมงานจะตรวจสอบ',
                'Report sent. Our team will review it.',
              ),
            ),
          ),
        );
      }
    });
  }

  Widget _card(List<Widget> children) => Container(
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(18),
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

  Widget _form() {
    String label(MobileAddress a) =>
        a.address.label.isEmpty ? a.address.addressText : a.address.label;
    Widget pick(
      String key,
      String title,
      MobileAddress? value,
      ValueChanged<MobileAddress?> onChanged,
    ) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DropdownButtonFormField<String>(
        key: ValueKey(key),
        initialValue: value?.id,
        isExpanded: true,
        decoration: InputDecoration(
          labelText: title,
          border: const OutlineInputBorder(),
        ),
        items: [
          for (final a in _addresses)
            DropdownMenuItem(
              value: a.id,
              child: Text(label(a), overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: (id) {
          onChanged(_addresses.where((a) => a.id == id).firstOrNull);
          setState(() => _quote = null);
        },
      ),
    );
    if (_addresses.length < 2) {
      return _card([
        Text(
          t(
            'ต้องมีที่อยู่ที่บันทึกพร้อมพิกัดอย่างน้อย 2 แห่งเพื่อเรียกรถ',
            'Save at least two addresses with a map pin to request a ride.',
          ),
          key: const ValueKey('ride-need-addresses'),
        ),
      ]);
    }
    return _card([
      pick('ride-from', t('จุดรับ', 'Pickup'), _from, (a) => _from = a),
      pick('ride-to', t('จุดส่ง', 'Drop-off'), _to, (a) => _to = a),
      Row(
        children: [
          Text(t('ที่นั่ง', 'Seats')),
          IconButton(
            key: const ValueKey('ride-seats-minus'),
            onPressed: _seats > 1
                ? () => setState(() {
                    _seats--;
                    _quote = null;
                  })
                : null,
            icon: const Icon(Icons.remove_circle_outline),
          ),
          Text('$_seats', key: const ValueKey('ride-seats')),
          IconButton(
            key: const ValueKey('ride-seats-plus'),
            onPressed: _seats < 6
                ? () => setState(() {
                    _seats++;
                    _quote = null;
                  })
                : null,
            icon: const Icon(Icons.add_circle_outline),
          ),
        ],
      ),
      Material(
        color: Colors.transparent,
        child: SwitchListTile(
          key: const ValueKey('ride-shared'),
          contentPadding: EdgeInsets.zero,
          value: _shared,
          onChanged: (v) => setState(() {
            _shared = v;
            _quote = null;
          }),
          title: Text(
            t(
              'ยินดีแชร์รถ (ราคาถูกลง)',
              'Happy to share the ride (lower fare)',
            ),
          ),
        ),
      ),
      FilledButton(
        key: const ValueKey('ride-quote'),
        onPressed: _busy ? null : _getQuote,
        child: Text(t('ดูค่าโดยสาร', 'Get fare')),
      ),
      if (_quote != null) ...[
        const SizedBox(height: 14),
        Text(
          rideMoneyText(_quote!.fare),
          key: const ValueKey('ride-quote-fare'),
          style: const TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w600,
            color: _ink,
          ),
        ),
        Text(
          t(
            'ประมาณจากระยะเส้นตรง ~${(_estimate!.distanceMetres / 1000).toStringAsFixed(1)} กม. เส้นทางจริงอาจต่างไป ยังไม่มีการเก็บเงินในแอป',
            'Estimated from straight-line distance, ~${(_estimate!.distanceMetres / 1000).toStringAsFixed(1)} km; the real route may differ. No payment is taken in the app.',
          ),
          style: const TextStyle(fontSize: 12, color: _muted),
        ),
        const SizedBox(height: 10),
        FilledButton(
          key: const ValueKey('ride-request'),
          onPressed: _busy ? null : _request,
          child: Text(t('เรียกรถ', 'Request ride')),
        ),
      ],
    ]);
  }

  Widget _tripCard(MobileRideTrip trip) {
    final live =
        trip.state == 'REQUESTED' ||
        trip.state == 'MATCHED' ||
        trip.state == 'ARRIVED' ||
        trip.state == 'IN_TRIP';
    final cancellable =
        trip.state == 'REQUESTED' ||
        trip.state == 'MATCHED' ||
        trip.state == 'ARRIVED';
    return _card([
      Text(
        switch (trip.state) {
          'REQUESTED' => t('กำลังหาคนขับ', 'Looking for a driver'),
          'MATCHED' => t('คนขับกำลังมารับ', 'Driver on the way'),
          'ARRIVED' => t(
            'คนขับถึงแล้ว ให้ PIN กับคนขับ',
            'Driver arrived: give them your PIN',
          ),
          'IN_TRIP' => t('กำลังเดินทาง', 'Trip in progress'),
          _ => t('จบแล้ว', 'Finished'),
        },
        key: const ValueKey('ride-trip-state'),
        style: const TextStyle(fontWeight: FontWeight.w600, color: _purple),
      ),
      const SizedBox(height: 8),
      Text(
        rideMoneyText(trip.fare),
        key: const ValueKey('ride-trip-fare'),
        style: const TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w600,
          color: _ink,
        ),
      ),
      if (_pin != null && trip.state != 'IN_TRIP') ...[
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: _tile,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Text(
                _pin!,
                key: const ValueKey('ride-pin'),
                style: const TextStyle(
                  fontSize: 30,
                  letterSpacing: 6,
                  fontWeight: FontWeight.w700,
                  color: _purple,
                ),
              ),
              const Spacer(),
              IconButton(
                tooltip: t('คัดลอก', 'Copy'),
                onPressed: () => Clipboard.setData(ClipboardData(text: _pin!)),
                icon: const Icon(Icons.copy),
              ),
            ],
          ),
        ),
        Text(
          t(
            'PIN แสดงครั้งเดียว อย่าส่งให้ใครนอกจากคนขับตอนขึ้นรถ',
            'This PIN is shown once. Give it only to the driver when you board.',
          ),
          style: const TextStyle(fontSize: 12, color: _muted),
        ),
      ] else if (_pin == null &&
          (trip.state == 'MATCHED' || trip.state == 'ARRIVED'))
        Text(
          t(
            'ไม่มี PIN บนเครื่องนี้ ให้ยกเลิกแล้วเรียกใหม่',
            'This device no longer has the PIN. Cancel and request again.',
          ),
          key: const ValueKey('ride-pin-lost'),
          style: const TextStyle(color: _muted),
        ),
      if (trip.state == 'IN_TRIP') ...[
        const SizedBox(height: 10),
        if (_location?.point != null)
          Text(
            '${t('ตำแหน่งล่าสุดของคนขับ', 'Latest driver location')}: ${(_location!.point!.latitudeE7 / 1e7).toStringAsFixed(5)}, ${(_location!.point!.longitudeE7 / 1e7).toStringAsFixed(5)}',
            key: const ValueKey('ride-driver-location'),
          )
        else
          Text(
            _location?.enabled == true
                ? t(
                    'ยังไม่มีพิกัดใหม่ใน 60 วินาทีที่ผ่านมา',
                    'No new driver point in the last 60 seconds.',
                  )
                : t(
                    'คนขับไม่ได้เปิดแชร์ตำแหน่งสำหรับเที่ยวนี้',
                    'The driver has not enabled location sharing for this trip.',
                  ),
            key: const ValueKey('ride-driver-location-empty'),
            style: const TextStyle(color: _muted),
          ),
      ],
      const SizedBox(height: 14),
      if (live)
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            if (_shareToken == null)
              OutlinedButton(
                key: const ValueKey('ride-share'),
                onPressed: _busy ? null : _share,
                child: Text(t('แชร์ความปลอดภัย', 'Share safety link')),
              )
            else
              OutlinedButton(
                key: const ValueKey('ride-revoke'),
                onPressed: _busy ? null : _revoke,
                child: Text(t('ยกเลิกลิงก์แชร์', 'Revoke share link')),
              ),
            OutlinedButton(
              key: const ValueKey('ride-report'),
              onPressed: _busy ? null : _reportDialog,
              child: Text(t('แจ้งปัญหา', 'Report a problem')),
            ),
            if (cancellable)
              OutlinedButton(
                key: const ValueKey('ride-cancel'),
                onPressed: _busy ? null : _cancel,
                child: Text(t('ยกเลิกเที่ยว', 'Cancel trip')),
              ),
          ],
        ),
      if (_shareToken != null) ...[
        const SizedBox(height: 10),
        SelectableText(_shareToken!, key: const ValueKey('ride-share-token')),
        Text(
          t(
            'ผู้ถือรหัสนี้เห็นเฉพาะสถานะเที่ยว หมดอายุใน 6 ชั่วโมง',
            'Whoever holds this code sees only the trip status. Expires in 6 hours.',
          ),
          style: const TextStyle(fontSize: 12, color: _muted),
        ),
      ],
    ]);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: _bg,
    appBar: AppBar(
      backgroundColor: _bg,
      title: Text(
        t('เรียกรถ', 'Request a ride'),
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
          onPressed: _loading || _busy ? null : _load,
          icon: const Icon(Icons.refresh),
        ),
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
                    child: Text(_error!),
                  ),
                if (_trip != null) _tripCard(_trip!) else _form(),
              ],
            ),
    ),
  );
}

class _ReportDialog extends StatefulWidget {
  const _ReportDialog({required this.thai});
  final bool thai;
  @override
  State<_ReportDialog> createState() => _ReportDialogState();
}

class _ReportDialogState extends State<_ReportDialog> {
  final _text = TextEditingController();
  String _kind = 'SAFETY';
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(t('แจ้งปัญหา', 'Report a problem')),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        DropdownButton<String>(
          key: const ValueKey('ride-incident-kind'),
          value: _kind,
          isExpanded: true,
          items: [
            DropdownMenuItem(
              value: 'SAFETY',
              child: Text(t('ความปลอดภัย', 'Safety')),
            ),
            DropdownMenuItem(
              value: 'CONDUCT',
              child: Text(t('พฤติกรรม', 'Conduct')),
            ),
            DropdownMenuItem(
              value: 'FARE',
              child: Text(t('ค่าโดยสาร', 'Fare')),
            ),
            DropdownMenuItem(value: 'OTHER', child: Text(t('อื่นๆ', 'Other'))),
          ],
          onChanged: (v) => setState(() => _kind = v ?? _kind),
        ),
        TextField(
          key: const ValueKey('ride-incident-text'),
          controller: _text,
          maxLength: 500,
          maxLines: 3,
          decoration: InputDecoration(
            labelText: t('เกิดอะไรขึ้น', 'What happened'),
          ),
        ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(t('ยกเลิก', 'Cancel')),
      ),
      FilledButton(
        key: const ValueKey('ride-incident-send'),
        onPressed: () {
          final body = _text.text.trim();
          if (body.isNotEmpty) Navigator.pop(context, (_kind, body));
        },
        child: Text(t('ส่ง', 'Send')),
      ),
    ],
  );
}
