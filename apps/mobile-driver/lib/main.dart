import 'package:mobile_shared/presentation/ui_catalog.dart';

import 'presentation/driver_welcome.dart';
import 'presentation/driver_otp_field.dart';
import 'daily_earnings_summary.dart';
import 'driver_rating_summary.dart';
import 'presentation/driver_home_metrics.dart';
import 'work_availability.dart';
import 'help_safety_page.dart';
import 'presentation/driver_account_actions.dart';
import 'presentation/driver_rides_page.dart';
import 'presentation/passenger_preview_pages.dart';
import 'presentation/driver_identity_card.dart';
import 'presentation/driver_application_flow.dart';
import 'presentation/driver_navigation.dart';
import 'food_history_page.dart';

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/driver_mutation.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/mobile_push_controller.dart';
import 'package:mobile_shared/mobile_push_native.dart';
import 'package:mobile_shared/mobile_push_settings.dart';

import 'presentation/driver_presentation.dart';
import 'food_work_page.dart';
import 'earnings_page.dart';

void main() => runApp(const BitPosDriver());

class BitPosDriver extends StatelessWidget {
  const BitPosDriver({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'BitPOS Driver',
    debugShowCheckedModeBanner: false,
    theme: BitPosTheme.light(),
    darkTheme: BitPosTheme.dark(),
    home: const bool.fromEnvironment('BITPOS_UI_CATALOG')
        ? const BitPosUiCatalog(rider: true)
        : const DriverSessionPage(),
  );
}

class DriverSessionPage extends StatefulWidget {
  const DriverSessionPage({super.key, this.api});
  final MobileApi? api;
  @override
  State<DriverSessionPage> createState() => _DriverSessionPageState();
}

class _DriverSessionPageState extends State<DriverSessionPage>
    with WidgetsBindingObserver {
  final _phone = TextEditingController(), _code = TextEditingController();
  final _name = TextEditingController(),
      _plate = TextEditingController(),
      _brand = TextEditingController(),
      _color = TextEditingController();
  DateTime? _license, _registration;
  String _vehicle = 'MOTORCYCLE';
  MobileApi? _api;
  DriverProfile? _profile;
  DriverMutation? _pending;
  bool _welcome = true;
  final _signInForm = GlobalKey<FormState>();
  bool _busy = true, _sent = false, _thai = true, _signedIn = false;
  Object? _error;
  int _owner = 0;
  Timer? _deadline;
  DateTime? _availabilityDeadline;
  bool _snapshotStale = false;
  MobilePushController? _push;
  bool _destinationOpen = false;
  bool _profileKnown = false;
  DriverApplicationStage _applicationStage = DriverApplicationStage.identity;
  bool _applicationOpen = false, _applicationDismissed = false;
  StreamSubscription<({String accountId, String sessionId})?>? _sessionChanges;
  String t(String th, String en) => _thai ? th : en;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      const base = String.fromEnvironment('BITPOS_MOBILE_API');
      if (widget.api == null && base.isEmpty)
        throw const MobileApiException('CONFIGURATION_REQUIRED', 503);
      _api =
          widget.api ??
          MobileApi(
            base: Uri.parse(base),
            fixture: const bool.fromEnvironment('BITPOS_FIXTURE'),
          );
      await _api!.restore();
      var previousScope = _api!.sessionScope;
      _sessionChanges = _api!.sessionScopes.listen((scope) {
        final changedOwner = previousScope != null && scope != previousScope;
        previousScope = scope;
        if ((scope == null || changedOwner) && mounted) {
          setState(() {
            _owner++;
            _signedIn = false;
            _profile = null;
            _pending = null;
            _clearApplication();
            _sent = false;
            _code.clear();
          });
        }
      });
      _signedIn = _api!.signedIn;
      if (_signedIn) {
        _welcome = false;
        await _load();
      }
      final api = _api!;
      _push = MobilePushController(
        api: api,
        native: FirebaseMobilePushNative(
          MobilePushConfiguration.fromEnvironment(),
          app: 'DRIVER',
        ),
        app: MobilePushApp.driver,
        locale: () => _thai ? 'th' : 'en',
        onOpen: (result, owner) {
          if (mounted &&
              api.sessionScope == owner &&
              _signedIn &&
              result is MobilePushOpenDriverWork)
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => FoodWorkPage(
                  api: api,
                  thai: _thai,
                ),
              ),
            );
        },
      );
      await _push!.start();
    } catch (e) {
      _error = e;
      if (_signedIn && _api != null && !_api!.signedIn) {
        _owner++;
        _signedIn = false;
        _profile = null;
        _pending = null;
        _clearApplication();
        _sent = false;
        _code.clear();
      }
    }
    if (mounted) setState(() => _busy = false);
  }

  void _clearApplication() {
    _profileKnown = false;
    _applicationStage = DriverApplicationStage.identity;
    _applicationOpen = false;
    _applicationDismissed = false;
    for (final c in [_name, _plate, _brand, _color]) {
      c.clear();
    }
    _license = null;
    _registration = null;
    _vehicle = 'MOTORCYCLE';
    _deadline?.cancel();
    _availabilityDeadline = null;
    _snapshotStale = false;
  }

  void _expire() {
    if (mounted) setState(() => _snapshotStale = true);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _signedIn) {
      _expire();
      if (!_busy) unawaited(_run(_load));
    }
  }

  void _adopt(DriverProfile? profile) {
    _profile = profile;
    _deadline?.cancel();
    _snapshotStale = false;
    final a = profile?.application;
    if (a == null) {
      _clearApplication();
      return;
    }
    _name.text = a.displayName;
    _plate.text = a.plate;
    _brand.text = a.brand;
    _color.text = a.color;
    _vehicle = a.vehicleType;
    _license = DateTime.parse(a.licenseExpiresAt);
    _registration = DateTime.parse(a.registrationExpiresAt);
    final deadlines = [
      if (profile!.availability.online &&
          profile.availability.heartbeatExpiresAt != null)
        DateTime.parse(profile.availability.heartbeatExpiresAt!),
      if (profile.verifiedUntil != null) DateTime.parse(profile.verifiedUntil!),
      _license!,
      _registration!,
    ];
    _availabilityDeadline = deadlines.reduce((a, b) => a.isBefore(b) ? a : b);
    final remaining = _availabilityDeadline!.difference(DateTime.now());
    if (remaining <= Duration.zero) {
      _snapshotStale = true;
    } else {
      _deadline = Timer(remaining, _expire);
    }
  }

  Future<void> _load() async {
    final owner = _owner;
    final pending = await _api!.pendingDriverMutation();
    final result = await _api!.driverProfile();
    if (!mounted || owner != _owner) return;
    _pending = pending;
    _adopt(result.driver);
    _profileKnown = true;
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) {
        _error = e;
        if (_signedIn && _api != null && !_api!.signedIn) {
          _owner++;
          _signedIn = false;
          _profile = null;
          _pending = null;
          _clearApplication();
          _sent = false;
          _code.clear();
        }
      }
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _login() async {
    if (_sent) {
      await _api!.verifyOtp(_phone.text.trim(), _code.text.trim());
      _owner++;
      _clearApplication();
      _signedIn = true;
      await _load();
    } else {
      await _api!.requestOtp(_phone.text.trim());
      _sent = true;
    }
  }

  Future<void> _submit(DriverMutation mutation) async {
    _pending = mutation;
    try {
      await _api!.submitDriverMutation(mutation);
    } finally {
      if (_api!.signedIn) _pending = await _api!.pendingDriverMutation();
    }
    await _load();
  }

  Future<void> _apply() async {
    if (_license == null || _registration == null)
      throw const MobileApiException('DRIVER_DOCUMENT_EXPIRED', 422);
    final application = DriverApplication(
      displayName: _name.text.trim(),
      licenseExpiresAt: _license!.toUtc().toIso8601String(),
      vehicleType: _vehicle,
      plate: _plate.text.trim(),
      brand: _brand.text.trim(),
      color: _color.text.trim(),
      registrationExpiresAt: _registration!.toUtc().toIso8601String(),
    );
    await _submit(_api!.driverApplicationCommand(_profile, application));
    if (mounted) {
      setState(() => _applicationStage = DriverApplicationStage.review);
    }
  }

  Future<void> _date(bool license) async {
    final now = DateTime.now(),
        first = DateUtils.dateOnly(DateTime.now()),
        last = DateUtils.dateOnly(
          DateTime.now().add(const Duration(days: 3650)),
        );
    final saved = license ? _license : _registration;
    final initial = saved == null
        ? now.add(const Duration(days: 365))
        : saved.isBefore(first)
        ? first
        : saved.isAfter(last)
        ? last
        : saved;
    final selected = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
    );
    if (selected != null && mounted)
      setState(() {
        final end = DateTime(
          selected.year,
          selected.month,
          selected.day,
          23,
          59,
          59,
        );
        if (license) {
          _license = end;
        } else {
          _registration = end;
        }
      });
  }

  Future<void> _logout() async {
    _owner++;
    unawaited(_push?.disable() ?? Future<void>.value());
    await _api!.logout(allDevices: false);
    _signedIn = false;
    _profile = null;
    _pending = null;
    _sent = false;
    _code.clear();
    _clearApplication();
  }

  String _message(Object e) {
    if (e is TimeoutException)
      return t(
        'เซิร์ฟเวอร์ยังไม่ตอบกลับ โหลดสถานะล่าสุดก่อนทำรายการต่อ',
        'Server response timed out. Refresh the latest state before continuing.',
      );
    if (e is FormatException)
      return t(
        'อ่านข้อมูลเซิร์ฟเวอร์ไม่ได้ กรุณาโหลดใหม่หรือติดต่อผู้ดูแล',
        'Could not read the server response. Refresh or contact support.',
      );
    if (e is MobileApiException)
      return switch (e.code) {
        'CONFIGURATION_REQUIRED' => t(
          'ยังไม่ได้ตั้งค่าบริการ',
          'Service configuration required',
        ),
        'AUTH_REQUIRED' ||
        'SESSION_EXPIRED' => t('กรุณาเข้าสู่ระบบใหม่', 'Sign in again'),
        'DRIVER_VERIFICATION_REQUIRED' => t(
          'ต้องได้รับการตรวจสอบที่ยังไม่หมดอายุก่อนออนไลน์',
          'Current independent verification required before going online',
        ),
        'DRIVER_SUSPENDED' => t(
          'บัญชีถูกพัก ติดต่อฝ่ายช่วยเหลือ',
          'Driver suspended. Contact support',
        ),
        'DRIVER_DOCUMENT_EXPIRED' => t(
          'เลือกวันหมดอายุเอกสารที่ยังใช้ได้',
          'Choose valid document expiry dates',
        ),
        'VERSION_CONFLICT' => t(
          'ข้อมูลเปลี่ยนแล้ว โหลดล่าสุดก่อนทำรายการใหม่',
          'State changed. Refresh before a new command',
        ),
        'PROVIDER_RATE_LIMITED' => t(
          'คำขอบ่อยเกินไป กรุณารอ',
          'Too many requests. Wait before retrying',
        ),
        _ => t(
          'ทำรายการไม่สำเร็จ เก็บคำสั่งเดิมไว้หากยังไม่ทราบผล',
          'Request failed. Unresolved original commands are retained',
        ),
      };
    return t(
      'เชื่อมต่อไม่ได้หรือข้อมูลไม่ถูกต้อง ตรวจข้อมูลแล้วลองใหม่',
      'Connection failed or invalid fields. Check and retry',
    );
  }

  String _status(String value) => switch (value) {
    'SUBMITTED' => t('รอตรวจสอบ', 'Awaiting verification'),
    'APPROVED' => t('อนุมัติแล้ว', 'Approved'),
    'REJECTED' => t('ไม่ผ่านการตรวจสอบ', 'Rejected'),
    'SUSPENDED' => t('พักบัญชี', 'Suspended'),
    _ => value,
  };
  Widget _field(TextEditingController c, String th, String en, int maximum) =>
      Padding(
        padding: EdgeInsets.zero,
        child: TextField(
          controller: c,
          enabled: !_busy && _pending == null,
          maxLength: maximum,
          decoration: InputDecoration(labelText: t(th, en), counterText: ''),
        ),
      );
  Future<void> _openHelp() async {
    if (_busy || !_signedIn || _api == null) return;
    final work = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (routeContext) => DriverHelpSafetyPage(
          api: _api!,
          thai: _thai,
          onWork: () => Navigator.of(routeContext).pop(true),
        ),
      ),
    );
    if (mounted && work == true) await _openDestination(0);
  }

  Future<void> _openDestination(int index) async {
    if (_destinationOpen || _busy || !_signedIn || _api == null || index == 3)
      return;
    if (index != 0 && _profile == null) return;
    _destinationOpen = true;
    final api = _api!, owner = api.sessionScope;
    try {
      int? destination = index;
      while (mounted &&
          _signedIn &&
          api.sessionScope == owner &&
          destination != null &&
          destination != 3) {
        final current = destination;
        if (!mounted) break;
        final navigator = Navigator.of(context);
        final travelMode = ValueNotifier(false);
        final child = current == 0
            ? FoodWorkPage(
                api: api,
                thai: _thai,
                onTravelModeChanged: (value) => travelMode.value = value,
                availability: WorkAvailability(api: api, thai: _thai),
                dailySummary: DriverHomeMetrics(
                  earnings: DriverDailySummary(
                    api: api,
                    thai: _thai,
                    compact: true,
                  ),
                  rating: DriverRatingSummary(api: api, thai: _thai),
                ),
              )
            : current == 1
            ? DriverFoodHistoryPage(api: api, thai: _thai)
            : DriverEarningsPage(api: api, thai: _thai);
        final route = MaterialPageRoute<int>(
          settings: const RouteSettings(name: 'driver-destination'),
          builder: (_) => DriverDestination(
            api: api,
            thai: _thai,
            index: current,
            travelMode: travelMode,
            child: child,
          ),
        );
        try {
          destination = await navigator.push<int>(route);
        } finally {
          await route.completed;
          travelMode.dispose();
        }
      }
    } finally {
      _destinationOpen = false;
    }
  }

  Widget _foodWork() => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.delivery_dining_outlined, size: 32),
          const SizedBox(height: 12),
          Text(
            t(
              'งานส่งอาหารและหลักฐานรับส่ง',
              'Food assignments and custody proofs',
            ),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            t(
              'งานเสนอและงานที่รับแล้วมาจากเซิร์ฟเวอร์ การออนไลน์อย่างเดียวไม่ใช่การรับงาน',
              'Offers and accepted assignments come from the server. Going online alone does not accept a job.',
            ),
          ),
          FilledButton(
            onPressed: _busy || _pending != null
                ? null
                : () => _openDestination(0),
            child: Text(t('เปิดงานส่งอาหาร', 'Open food deliveries')),
          ),
          OutlinedButton(
            onPressed: _busy || _pending != null || _profile == null
                ? null
                : () => _openDestination(1),
            child: Text(t('ประวัติการรับงาน', 'Delivery history')),
          ),
          OutlinedButton(
            onPressed: _busy || _pending != null
                ? null
                : () => _openDestination(2),
            child: Text(t('รายได้และรอบจ่าย', 'Earnings and payouts')),
          ),
        ],
      ),
    ),
  );
  @override
  Widget build(BuildContext context) =>
      DriverPresentation(child: Builder(builder: _buildPage));
  InputDecoration _signInDecoration(BuildContext context, String label) {
    final colors = Theme.of(context).colorScheme,
        dark = Theme.of(context).brightness == Brightness.dark;
    OutlineInputBorder border(Color color) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(color: color),
    );
    return InputDecoration(
      labelText: label,
      filled: true,
      fillColor: dark ? colors.surface : Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: border(colors.outline),
      enabledBorder: border(dark ? colors.outline : const Color(0xFFE9E1F1)),
      disabledBorder: border(
        dark ? colors.outlineVariant : const Color(0xFFE9E1F1),
      ),
      focusedBorder: border(colors.primary),
    );
  }

  String get _maskedSignInPhone {
    final phone = _phone.text.trim();
    if (phone.length <= 6) return phone;
    return '${phone.substring(0, 3)} ••• ${phone.substring(phone.length - 4)}';
  }

  Widget _applicationForm(BuildContext context) {
    final p = _profile, frozen = _busy || _pending != null;
    return DriverApplicationFlow(
      showHeader: false,
      showNextAction: false,
      thai: _thai,
      stage: _applicationStage,
      reviewDetails: {
        t('ชื่อ–นามสกุล', 'Display name'): _name.text,
        t('ประเภทรถ', 'Vehicle type'): _vehicle == 'CAR'
            ? t('รถยนต์', 'Car')
            : t('รถจักรยานยนต์', 'Motorcycle'),
        t('ทะเบียนรถ', 'Vehicle plate'): _plate.text,
        t('ยี่ห้อรถ', 'Vehicle brand'): _brand.text,
        t('สีรถ', 'Vehicle color'): _color.text,
        t('ใบขับขี่หมดอายุ', 'License expiry'):
            _license?.toLocal().toString().split(' ').first ?? '',
        t('ทะเบียนรถหมดอายุ', 'Registration expiry'):
            _registration?.toLocal().toString().split(' ').first ?? '',
      },
      editable: !frozen,
      identityFields: [_field(_name, 'ชื่อ–นามสกุล', 'Display name', 80)],
      vehicleFields: [
        DropdownButtonFormField<String>(
          isExpanded: true,
          key: ValueKey('$_owner:$_vehicle'),
          initialValue: _vehicle,
          items: ['MOTORCYCLE', 'CAR']
              .map(
                (v) => DropdownMenuItem(
                  value: v,
                  child: Text(
                    v == 'CAR'
                        ? t('รถยนต์', 'Car')
                        : t('รถจักรยานยนต์', 'Motorcycle'),
                  ),
                ),
              )
              .toList(),
          onChanged: frozen ? null : (v) => setState(() => _vehicle = v!),
          decoration: InputDecoration(
            labelText: t('ประเภทรถส่งอาหาร', 'Food vehicle type'),
          ),
        ),
        const SizedBox(height: BitPosDesignTokens.s12),
        _field(_plate, 'ทะเบียนรถ', 'Vehicle plate', 40),
        _field(_brand, 'ยี่ห้อรถ', 'Vehicle brand', 80),
        _field(_color, 'สีรถ', 'Vehicle color', 40),
        OutlinedButton(
          onPressed: frozen ? null : () => _date(true),
          child: Text(
            '${t('ใบขับขี่หมดอายุ', 'License expiry')}: ${_license?.toLocal().toString().split(' ').first ?? '—'}',
          ),
        ),
        const SizedBox(height: BitPosDesignTokens.s12),
        OutlinedButton(
          onPressed: frozen ? null : () => _date(false),
          child: Text(
            '${t('ทะเบียนรถหมดอายุ', 'Registration expiry')}: ${_registration?.toLocal().toString().split(' ').first ?? '—'}',
          ),
        ),
      ],
      verificationStatus: p == null
          ? t('ยังไม่มีใบสมัครบนเซิร์ฟเวอร์', 'No server application yet')
          : _status(p.status),
      decisionReason: p?.decisionReason ?? '',
      verifiedUntil: p?.verifiedUntil,
      onBack: _applicationStage == DriverApplicationStage.identity
          ? null
          : () =>
                setState(() => _applicationStage = _applicationStage.previous),
      onNext: () => setState(() => _applicationStage = _applicationStage.next),
      onSubmit: frozen || p?.status == 'SUSPENDED' ? null : () => _run(_apply),
    );
  }

  void _leaveApplication() {
    if (_busy) return;
    setState(() {
      if (_applicationStage != DriverApplicationStage.identity) {
        _applicationStage = _applicationStage.previous;
      } else {
        _applicationOpen = false;
        _applicationDismissed = true;
      }
    });
  }

  Widget _applicationPage(BuildContext context) {
    final title = switch (_applicationStage) {
      DriverApplicationStage.identity => t('ยืนยันตัวตน', 'Confirm identity'),
      DriverApplicationStage.vehicle => t('ข้อมูลรถของคุณ', 'Vehicle details'),
      DriverApplicationStage.review => t('ตรวจสอบเอกสาร', 'Review application'),
    };
    return PopScope<Object?>(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) _leaveApplication();
      },
      child: Scaffold(
        appBar: AppBar(
          toolbarHeight: 72,
          leadingWidth: 76,
          titleSpacing: 0,
          leading: Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 14, 14),
            child: IconButton(
              key: const ValueKey('driver-application-back'),
              tooltip: t('ย้อนกลับ', 'Back'),
              onPressed: _busy ? null : _leaveApplication,
              style: IconButton.styleFrom(
                side: BorderSide(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              icon: const Icon(Icons.chevron_left),
            ),
          ),
          title: Text(
            title,
            maxLines: 2,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          ),
          actions: [
            if (MediaQuery.sizeOf(context).width >= 360)
              TextButton(
                onPressed: () => setState(() => _thai = !_thai),
                child: Text(_thai ? 'English' : 'ไทย'),
              )
            else
              IconButton(
                tooltip: _thai ? 'English' : 'ไทย',
                onPressed: () => setState(() => _thai = !_thai),
                icon: const Icon(Icons.language),
              ),
          ],
        ),
        bottomNavigationBar: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_applicationStage != DriverApplicationStage.review)
                Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 520),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(
                          minWidth: double.infinity,
                          minHeight: 52,
                        ),
                        child: FilledButton(
                          key: const ValueKey('driver-application-next'),
                          onPressed: _busy || _pending != null
                              ? null
                              : () => setState(
                                  () => _applicationStage =
                                      _applicationStage.next,
                                ),
                          child: Text(t('ดำเนินการต่อ', 'Continue')),
                        ),
                      ),
                    ),
                  ),
                ),
              DriverNavigation(
                thai: _thai,
                selectedIndex: 3,
                onSelected: _busy
                    ? null
                    : (index) {
                        if (index == 3) {
                          setState(() {
                            _applicationOpen = false;
                            _applicationDismissed = true;
                          });
                        } else {
                          unawaited(_openDestination(index));
                        }
                      },
              ),
            ],
          ),
        ),
        body: SafeArea(
          child: Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: SingleChildScrollView(
                key: const ValueKey('driver-application-scroll'),
                padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_busy) const LinearProgressIndicator(),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: Semantics(
                          liveRegion: true,
                          child: Text(
                            _message(_error!),
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                      ),
                    if (_pending != null) ...[
                      Text(
                        t(
                          'ตรวจผลคำสั่งเดิมก่อนแก้ไข',
                          'Resolve the original command before editing',
                        ),
                      ),
                      FilledButton(
                        onPressed: _busy
                            ? null
                            : () => _run(() => _submit(_pending!)),
                        child: Text(
                          t('ส่งคำสั่งเดิมอีกครั้ง', 'Retry original command'),
                        ),
                      ),
                    ],
                    _applicationForm(context),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPage(BuildContext context) {
    final p = _profile, frozen = _busy || _pending != null;
    if (!_signedIn && !_busy && _welcome)
      return DriverWelcome(
        thai: _thai,
        onStart: () => setState(() => _welcome = false),
        onLanguage: () => setState(() => _thai = !_thai),
      );
    if (_signedIn &&
        _profileKnown &&
        (_applicationOpen || (_profile == null && !_applicationDismissed))) {
      return _applicationPage(context);
    }
    return Scaffold(
      bottomNavigationBar: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_signedIn)
              DriverNavigation(
                thai: _thai,
                selectedIndex: 3,
                onSelected: frozen
                    ? null
                    : (index) => unawaited(_openDestination(index)),
              ),
            if (const bool.fromEnvironment('BITPOS_FIXTURE'))
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 8,
                ),
                child: Text(
                  t(
                    'ข้อมูลทดสอบในเครื่อง / AVD ไม่ใช่การตรวจสอบคนขับจริง',
                    'LOCAL / AVD FIXTURE — not real driver verification',
                  ),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              key: const ValueKey('driver-session-scroll'),
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 104),
              children: [
                LayoutBuilder(
                  builder: (context, constraints) => Row(
                    children: [
                      if (!_signedIn)
                        IconButton(
                          tooltip: t('ย้อนกลับ', 'Back'),
                          onPressed: _busy
                              ? null
                              : () => setState(() {
                                  if (_sent) {
                                    _sent = false;
                                    _code.clear();
                                  } else {
                                    _welcome = true;
                                  }
                                  _error = null;
                                }),
                          icon: const Icon(Icons.chevron_left),
                          style: IconButton.styleFrom(
                            minimumSize: const Size(44, 44),
                            side: BorderSide(
                              color: Theme.of(context)
                                  .colorScheme
                                  .outlineVariant,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                        ),
                      if (!_signedIn) const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _signedIn
                              ? 'BitPOS Driver'
                              : _sent
                              ? t('ยืนยันเบอร์โทรศัพท์', 'Verify phone')
                              : t('เข้าสู่ระบบไรเดอร์', 'Rider sign in'),
                          style: TextStyle(
                            fontSize: 20,
                            height: 1.65,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (constraints.maxWidth < 330)
                        IconButton(
                          tooltip: _thai ? 'English' : 'ไทย',
                          onPressed: () => setState(() => _thai = !_thai),
                          icon: const Icon(Icons.language),
                        )
                      else
                        TextButton(
                          onPressed: () => setState(() => _thai = !_thai),
                          child: Text(_thai ? 'English' : 'ไทย'),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                if (_busy) const LinearProgressIndicator(),
                if (_error != null)
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      _message(_error!),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                if (!_signedIn) ...[
                  const SizedBox(height: 48),
                  Text(
                    _sent
                        ? t('ใส่รหัส 6 หลัก', 'Enter the six-digit code')
                        : t(
                            'พร้อมออกไปส่งความอร่อย?',
                            'Ready to deliver something good?',
                          ),
                    style: Theme.of(context).textTheme.headlineSmall
                        ?.copyWith(fontSize: _sent ? 27 : 24),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _sent
                        ? t(
                            'ส่งรหัสไปยัง $_maskedSignInPhone',
                            'Code sent to $_maskedSignInPhone',
                          )
                        : t(
                            'ใช้หมายเลขโทรศัพท์เพื่อเข้าสู่บัญชีไรเดอร์ของคุณ',
                            'Use your phone number to sign in to your rider account',
                          ),
                  ),
                  const SizedBox(height: 48),
                  Form(
                    key: _signInForm,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (!_sent)
                          TextFormField(
                            controller: _phone,
                            enabled: !_busy && !_sent,
                            keyboardType: TextInputType.phone,
                            autofillHints: const [
                              AutofillHints.telephoneNumber,
                            ],
                            decoration: _signInDecoration(
                              context,
                              t('เบอร์โทร +66…', 'Phone +66…'),
                            ),
                            validator: (value) =>
                                RegExp(r'^\+[1-9][0-9]{7,14}$')
                                    .hasMatch(value?.trim() ?? '')
                                ? null
                                : t(
                                    'ใช้รูปแบบ +66…',
                                    'Use international +66… format',
                                  ),
                          ),
                        if (_sent) ...[
                          const SizedBox(height: 16),
                          DriverOtpField(
                            controller: _code,
                            enabled: !_busy,
                            label: t('รหัส OTP', 'OTP code'),
                            invalidMessage: t(
                              'กรอกรหัส 6 หลัก',
                              'Enter six digits',
                            ),
                          ),
                        ],
                        const SizedBox(height: 24),
                        FilledButton(
                          onPressed: _busy || _api == null
                              ? null
                              : () {
                                  if (_signInForm.currentState!.validate())
                                    _run(_login);
                                },
                          child: Text(
                            _sent
                                ? t('ยืนยัน OTP', 'Verify OTP')
                                : t('ขอ OTP', 'Request OTP'),
                          ),
                        ),
                        if (_sent)
                          TextButton(
                            onPressed: _busy
                                ? null
                                : () => setState(() {
                                    _sent = false;
                                    _code.clear();
                                    _error = null;
                                  }),
                            child: Text(
                              t(
                                'เปลี่ยนหมายเลข / ขอรหัสใหม่',
                                'Change number / request another code',
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (!_sent) ...[
                    const SizedBox(height: 32),
                    Text(
                      t(
                        'บัญชีไรเดอร์ใช้แยกจากบัญชีลูกค้า',
                        'Your rider account is separate from your customer account',
                      ),
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      t(
                        'ดูสถานะการสมัครและเอกสารได้ในแอพ',
                        'Check your application and documents in the app',
                      ),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ] else ...[
                  if (p != null) ...[
                    DriverIdentityCard(profile: p, thai: _thai),
                    const SizedBox(height: 26),
                    DriverAccountActions(
                      thai: _thai,
                      onHelp: frozen ? null : () => unawaited(_openHelp()),
                      onRides: frozen || _api == null
                          ? null
                          : () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => DriverRidesPage(
                                  gateway: DriverRideGateway.fromApi(_api!),
                                  thai: _thai,
                                ),
                              ),
                            ),
                      onPassengerPreview: frozen
                          ? null
                          : () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) =>
                                    PassengerOfferPreviewPage(thai: _thai),
                              ),
                            ),
                      onLocation: frozen
                          ? null
                          : () => unawaited(_openDestination(0)),
                      onEarnings: frozen
                          ? null
                          : () => unawaited(_openDestination(2)),
                    ),
                    const SizedBox(height: 26),
                  ],
                  Text(
                    t('พร้อมรับงานวันนี้', 'Availability today'),
                    style: const TextStyle(
                      fontSize: 20,
                      height: 1.65,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (p != null) ...[
                    DriverAvailabilityCard(
                      label: _snapshotStale
                          ? t(
                              'สถานะหมดอายุหรือยังไม่ยืนยัน โหลดล่าสุด',
                              'Availability snapshot expired or unconfirmed. Refresh.',
                            )
                          : p.availability.online
                          ? t(
                              'ออนไลน์ตามเซิร์ฟเวอร์',
                              'Online according to server',
                            )
                          : t(
                              'ออฟไลน์ตามเซิร์ฟเวอร์',
                              'Offline according to server',
                            ),
                      online: p.availability.online,
                      stale: _snapshotStale,
                      onToggle:
                          frozen ||
                              _snapshotStale ||
                              (!p.availability.online &&
                                  !p.availability.verificationCurrent)
                          ? null
                          : () => _run(
                              () => _submit(
                                _api!.driverAvailabilityCommand(
                                  p,
                                  !p.availability.online,
                                ),
                              ),
                            ),
                    ),
                    const SizedBox(height: 18),
                    _foodWork(),
                    const SizedBox(height: 22),
                    Text(
                      _status(p.status),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (p.decisionReason.isNotEmpty) Text(p.decisionReason),
                    if (p.verifiedUntil != null)
                      Text(
                        '${t('ตรวจสอบถึง', 'Verified until')}: ${p.verifiedUntil}',
                      ),
                    if (!p.availability.verificationCurrent)
                      Text(
                        t(
                          'เอกสารหรือการตรวจสอบยังไม่พร้อม/หมดอายุ',
                          'Verification or documents not current',
                        ),
                      ),
                    const SizedBox(height: BitPosDesignTokens.s12),
                    Text(
                      t(
                        'การออนไลน์มีอายุ 90 วินาที ต้องต่ออายุ ไม่ใช่การรับงานหรือการติดตามตำแหน่ง',
                        'Online availability expires after90seconds and needs renewal. It is not an assignment or location tracking.',
                      ),
                    ),
                    const SizedBox(height: BitPosDesignTokens.s20),
                    FilledButton(
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                        textStyle: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      onPressed:
                          frozen ||
                              _snapshotStale ||
                              !p.availability.verificationCurrent
                          ? null
                          : () => _run(
                              () => _submit(
                                _api!.driverAvailabilityCommand(p, true),
                              ),
                            ),
                      child: Text(t('ออนไลน์ / ต่ออายุ', 'Go online / renew')),
                    ),
                    const SizedBox(height: BitPosDesignTokens.s8),
                    OutlinedButton(
                      onPressed: frozen
                          ? null
                          : () => _run(
                              () => _submit(
                                _api!.driverAvailabilityCommand(p, false),
                              ),
                            ),
                      child: Text(t('ออฟไลน์', 'Go offline')),
                    ),
                  ],
                  if (p == null && _profileKnown) ...[
                    _foodWork(),
                    const SizedBox(height: 20),
                  ],
                  if (!_profileKnown)
                    Text(
                      t(
                        'ยังโหลดโปรไฟล์ไม่สำเร็จ โหลดสถานะก่อนแก้ไขใบสมัคร',
                        'Profile not loaded. Refresh server state before editing your application.',
                      ),
                    ),
                  if (_pending != null) ...[
                    Text(
                      t(
                        'ยังไม่ทราบผลคำสั่ง ต้องตรวจคำสั่งเดิมก่อนแก้ไข',
                        'Command result unknown. Resolve original before editing.',
                      ),
                    ),
                    FilledButton(
                      onPressed: _busy
                          ? null
                          : () => _run(() => _submit(_pending!)),
                      child: Text(
                        t('ส่งคำสั่งเดิมอีกครั้ง', 'Retry original command'),
                      ),
                    ),
                  ],
                  OutlinedButton(
                    onPressed: _busy ? null : () => _run(_load),
                    child: Text(
                      t('โหลดสถานะเซิร์ฟเวอร์', 'Refresh server state'),
                    ),
                  ),
                  if (_push != null)
                    MobilePushSettings(controller: _push!, thai: _thai),
                  TextButton(
                    onPressed: _busy ? null : () => _run(_logout),
                    child: Text(t('ออกจากระบบ', 'Sign out')),
                  ),
                  if (_profileKnown) ...[
                    const SizedBox(height: BitPosDesignTokens.s32),
                    OutlinedButton.icon(
                      key: const ValueKey('driver-open-application'),
                      onPressed: frozen
                          ? null
                          : () => setState(() => _applicationOpen = true),
                      icon: const Icon(Icons.badge_outlined),
                      label: Text(t('ข้อมูลใบสมัคร', 'Application details')),
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    unawaited(_sessionChanges?.cancel());
    _owner++;
    WidgetsBinding.instance.removeObserver(this);
    _deadline?.cancel();
    for (final c in [_phone, _code, _name, _plate, _brand, _color]) {
      c.dispose();
    }
    final push = _push, api = _api;
    if (push != null) {
      unawaited(
        push.close().whenComplete(() {
          if (widget.api == null) api?.close();
        }),
      );
    } else if (widget.api == null) {
      api?.close();
    }
    super.dispose();
  }
}
