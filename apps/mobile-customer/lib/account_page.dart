import 'address_pin_page.dart';
import 'presentation/saved_address_card.dart';
import 'account_privacy_page.dart';
import 'account_sessions_page.dart';
import 'presentation/account_identity_card.dart';
import 'presentation/customer_navigation.dart';
import 'help_page.dart';
import 'presentation/feature_preview_pages.dart';
import 'group_cart_page.dart';
import 'ride_request_page.dart';
import 'rewards_page.dart';
import 'order_again_page.dart';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_info.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/account_mutation.dart';
import 'package:mobile_shared/owned_route.dart';

class AccountPage extends StatefulWidget {
  const AccountPage({
    super.key,
    required this.api,
    required this.owner,
    required this.thai,
    required this.onAuthenticationRequired,
    this.onNavigate,
    this.onSignOut,
    this.notificationSettings,
  });
  final ValueChanged<int>? onNavigate;
  final Future<void> Function()? onSignOut;
  final Widget? notificationSettings;
  final MobileApi api;
  final ValueListenable<bool> owner;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  @override
  State<AccountPage> createState() => _AccountPageState();
}

enum _AccountSection { overview, settings, profile, addresses }

class _AccountPageState extends State<AccountPage> {
  late _AccountSection? _section = widget.onNavigate == null
      ? null
      : _AccountSection.overview;
  final _name = TextEditingController(),
      _label = TextEditingController(),
      _recipientContact = TextEditingController(),
      _recipientPhone = TextEditingController(),
      _address = TextEditingController(),
      _instructions = TextEditingController();
  final _latitude = TextEditingController(),
      _longitude = TextEditingController();
  final _addressScrollController = ScrollController();
  final _profileForm = GlobalKey<FormState>(),
      _addressForm = GlobalKey<FormState>();
  MobileProfile? _profile;
  final List<MobileAddress> _addresses = [];
  String? _cursor;
  String _locale = 'th';
  MobileAddress? _editing;
  bool _showEditor = false, _busy = true;
  Object? _error;
  AccountMutation? _pending;
  ModalRoute<dynamic>? _route;
  DialogRoute<bool>? _signOutRoute;
  MaterialPageRoute<(int?, int?)>? _pinRoute;
  bool get _current => mounted && widget.owner.value;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    widget.owner.addListener(_ownerChanged);
    if (widget.owner.value) _initialize();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
    if (!widget.owner.value) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _ownerChanged();
      });
    }
  }

  void _ownerChanged() {
    if (!widget.owner.value) {
      removeOwnedRoute(_pinRoute);
      removeOwnedRoute(_signOutRoute);
      removeOwnedRoute(_route);
    }
  }

  @override
  void dispose() {
    widget.owner.removeListener(_ownerChanged);
    removeOwnedRoute(_pinRoute);
    for (final controller in [
      _name,
      _label,
      _recipientContact,
      _recipientPhone,
      _address,
      _instructions,
      _latitude,
      _longitude,
    ]) {
      controller.dispose();
    }
    _addressScrollController.dispose();
    super.dispose();
  }

  Future<void> _initialize() async {
    try {
      await _load();
    } catch (error) {
      _handleError(error);
    }
    if (_current) setState(() => _busy = false);
  }

  void _handleError(Object error) {
    _error = error;
    if (_current &&
        error is MobileApiException &&
        error.code == 'AUTH_REQUIRED' &&
        !widget.api.signedIn) {
      widget.onAuthenticationRequired();
    }
  }

  void _scrollAddressesToTop() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_current && _addressScrollController.hasClients) {
        _addressScrollController.jumpTo(0);
      }
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    if (!_current || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      _handleError(error);
    }
    if (_current) setState(() => _busy = false);
  }

  Future<void> _load() async {
    final pending = await widget.api.pendingAccountMutation();
    if (!_current) return;
    _pending = pending;
    final profile = await widget.api.profile();
    if (!_current) return;
    _profile = profile;
    _name.text = profile.displayName;
    _locale = profile.locale;
    final page = await widget.api.addresses();
    if (!_current) return;
    _addresses
      ..clear()
      ..addAll(page.addresses);
    _cursor = page.nextCursor;
    // Reload replaces the editing snapshot as well as the list. Never reuse a
    // stale expectedVersion after a concurrent edit or archive.
    _editing = null;
    _showEditor = false;
  }

  Future<void> _mutate(AccountMutation command) async {
    _pending = command;
    try {
      await widget.api.submitAccountMutation(command);
      if (!_current) return;
      _pending = null;
      _showEditor = false;
      _editing = null;
      await _load();
      _scrollAddressesToTop();
    } catch (error) {
      if (_current && widget.api.signedIn) {
        try {
          _pending = await widget.api.pendingAccountMutation();
        } catch (_) {
          /* Preserve command if secure storage is unavailable. */
        }
      }
      rethrow;
    }
  }

  Future<void> _more() async {
    final cursor = _cursor;
    if (cursor == null) return;
    final page = await widget.api.addresses(cursor: cursor);
    if (!_current) return;
    final ids = _addresses.map((a) => a.id).toSet();
    _addresses.addAll(page.addresses.where((a) => ids.add(a.id)));
    _cursor = page.nextCursor;
  }

  String _coordinate(int? e7) {
    if (e7 == null) return '';
    final value = e7.abs(),
        fraction = (value % 10000000)
            .toString()
            .padLeft(7, '0')
            .replaceFirst(RegExp(r'0+$'), '');
    return '${e7 < 0 ? '-' : ''}${value ~/ 10000000}${fraction.isEmpty ? '' : '.$fraction'}';
  }

  int? _parseCoordinate(String text) {
    final match = RegExp(r'^(-?)([0-9]{1,3})(?:\.([0-9]{1,7}))?$')
        .firstMatch(text.trim());
    if (match == null) return null;
    final value =
        int.parse(match[2]!) * 10000000 +
        int.parse((match[3] ?? '').padRight(7, '0'));
    return match[1] == '-' ? -value : value;
  }

  void _edit(MobileAddress? address) {
    if (_busy || _pending != null) return;
    setState(() {
      _editing = address;
      _showEditor = true;
      _label.text = address?.address.label ?? '';
      _recipientContact.text = address?.address.recipientName ?? '';
      _recipientPhone.text = address?.address.phone ?? '';
      _address.text = address?.address.addressText ?? '';
      _instructions.text = address?.address.instructions ?? '';
      _latitude.text = _coordinate(address?.address.latitudeE7);
      _longitude.text = _coordinate(address?.address.longitudeE7);
    });
    _scrollAddressesToTop();
  }

  void _saveAddress() {
    if (!_addressForm.currentState!.validate()) return;
    final fields = MobileAddressFields(
      label: _label.text.trim(),
      recipientName: _recipientContact.text.trim(),
      phone: _recipientPhone.text.trim(),
      addressText: _address.text.trim(),
      instructions: _instructions.text.trim(),
      latitudeE7: _parseCoordinate(_latitude.text),
      longitudeE7: _parseCoordinate(_longitude.text),
    );
    _run(
      () => _mutate(
        _editing == null
            ? widget.api.createAddressMutation(fields)
            : widget.api.updateAddressMutation(_editing!, fields),
      ),
    );
  }

  bool _pinOpening = false;
  Future<void> _chooseAddressPin() async {
    if (!_current || _pinOpening) return;
    _pinOpening = true;
    try {
      final navigator = Navigator.of(context);
      FocusScope.of(context).unfocus();
      await Future<void>.delayed(const Duration(milliseconds: 200));
      if (!_current) return;
      final route = MaterialPageRoute<(int?, int?)>(
        builder: (_) => AddressPinPage(
          thai: widget.thai,
          latitudeE7: _parseCoordinate(_latitude.text),
          longitudeE7: _parseCoordinate(_longitude.text),
        ),
      );
      _pinRoute = route;
      final pin = await navigator.push(route);
      if (identical(_pinRoute, route)) _pinRoute = null;
      if (!_current || pin == null) return;
      setState(() {
        _latitude.text = _coordinate(pin.$1);
        _longitude.text = _coordinate(pin.$2);
      });
    } finally {
      _pinOpening = false;
    }
  }

  String _errorMessage(Object error) {
    final code = error is MobileApiException ? error.code : 'NETWORK';
    return switch (code) {
      'VERSION_CONFLICT' => t(
        'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก',
        'Details changed. Reload before saving.',
      ),
      'ADDRESS_LIMIT' => t(
        'บันทึกได้สูงสุด 50 ที่อยู่ กรุณาลบที่ไม่ใช้',
        'Up to 50 saved addresses. Remove an unused address.',
      ),
      'PENDING_ACCOUNT_RECOVERY_REQUIRED' => t(
        'กู้คืนคำขอเดิมก่อนแก้ไขข้อมูลอื่น',
        'Recover the saved change before making another change.',
      ),
      'IDEMPOTENCY_CONFLICT' => t(
        'คำขอเดิมไม่ตรงกัน เก็บข้อมูลเดิมไว้และติดต่อผู้ดูแล',
        'Saved command conflict. Keep the original request and contact support.',
      ),
      'INVALID_REQUEST' => t(
        'ตรวจสอบชื่อ ที่อยู่ และหมายเลขโทรศัพท์',
        'Check the name, address and international phone number.',
      ),
      'RESOURCE_NOT_FOUND' => t(
        'ไม่พบที่อยู่นี้ กรุณาโหลดรายการใหม่',
        'Address unavailable. Reload your saved addresses.',
      ),
      'AUTH_REQUIRED' => t('กรุณาเข้าสู่ระบบใหม่', 'Please sign in again.'),
      _ => t(
        'เชื่อมต่อไม่ได้ หากบันทึกแล้วให้ลองคำขอเดิมเท่านั้น',
        'Connection unavailable. If saved, retry only the original change.',
      ),
    };
  }

  Future<void> _confirmSignOut() async {
    if (!_current ||
        _busy ||
        _signOutRoute != null ||
        widget.onSignOut == null) {
      return;
    }
    final route = DialogRoute<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(t('ออกจากระบบทุกอุปกรณ์?', 'Sign out all devices?')),
        content: Text(
          t(
            'ต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์ คำขอที่บันทึกไว้จะยังอยู่เพื่อกู้คืนเมื่อกลับมา',
            'You will need to sign in again on each device. Saved requests remain available for recovery when you return.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(t('ยกเลิก', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(t('ยืนยันออกจากระบบ', 'Confirm sign out')),
          ),
        ],
      ),
    );
    _signOutRoute = route;
    final confirmed = await Navigator.of(context).push(route);
    if (identical(_signOutRoute, route)) _signOutRoute = null;
    if (_current && confirmed == true) await _run(widget.onSignOut!);
  }

  Widget _accountTile(
    IconData icon,
    String title,
    String subtitle,
    VoidCallback? action, {
    Key? key,
  }) => Padding(
    padding: EdgeInsets.only(
      bottom: _section == _AccountSection.settings ? 22 : 16,
    ),
    child: Material(
      key: key,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xffe9e1f1)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: action,
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
                    color: const Color(0xffefe6f8),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(icon, color: const Color(0xff64188a)),
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
                          color: Color(0xff29183f),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xff7b7088),
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, color: Color(0xff64188a)),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  Widget _overviewTiles() => LayoutBuilder(
    builder: (context, constraints) {
      final addresses = _accountTile(
        Icons.location_on_outlined,
        t('ที่อยู่ของฉัน', 'My addresses'),
        t('จัดการที่อยู่จัดส่งที่บันทึกไว้', 'Manage saved delivery addresses'),
        _busy
            ? null
            : () => setState(() => _section = _AccountSection.addresses),
        key: const ValueKey('account-addresses-tile'),
      );
      final settings = _accountTile(
        Icons.manage_accounts_outlined,
        t('ตั้งค่าบัญชี', 'Account settings'),
        t('ชื่อที่แสดงและภาษา', 'Display name and language'),
        _busy
            ? null
            : () => setState(() => _section = _AccountSection.settings),
        key: const ValueKey('account-settings-tile'),
      );
      final help = _accountTile(
        Icons.support_agent,
        t('ศูนย์ช่วยเหลือ', 'Help centre'),
        t(
          'ติดต่อและติดตามเรื่องที่แจ้ง',
          'Contact support and track your cases',
        ),
        _busy ? null : _help,
        key: const ValueKey('account-help-tile'),
      );
      final rides = _accountTile(
        Icons.local_taxi_outlined,
        t('เรียกรถ', 'Request a ride'),
        t(
          'เลือกจุดรับส่งจากที่อยู่ที่บันทึกไว้ ดูค่าโดยสารและติดตามเที่ยว',
          'Pick saved addresses, see the fare and follow your trip',
        ),
        _busy
            ? null
            : () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => RideRequestPage(
                    gateway: RiderRideGateway.fromApi(widget.api),
                    thai: widget.thai,
                  ),
                ),
              ),
        key: const ValueKey('account-rides-tile'),
      );
      final groups = _accountTile(
        Icons.groups_outlined,
        t('สั่งเป็นกลุ่ม', 'Group order'),
        t(
          'เลือกรายการร่วมกับเพื่อน ล็อกกลุ่ม แล้วแต่ละคนสั่งของตัวเอง',
          'Pick items together, lock the group, then each member orders their own',
        ),
        _busy
            ? null
            : () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => GroupCartPage(
                    gateway: GroupCartGateway.fromApi(widget.api),
                    thai: widget.thai,
                  ),
                ),
              ),
        key: const ValueKey('account-groups-tile'),
      );
      final orderAgain = _accountTile(
        Icons.history,
        t('สั่งอีกครั้ง', 'Order again'),
        t(
          'ดูรายการจากออเดอร์ที่คุณจ่ายแล้ว',
          'Suggestions from your own paid orders',
        ),
        _busy
            ? null
            : () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => OrderAgainPage(
                    api: widget.api,
                    owner: widget.owner,
                    thai: widget.thai,
                    onAuthenticationRequired: widget.onAuthenticationRequired,
                  ),
                ),
              ),
        key: const ValueKey('account-order-again-tile'),
      );
      final rewards = _accountTile(
        Icons.card_giftcard_outlined,
        t('แต้มและรางวัล', 'Points and rewards'),
        t(
          'ดูแต้มจากออเดอร์ที่ชำระแล้ว และแลกคูปองส่วนลด',
          'See points from paid orders and redeem discount vouchers',
        ),
        _busy
            ? null
            : () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => RewardsPage(
                    api: widget.api,
                    owner: widget.owner,
                    thai: widget.thai,
                    onAuthenticationRequired: widget.onAuthenticationRequired,
                  ),
                ),
              ),
        key: const ValueKey('account-rewards-tile'),
      );
      final previews = _accountTile(
        Icons.auto_awesome_outlined,
        t('ฟีเจอร์ที่กำลังมา', 'Coming features'),
        t(
          'ตัวอย่างฟีเจอร์ที่ยังไม่เปิดใช้งานจริง',
          'Samples of features that are not live yet',
        ),
        _busy
            ? null
            : () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => FeaturePreviewHubPage(
                    thai: widget.thai,
                    onNavigationSelected: widget.onNavigate,
                    rewardsBuilder: (_) => RewardsPage(
                      api: widget.api,
                      owner: widget.owner,
                      thai: widget.thai,
                      onAuthenticationRequired: widget.onAuthenticationRequired,
                    ),
                  ),
                ),
              ),
        key: const ValueKey('account-previews-tile'),
      );
      if (constraints.maxWidth < 680) {
        return Column(
          children: [
            addresses,
            settings,
            rides,
            groups,
            orderAgain,
            rewards,
            previews,
            help,
            const SizedBox(height: 14),
          ],
        );
      }
      final half = (constraints.maxWidth - 20) / 2;
      return Wrap(
        spacing: 20,
        runSpacing: 0,
        children: [
          SizedBox(width: half, child: addresses),
          SizedBox(width: half, child: settings),
          SizedBox(width: half, child: rides),
          SizedBox(width: half, child: groups),
          SizedBox(width: half, child: orderAgain),
          SizedBox(width: half, child: rewards),
          SizedBox(width: half, child: previews),
          SizedBox(width: half, child: help),
          const SizedBox(width: 20, height: 14),
        ],
      );
    },
  );
  void _help() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => HelpPage(
          api: widget.api,
          owner: widget.owner,
          thai: widget.thai,
          onAuthenticationRequired: widget.onAuthenticationRequired,
        ),
      ),
    );
  }

  InputDecoration _addressDecoration({String? hint}) => InputDecoration(
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    counterText: '',
    hintText: hint,
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(
        color: Theme.of(context).colorScheme.outlineVariant,
      ),
    ),
  );

  Widget _addressField(String label, Widget field) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(label, style: Theme.of(context).textTheme.bodySmall),
      const SizedBox(height: 4),
      Semantics(label: label, child: field),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final locked = _busy || _pending != null;
    final viewportWidth = MediaQuery.sizeOf(context).width;
    final contentInset = viewportWidth > 900 ? (viewportWidth - 852) / 2 : 24.0;
    final detail =
        !_showEditor &&
        (_section == null ||
            _section == _AccountSection.profile ||
            _section == _AccountSection.addresses);
    return PopScope(
      canPop: _section == null || _section == _AccountSection.overview,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && mounted) {
          setState(() {
            if (_showEditor) {
              _showEditor = false;
            } else {
              _section = _section == _AccountSection.profile
                  ? _AccountSection.settings
                  : _AccountSection.overview;
            }
          });
        }
      },
      child: Scaffold(
        backgroundColor: Theme.of(context).colorScheme.surface,
        bottomNavigationBar: !_showEditor && widget.onNavigate == null
            ? null
            : SafeArea(
                top: false,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_showEditor)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
                        child: Center(
                          heightFactor: 1,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 520),
                            child: SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                key: const ValueKey('address-save-action'),
                                onPressed: locked ? null : _saveAddress,
                                child: Text(t('บันทึกที่อยู่', 'Save address')),
                              ),
                            ),
                          ),
                        ),
                      ),
                    if (widget.onNavigate != null)
                      CustomerNavigation(
                        thai: widget.thai,
                        selectedIndex: 3,
                        onSelected: _busy ? null : widget.onNavigate,
                      ),
                  ],
                ),
              ),
        appBar: AppBar(
          backgroundColor: Theme.of(context).colorScheme.surface,
          // Keep the native content baseline at112dp across system top insets.
          toolbarHeight:
              (112.0 - MediaQuery.paddingOf(context).top).clamp(48.0, 68.0) +
              (MediaQuery.textScalerOf(context).scale(20) - 20) * 2,
          leadingWidth: 76,
          titleSpacing: _section != null && _section != _AccountSection.overview
              ? 0
              : 24,
          leading: _section != null && _section != _AccountSection.overview
              ? Padding(
                  padding: const EdgeInsets.only(left: 18, right: 10),
                  child: Center(
                    child: IconButton.filledTonal(
                      tooltip: _showEditor
                          ? t('กลับไปที่อยู่', 'Back to addresses')
                          : _section == _AccountSection.profile
                          ? t('กลับไปตั้งค่า', 'Back to settings')
                          : t('กลับไปบัญชี', 'Back to account'),
                      onPressed: () => setState(() {
                        if (_showEditor) {
                          _showEditor = false;
                        } else {
                          _section = _section == _AccountSection.profile
                              ? _AccountSection.settings
                              : _AccountSection.overview;
                        }
                      }),
                      style: IconButton.styleFrom(
                        minimumSize: const Size(48, 48),
                        backgroundColor: Theme.of(context).cardTheme.color,
                        foregroundColor: Theme.of(context).colorScheme.primary,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      icon: const Icon(Icons.chevron_left, size: 22),
                    ),
                  ),
                )
              : null,
          title: _section == _AccountSection.overview
              ? Image.asset(
                  'assets/design/bitpos-logo.png',
                  width: 104,
                  height: 38,
                  fit: BoxFit.contain,
                  semanticLabel: 'BitPOS',
                )
              : Text(
                  _showEditor
                      ? _editing == null
                            ? t('เพิ่มที่อยู่ใหม่', 'Add a new address')
                            : t('แก้ไขที่อยู่', 'Edit address')
                      : _section == _AccountSection.settings
                      ? t('ตั้งค่าบัญชี', 'Account settings')
                      : _section == _AccountSection.profile
                      ? t('โปรไฟล์และภาษา', 'Profile and language')
                      : _section == _AccountSection.addresses
                      ? t('ที่อยู่ของฉัน', 'My addresses')
                      : t('บัญชีและที่อยู่', 'Account and addresses'),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  ),
                ),
        ),
        body: RefreshIndicator(
          onRefresh: () => _run(_load),
          child: ListView(
            controller: _addressScrollController,
            physics: const AlwaysScrollableScrollPhysics(),
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: EdgeInsets.fromLTRB(
              contentInset,
              _showEditor
                  ? 20
                  : _section == _AccountSection.addresses
                  ? 27
                  : _section == _AccountSection.overview
                  ? 16
                  : 24,
              contentInset,
              24,
            ),
            children: [
              if (_section == _AccountSection.overview) ...[
                Text(
                  t('บัญชีของคุณ', 'Your account'),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: Color(0xff29183f),
                  ),
                ),
                const SizedBox(height: 16),
                if (_profile != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 26),
                    child: AccountIdentityCard(
                      name: _profile!.displayName,
                      thai: widget.thai,
                    ),
                  ),
                _overviewTiles(),
              ],
              if (_section == null)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.support_agent),
                  title: Text(t('ศูนย์ช่วยเหลือ', 'Help centre')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: _busy ? null : _help,
                ),
              if (detail && _section != _AccountSection.addresses)
                BitPosInfoLine(
                  thai: widget.thai,
                  summary: t('ข้อมูลของบัญชีคุณ', 'Your account details'),
                  title: t('เกี่ยวกับข้อมูลนี้', 'About these details'),
                  paragraphs: [
                    t(
                      'ข้อมูลนี้เป็นของบัญชีคุณ ไม่ได้รวมกับรายชื่อลูกค้าของร้านโดยอัตโนมัติ',
                      'These details belong to your account. They are not automatically merged with merchant customer records.',
                    ),
                  ],
                ),
              if (_busy) const LinearProgressIndicator(),
              if (_error != null)
                Semantics(
                  liveRegion: true,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      _errorMessage(_error!),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                ),
              if (_pending != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          t(
                            'มีคำขอแก้ไขที่บันทึกไว้ ผลอาจสำเร็จแล้ว ห้ามสร้างคำขอใหม่',
                            'A saved change may already have succeeded. Recover it before creating another request.',
                          ),
                        ),
                        FilledButton(
                          onPressed: _busy
                              ? null
                              : () => _run(() => _mutate(_pending!)),
                          child: Text(
                            t(
                              'กู้คืน / ลองคำขอเดิม',
                              'Recover / retry saved change',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if ((detail && _section != _AccountSection.addresses) ||
                  _error != null)
                OutlinedButton(
                  onPressed: _busy ? null : () => _run(_load),
                  child: Text(
                    t('โหลดข้อมูลจากเซิร์ฟเวอร์', 'Reload server details'),
                  ),
                ),
              if (_section == _AccountSection.settings) ...[
                _accountTile(
                  Icons.language,
                  t('โปรไฟล์และภาษา', 'Profile and language'),
                  t(
                    'ชื่อที่แสดง / ไทย / English',
                    'Display name / ไทย / English',
                  ),
                  _busy
                      ? null
                      : () =>
                            setState(() => _section = _AccountSection.profile),
                ),
                _accountTile(
                  Icons.devices,
                  t('อุปกรณ์ที่เข้าสู่ระบบ', 'Signed-in sessions'),
                  t(
                    'ตรวจสอบและยกเลิกรายการเข้าสู่ระบบ',
                    'Review and revoke sign-ins',
                  ),
                  _busy
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => AccountSessionsPage(
                              api: widget.api,
                              owner: widget.owner,
                              thai: widget.thai,
                              onAuthenticationRequired:
                                  widget.onAuthenticationRequired,
                            ),
                          ),
                        ),
                ),
                _accountTile(
                  Icons.privacy_tip_outlined,
                  t(
                    'ความเป็นส่วนตัวและการแจ้งเตือน',
                    'Privacy and notifications',
                  ),
                  t(
                    'การยินยอมและคำขอข้อมูลของคุณ',
                    'Consent and your data requests',
                  ),
                  _busy
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => AccountPrivacyPage(
                              api: widget.api,
                              owner: widget.owner,
                              thai: widget.thai,
                              onAuthenticationRequired:
                                  widget.onAuthenticationRequired,
                              notificationSettings: widget.notificationSettings,
                              onNavigate: widget.onNavigate,
                            ),
                          ),
                        ),
                ),
                if (widget.onSignOut != null)
                  _accountTile(
                    Icons.logout,
                    t('ออกจากระบบทุกอุปกรณ์', 'Sign out all devices'),
                    t('ยืนยันก่อนออกจากระบบ', 'Confirm before signing out'),
                    _busy ? null : _confirmSignOut,
                  ),
              ],
              if ((_section == null || _section == _AccountSection.profile) &&
                  _profile != null)
                Form(
                  key: _profileForm,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        t('โปรไฟล์', 'Profile'),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      TextFormField(
                        controller: _name,
                        enabled: !locked,
                        maxLength: 80,
                        decoration: InputDecoration(
                          labelText: t('ชื่อที่แสดง', 'Display name'),
                        ),
                      ),
                      DropdownButton<String>(
                        value: _locale,
                        isExpanded: true,
                        onChanged: locked
                            ? null
                            : (value) => setState(() => _locale = value!),
                        items: const [
                          DropdownMenuItem(value: 'th', child: Text('ไทย')),
                          DropdownMenuItem(value: 'en', child: Text('English')),
                        ],
                      ),
                      FilledButton(
                        onPressed: locked
                            ? null
                            : () {
                                if (_profileForm.currentState!.validate()) {
                                  _run(
                                    () => _mutate(
                                      widget.api.profileMutation(
                                        _profile!,
                                        _name.text.trim(),
                                        _locale,
                                      ),
                                    ),
                                  );
                                }
                              },
                        child: Text(t('บันทึกโปรไฟล์', 'Save profile')),
                      ),
                    ],
                  ),
                ),
              if (_section == null ||
                  _section == _AccountSection.addresses) ...[
                if (!_showEditor) ...[
                  if (_section == null) ...[
                    const SizedBox(height: 24),
                    Text(
                      t('ที่อยู่ที่บันทึกไว้', 'Saved addresses'),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ],
                  if (_addresses.isEmpty && !_busy)
                    Text(t('ยังไม่มีที่อยู่', 'No saved addresses yet.')),
                  ..._addresses.map(
                    (a) => SavedAddressCard(
                      key: ValueKey(a.id),
                      address: a,
                      thai: widget.thai,
                      onEdit: locked ? null : () => _edit(a),
                      onRemove: locked
                          ? null
                          : () => _run(
                              () =>
                                  _mutate(widget.api.archiveAddressMutation(a)),
                            ),
                    ),
                  ),
                  if (_cursor != null)
                    OutlinedButton(
                      onPressed: _busy ? null : () => _run(_more),
                      child: Text(
                        t('โหลดที่อยู่เพิ่มเติม', 'Load more addresses'),
                      ),
                    ),
                  OutlinedButton.icon(
                    onPressed: locked ? null : () => _edit(null),
                    icon: const Icon(Icons.add),
                    label: Text(t('เพิ่มที่อยู่', 'Add address')),
                  ),
                  if (_section == _AccountSection.addresses && _error == null)
                    TextButton(
                      onPressed: _busy ? null : () => _run(_load),
                      child: Text(
                        t('โหลดข้อมูลจากเซิร์ฟเวอร์', 'Reload server details'),
                      ),
                    ),
                  if (_section == _AccountSection.addresses)
                    BitPosInfoLine(
                      thai: widget.thai,
                      summary: t('ไม่ต้องเปิด GPS ที่อยู่ไม่ถูกส่งให้ใครโดยอัตโนมัติ', 'No GPS needed. Addresses are not shared automatically'),
                      title: t('เกี่ยวกับที่อยู่ของคุณ', 'About your addresses'),
                      paragraphs: [
                        t(
                          'ข้อมูลนี้เป็นของบัญชีคุณ ไม่ได้รวมกับรายชื่อลูกค้าของร้านโดยอัตโนมัติ',
                          'These details belong to your account. They are not automatically merged with merchant customer records.',
                        ),
                        t(
                          'เพิ่มที่อยู่ด้วยตนเอง ไม่บังคับเปิด GPS ที่อยู่ยังไม่ถูกส่งให้ร้านหรือไรเดอร์จนกว่าจะใช้ในงานที่อนุญาต',
                          'Enter an address manually; GPS is not required. Saving it does not share it with a merchant or driver.',
                        ),
                      ],
                    ),
                ],
                if (_showEditor)
                  Form(
                    key: _addressForm,
                    child: AddressEditorPanel(
                      children: [
                        _addressField(
                          t('ชื่อสถานที่', 'Place name'),
                          TextFormField(
                            key: const ValueKey('address-place-name'),
                            controller: _label,
                            enabled: !locked,
                            maxLength: 80,
                            decoration: _addressDecoration(),
                            validator: (value) =>
                                value == null || value.trim().isEmpty
                                ? t('ระบุชื่อสถานที่', 'Enter a place name')
                                : null,
                          ),
                        ),
                        const SizedBox(height: 29),
                        _addressField(
                          t('ที่อยู่', 'Address'),
                          TextFormField(
                            key: const ValueKey('address-street'),
                            controller: _address,
                            enabled: !locked,
                            maxLength: 1000,
                            minLines: 1,
                            maxLines: 2,
                            decoration: _addressDecoration(),
                            validator: (value) =>
                                value == null || value.trim().isEmpty
                                ? t(
                                    'ระบุรายละเอียดที่อยู่',
                                    'Enter the address',
                                  )
                                : null,
                          ),
                        ),
                        const SizedBox(height: 29),
                        _addressField(
                          t('ชื่อผู้รับ', 'Recipient name'),
                          TextFormField(
                            controller: _recipientContact,
                            enabled: !locked,
                            key: const ValueKey('address-recipient-name'),
                            maxLength: 80,
                            textCapitalization: TextCapitalization.words,
                            autofillHints: const [AutofillHints.name],
                            decoration: _addressDecoration(),
                            validator: (value) =>
                                value == null || value.trim().isEmpty
                                ? t(
                                    'ระบุชื่อผู้รับ',
                                    'Enter the recipient name',
                                  )
                                : null,
                          ),
                        ),
                        const SizedBox(height: 29),
                        _addressField(
                          t('เบอร์โทรศัพท์ผู้รับ', 'Recipient phone'),
                          TextFormField(
                            key: const ValueKey('address-recipient-phone'),
                            controller: _recipientPhone,
                            enabled: !locked,
                            maxLength: 16,
                            keyboardType: TextInputType.phone,
                            autofillHints: const [
                              AutofillHints.telephoneNumber,
                            ],
                            decoration: _addressDecoration(
                              hint: '+66812345678',
                            ),
                            validator: (value) =>
                                RegExp(r'^\+[1-9][0-9]{7,14}$')
                                    .hasMatch(value?.trim() ?? '')
                                ? null
                                : t(
                                    'ระบุเบอร์โทรพร้อมรหัสประเทศ',
                                    'Enter an international phone number',
                                  ),
                          ),
                        ),
                        const SizedBox(height: 29),
                        _addressField(
                          t('รายละเอียดเพิ่มเติม', 'Additional details'),
                          TextFormField(
                            key: const ValueKey('address-instructions'),
                            controller: _instructions,
                            enabled: !locked,
                            maxLength: 500,
                            minLines: 1,
                            maxLines: 2,
                            decoration: _addressDecoration(),
                          ),
                        ),
                        const SizedBox(height: 80),
                        ConstrainedBox(
                          constraints: const BoxConstraints(minHeight: 52),
                          child: OutlinedButton.icon(
                            onPressed: locked ? null : _chooseAddressPin,
                            icon: const Icon(Icons.location_on_outlined),
                            label: Text(t('ปักหมุดบนแผนที่', 'Pin on map')),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
