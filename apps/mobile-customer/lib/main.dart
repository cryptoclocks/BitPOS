import 'package:mobile_shared/presentation/ui_catalog.dart';

import 'presentation/customer_welcome.dart';
import 'presentation/customer_sign_in.dart';
import 'presentation/customer_navigation.dart';

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_push_controller.dart';
import 'package:mobile_shared/mobile_push_native.dart';
import 'package:mobile_shared/mobile_push_settings.dart';
import 'package:mobile_shared/owned_route.dart';

import 'food_page.dart';
import 'account_page.dart';
import 'presentation/quote_confirmation.dart';

void main() {
  runApp(const BitPosCustomer());
}

class BitPosCustomer extends StatelessWidget {
  const BitPosCustomer({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'BitPOS',
    debugShowCheckedModeBanner: false,
    theme: BitPosTheme.light(),
    darkTheme: BitPosTheme.dark(),
    themeMode: ThemeMode.system,
    home: const bool.fromEnvironment('BITPOS_UI_CATALOG')
        ? const BitPosUiCatalog(rider: false)
        : const CustomerSessionPage(),
  );
}

class CustomerSessionPage extends StatefulWidget {
  const CustomerSessionPage({super.key, this.api, this.pushNative});
  final MobileApi? api;
  final MobilePushNative? pushNative;
  @override
  State<CustomerSessionPage> createState() => _CustomerSessionPageState();
}

class _CustomerSessionPageState extends State<CustomerSessionPage> {
  final _foodNavigation = FoodPageNavigation();
  final _contentScroll = ScrollController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _form = GlobalKey<FormState>();
  MobileApi? _api;
  MobilePushController? _push;
  MobileAccount? _account;
  bool _busy = true;
  bool _sent = false;
  bool _welcome = true;
  bool _thai = true;
  Object? _error;
  ValueNotifier<bool> _foodOwner = ValueNotifier(true);
  StreamSubscription<PushOwner?>? _sessionOwner;
  Route<void>? _pushOrderRoute;
  void _retirePushOrder() {
    final route = _pushOrderRoute;
    _pushOrderRoute = null;
    removeOwnedRoute(route);
  }

  void _renewFoodOwner() {
    _foodOwner.dispose();
    _foodOwner = ValueNotifier(true);
  }

  bool _profileOpen = false;
  static const _fixture = bool.fromEnvironment('BITPOS_FIXTURE');
  String text(String th, String en) => _thai ? th : en;
  @override
  void initState() {
    super.initState();
    _foodNavigation.onCartReviewChanged = () {
      if (!mounted) return;
      setState(() {});
      // These screens replace a long menu/cart body with a short quote review.
      // Reset the root scroll after layout so the new body cannot remain
      // scrolled past its shorter extent and appear blank beneath the sticky CTA.
      if (_foodNavigation.cartReviewActive ||
          _foodNavigation.orderReviewActive ||
          _foodNavigation.orderDetailActive) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_contentScroll.hasClients && mounted) {
            _contentScroll.jumpTo(0);
          }
        });
      }
    };
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      const base = String.fromEnvironment('BITPOS_MOBILE_API');
      if (widget.api == null && base.isEmpty) {
        throw const MobileApiException('CONFIGURATION_REQUIRED', 503);
      }
      final api =
          widget.api ?? MobileApi(base: Uri.parse(base), fixture: _fixture);
      _api = api;
      await api.restore();
      if (api.signedIn) {
        _welcome = false;
        _account = await api.account();
        _thai = _account!.locale == 'th';
      }
      var logicalOwner = api.sessionScope;
      _sessionOwner = api.sessionScopes.listen((owner) {
        if (owner == logicalOwner) return;
        final previous = logicalOwner;
        logicalOwner = owner;
        if (previous != null && mounted) {
          _foodOwner.value = false;
          _retirePushOrder();
          setState(() {
            _account = null;
            _sent = false;
            _code.clear();
          });
        }
      });
      _push = MobilePushController(
        api: api,
        native:
            widget.pushNative ??
            FirebaseMobilePushNative(
              MobilePushConfiguration.fromEnvironment(),
              app: 'CUSTOMER',
            ),
        app: MobilePushApp.customer,
        locale: () => _thai ? 'th' : 'en',
        onOpen: (result, owner) {
          if (!mounted ||
              api.sessionScope != owner ||
              _account == null ||
              !_foodOwner.value)
            return;
          if (result is MobilePushOpenCustomerOrder) {
            _retirePushOrder();
            final routeOwner = _foodOwner;
            final route = MaterialPageRoute<void>(
              builder: (_) => ValueListenableBuilder<bool>(
                valueListenable: routeOwner,
                builder: (_, active, _) => !active
                    ? const SizedBox.shrink()
                    : Scaffold(
                        appBar: AppBar(
                          title: Text(
                            text('ข้อมูลออเดอร์ล่าสุด', 'Latest order'),
                          ),
                        ),
                        body: SingleChildScrollView(
                          child: FoodPage(
                            api: api,
                            thai: _thai,
                            owner: routeOwner,
                            initialOrderId: result.orderId,
                            onAuthenticationRequired: _authenticationRequired,
                          ),
                        ),
                      ),
              ),
            );
            _pushOrderRoute = route;
            unawaited(
              Navigator.of(context).push(route).whenComplete(() {
                if (identical(_pushOrderRoute, route)) _pushOrderRoute = null;
              }),
            );
          }
        },
      );
      await _push!.start();
    } catch (error) {
      _error = error;
    }
    if (mounted) setState(() => _busy = false);
  }

  String _message(Object error) {
    if (error is MobileApiException) {
      return switch (error.code) {
        'CONFIGURATION_REQUIRED' => text(
          'บริการยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
          'Service unavailable: configuration required',
        ),
        'AUTH_REQUIRED' => text(
          'กรุณาเข้าสู่ระบบใหม่หรือใช้รหัสที่ถูกต้อง',
          'Sign in again or check your verification code',
        ),
        'SESSION_EXPIRED' => text(
          'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่ คำขอเดิมยังถูกเก็บไว้',
          'Session expired. Sign in again; your saved order request is retained.',
        ),
        'PROVIDER_RATE_LIMITED' => text(
          'ส่งคำขอบ่อยเกินไป กรุณารอก่อนลองใหม่',
          'Too many requests. Wait before trying again',
        ),
        _ => text('ไม่สามารถทำรายการได้', 'Request failed'),
      };
    }
    return text(
      'เชื่อมต่อไม่ได้ กรุณาตรวจเครือข่ายแล้วลองใหม่',
      'Connection failed. Check your network and retry',
    );
  }

  Future<void> _submit() async {
    if (_busy || !_form.currentState!.validate() || _api == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_sent) {
        await _api!.verifyOtp(_phone.text.trim(), _code.text.trim());
        _account = await _api!.account();
        _thai = _account!.locale == 'th';
        _renewFoodOwner();
      } else {
        await _api!.requestOtp(_phone.text.trim());
        _sent = true;
      }
    } catch (error) {
      _error = error;
    }
    if (mounted) setState(() => _busy = false);
  }

  void _authenticationRequired() {
    if (!mounted) return;
    _foodOwner.value = false;
    _retirePushOrder();
    setState(() {
      _account = null;
      _sent = false;
      _code.clear();
      _error = const MobileApiException('SESSION_EXPIRED', 401);
    });
  }

  Future<void> _logout() async {
    _foodOwner.value = false;
    _retirePushOrder();
    unawaited(_push?.disable() ?? Future<void>.value());
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _api!.logout(allDevices: true);
      _account = null;
      _sent = false;
      _code.clear();
    } catch (error) {
      if (!_api!.signedIn) {
        _authenticationRequired();
      } else {
        _error = error;
      }
    }
    if (mounted) {
      if (_account != null) _renewFoodOwner();
      setState(() => _busy = false);
    }
  }

  Future<void> _openProfile() async {
    if (_busy || _profileOpen) return;
    _profileOpen = true;
    final owner = _foodOwner;
    int? destination;
    try {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (context) => AccountPage(
            onNavigate: (index) {
              if (index == 3) return;
              destination = index;
              Navigator.of(context).pop();
            },
            api: _api!,
            owner: owner,
            thai: _thai,
            onSignOut: _logout,
            notificationSettings: _push == null
                ? null
                : MobilePushSettings(controller: _push!, thai: _thai),
            onAuthenticationRequired: () {
              if (mounted && identical(owner, _foodOwner) && owner.value)
                _authenticationRequired();
            },
          ),
        ),
      );
      if (!mounted || !identical(owner, _foodOwner) || !owner.value) return;
      final account = await _api!.account();
      if (mounted && identical(owner, _foodOwner) && owner.value)
        setState(() {
          _account = account;
          _thai = account.locale == 'th';
        });
    } catch (error) {
      if (mounted && identical(owner, _foodOwner) && owner.value) {
        if (error is MobileApiException &&
            error.code == 'AUTH_REQUIRED' &&
            !_api!.signedIn) {
          _authenticationRequired();
        } else {
          setState(() => _error = error);
        }
      }
    } finally {
      _profileOpen = false;
    }
    if (!mounted || !identical(owner, _foodOwner) || !owner.value) return;
    if (destination == 1) {
      await _foodNavigation.showOrders();
    } else if (destination == 2) {
      await _foodNavigation.showFavourites();
    } else if (destination == 0 && _contentScroll.hasClients) {
      _contentScroll.animateTo(
        0,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  void dispose() {
    _contentScroll.dispose();
    _foodOwner.value = false;
    _retirePushOrder();
    unawaited(_sessionOwner?.cancel());
    _foodOwner.dispose();
    _phone.dispose();
    _code.dispose();
    final push = _push, api = _api;
    if (push != null) {
      unawaited(push.close().whenComplete(() => api?.close()));
    } else {
      api?.close();
    }
    super.dispose();
  }

  AppBar _foodHeader(String title, String backLabel, VoidCallback? onBack) =>
      AppBar(
        centerTitle: false,
        toolbarHeight:
            60 + (MediaQuery.textScalerOf(context).scale(20) - 20) * 2,
        leadingWidth: 76,
        titleSpacing: 0,
        title: Text(
          title,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
        leading: Padding(
          padding: EdgeInsets.fromLTRB(
            18,
            MediaQuery.textScalerOf(context).scale(20) - 20,
            10,
            12 + (MediaQuery.textScalerOf(context).scale(20) - 20),
          ),
          child: IconButton.filledTonal(
            tooltip: backLabel,
            onPressed: onBack,
            style: IconButton.styleFrom(
              minimumSize: const Size(48, 48),
              padding: EdgeInsets.zero,
              alignment: Alignment.topLeft,
              backgroundColor: Colors.transparent,
              foregroundColor: Theme.of(context).colorScheme.primary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            icon: Container(
              key: const ValueKey('customer-food-back-surface'),
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Theme.of(context).cardTheme.color,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Icon(Icons.chevron_left, size: 22),
            ),
          ),
        ),
      );

  bool get _foodBackActive =>
      _account != null &&
      (_foodNavigation.orderReviewActive ||
          _foodNavigation.cartReviewActive ||
          _foodNavigation.orderDetailActive ||
          _foodNavigation.menuTitle != null);

  void _backWithinFood() {
    if (_busy) return;
    if (_foodNavigation.orderReviewActive) {
      if (_foodNavigation.canReturnToCart) _foodNavigation.returnToCart();
    } else if (_foodNavigation.cartReviewActive) {
      if (_foodNavigation.canContinueOrderReview) {
        _foodNavigation.returnToMenu();
      }
    } else if (_foodNavigation.orderDetailActive) {
      _foodNavigation.leaveOrderDetail();
    } else if (_foodNavigation.canLeaveMenu) {
      _foodNavigation.leaveMenu();
    }
  }

  @override
  Widget build(BuildContext context) => _account == null && !_busy && _welcome
      ? CustomerWelcome(
          thai: _thai,
          onStart: () => setState(() => _welcome = false),
          onLanguage: () => setState(() => _thai = !_thai),
        )
      : PopScope<Object?>(
          canPop: !_foodBackActive,
          onPopInvokedWithResult: (didPop, result) {
            if (!didPop) _backWithinFood();
          },
          child: Scaffold(
            // Authenticated food screens own their one header; no second Material bar.
            appBar: _account == null
                ? AppBar(
                    title: const Text('BitPOS'),
                    actions: [
                      TextButton(
                        onPressed: () => setState(() => _thai = !_thai),
                        child: Text(_thai ? 'English' : 'ไทย'),
                      ),
                    ],
                  )
                : _foodNavigation.cartReviewActive
                ? _foodHeader(
                    text('ตะกร้าของคุณ', 'Your cart'),
                    text('กลับไปเมนู', 'Back to menu'),
                    _foodNavigation.canContinueOrderReview
                        ? _foodNavigation.returnToMenu
                        : null,
                  )
                : _foodNavigation.orderReviewActive
                ? _foodHeader(
                    text('ตรวจสอบออร์เดอร์', 'Review order'),
                    text('กลับไปตะกร้า', 'Back to cart'),
                    _foodNavigation.canReturnToCart
                        ? _foodNavigation.returnToCart
                        : null,
                  )
                : _foodNavigation.orderDetailActive
                ? AppBar(
                    centerTitle: false,
                    toolbarHeight: 44,
                    leadingWidth: 76,
                    titleSpacing: 0,
                    title: Transform.translate(
                      offset: Offset.zero,
                      child: Text(
                        _foodNavigation.orderDetailTitle ??
                            text('รายละเอียดออร์เดอร์', 'Order details'),
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    leading: Padding(
                      padding: const EdgeInsets.fromLTRB(18, 0, 14, 0),
                      child: IconButton.filledTonal(
                        tooltip:
                            _foodNavigation.orderDetailBackLabel ??
                            text('กลับไปออร์เดอร์', 'Back to orders'),
                        onPressed: _busy
                            ? null
                            : _foodNavigation.leaveOrderDetail,
                        style: IconButton.styleFrom(
                          backgroundColor:
                              Theme.of(context).brightness == Brightness.dark
                              ? Theme.of(context).colorScheme.surface
                              : Colors.white,
                          foregroundColor: Theme.of(context)
                              .colorScheme
                              .primary,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        icon: const Icon(Icons.chevron_left, size: 22),
                      ),
                    ),
                  )
                : _foodNavigation.menuTitle != null
                ? _foodHeader(
                    _foodNavigation.menuTitle!,
                    text('ร้านอาหาร', 'Merchants'),
                    _foodNavigation.canLeaveMenu
                        ? _foodNavigation.leaveMenu
                        : null,
                  )
                : (_account != null)
                ? AppBar(
                    toolbarHeight: 68,
                    titleSpacing: 24,
                    title: Image.asset(
                      'assets/design/bitpos-logo.png',
                      width: 104,
                      height: 38,
                      fit: BoxFit.contain,
                      semanticLabel: 'BitPOS',
                    ),
                    actions: [
                      IconButton(
                        tooltip: text(
                          'บัญชีและที่อยู่',
                          'Account and addresses',
                        ),
                        onPressed: _busy ? null : _openProfile,
                        icon: const Icon(Icons.account_circle_outlined),
                      ),
                      TextButton(
                        onPressed: () => setState(() => _thai = !_thai),
                        child: Text(_thai ? 'English' : 'ไทย'),
                      ),
                    ],
                  )
                : null,
            bottomNavigationBar:
                _foodNavigation.orderReviewActive &&
                    _foodNavigation.orderReviewValidUntil != null
                ? SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(24, 8, 24, 70),
                      child: Align(
                        alignment: Alignment.center,
                        heightFactor: 1,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 520),
                          child: QuoteConfirmation(
                            key: ValueKey(
                              'root-order-review-${_foodNavigation.orderReviewValidUntil}',
                            ),
                            validUntil: _foodNavigation.orderReviewValidUntil!,
                            thai: _thai,
                            delivery: _foodNavigation.orderReviewDelivery,
                            blocked: !_foodNavigation.canConfirmOrder,
                            onConfirm: _foodNavigation.confirmOrder,
                          ),
                        ),
                      ),
                    ),
                  )
                : SafeArea(
                    top: false,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (_account != null &&
                            _foodNavigation.cartReviewActive)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
                            child: Center(
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(
                                  maxWidth: 520,
                                ),
                                child: SizedBox(
                                  width: double.infinity,
                                  child: FilledButton(
                                    key: const ValueKey(
                                      'customer-cart-review-bottom-action',
                                    ),
                                    onPressed:
                                        _foodNavigation.canContinueOrderReview
                                        ? _foodNavigation.continueOrderReview
                                        : null,
                                    child: Text(
                                      text(
                                        'ไปตรวจสอบออเดอร์',
                                        'Continue to order review',
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        if (_account != null &&
                            _foodNavigation.orderDetailActive &&
                            _foodNavigation.orderDetailCanTrack)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(24, 8, 24, 8),
                            child: Center(
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(
                                  maxWidth: 520,
                                ),
                                child: SizedBox(
                                  width: double.infinity,
                                  child: FilledButton.icon(
                                    key: const ValueKey(
                                      'customer-order-detail-track-action',
                                    ),
                                    onPressed: _busy
                                        ? null
                                        : _foodNavigation.trackOrderDetail,
                                    icon: const Icon(Icons.delivery_dining),
                                    label: Text(
                                      _foodNavigation.orderDetailActionLabel ??
                                          text(
                                            'ติดตามการจัดส่ง',
                                            'Track delivery',
                                          ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        if (_account != null)
                          CustomerNavigation(
                            thai: _thai,
                            selectedIndex: _foodNavigation.orderDetailActive
                                ? 1
                                : 0,
                            onSelected: _busy
                                ? null
                                : (index) {
                                    if (index == 0) {
                                      if (_contentScroll.hasClients)
                                        _contentScroll.animateTo(
                                          0,
                                          duration: const Duration(
                                            milliseconds: 180,
                                          ),
                                          curve: Curves.easeOut,
                                        );
                                    } else if (index == 1) {
                                      unawaited(_foodNavigation.showOrders());
                                    } else if (index == 2) {
                                      unawaited(
                                        _foodNavigation.showFavourites(),
                                      );
                                    } else {
                                      unawaited(_openProfile());
                                    }
                                  },
                          ),
                        if (_fixture)
                          Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 24,
                              vertical: 8,
                            ),
                            child: Text(
                              'FIXTURE • Local sandbox; no real SMS/payment',
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                      ],
                    ),
                  ),
            body: SafeArea(
              child: Align(
                alignment: _account == null
                    ? Alignment.center
                    : Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: SingleChildScrollView(
                    key: const ValueKey('customer-root-content-scroll'),
                    controller: _contentScroll,
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(
                        24,
                        _account == null
                            ? 24
                            : _foodNavigation.orderDetailActive
                            ? 29
                            : (_foodNavigation.cartReviewActive ||
                                  _foodNavigation.orderReviewActive)
                            ? 13
                            : 8,
                        24,
                        24,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (_account == null) ...[
                            CustomerSignInHeading(
                              thai: _thai,
                              sent: _sent,
                              phone: _phone.text,
                            ),
                          ],
                          if (_busy) const LinearProgressIndicator(),
                          if (_error != null)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 16),
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
                          if (_account == null) ...[
                            CustomerSignInControls(
                              child: Form(
                                key: _form,
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    TextFormField(
                                      controller: _phone,
                                      enabled: !_busy && !_sent,
                                      keyboardType: TextInputType.phone,
                                      autofillHints: const [
                                        AutofillHints.telephoneNumber,
                                      ],
                                      decoration: InputDecoration(
                                        labelText: text(
                                          'โทรศัพท์พร้อมรหัสประเทศ',
                                          'Phone with country code',
                                        ),
                                        hintText: '+66…',
                                      ),
                                      validator: (value) =>
                                          RegExp(r'^\+[1-9][0-9]{7,14}$')
                                              .hasMatch(value?.trim() ?? '')
                                          ? null
                                          : text(
                                              'ใช้รูปแบบ +66…',
                                              'Use international +66… format',
                                            ),
                                    ),
                                    if (_sent) ...[
                                      const SizedBox(height: 16),
                                      TextFormField(
                                        controller: _code,
                                        enabled: !_busy,
                                        keyboardType: TextInputType.number,
                                        autofillHints: const [
                                          AutofillHints.oneTimeCode,
                                        ],
                                        maxLength: 6,
                                        decoration: InputDecoration(
                                          labelText: text(
                                            'รหัสยืนยัน 6 หลัก',
                                            'Six-digit code',
                                          ),
                                        ),
                                        validator: (value) =>
                                            RegExp(r'^[0-9]{6}$')
                                                .hasMatch(value?.trim() ?? '')
                                            ? null
                                            : text(
                                                'กรอกรหัส 6 หลัก',
                                                'Enter six digits',
                                              ),
                                      ),
                                    ],
                                    const SizedBox(height: 24),
                                    FilledButton(
                                      onPressed: _busy || _api == null
                                          ? null
                                          : _submit,
                                      child: Text(
                                        _sent
                                            ? text('ยืนยันรหัส', 'Verify code')
                                            : text(
                                                'ขอรหัสเข้าสู่ระบบ',
                                                'Send sign-in code',
                                              ),
                                      ),
                                    ),
                                    if (_sent)
                                      TextButton(
                                        onPressed: _busy
                                            ? null
                                            : () => setState(() {
                                                _sent = false;
                                                _code.clear();
                                              }),
                                        child: Text(
                                          text(
                                            'เปลี่ยนหมายเลข / ขอรหัสใหม่',
                                            'Change number / request another code',
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ] else ...[
                            if (!_busy)
                              FoodPage(
                                onAccount: _openProfile,
                                navigation: _foodNavigation,
                                rootOwnsHeader: true,
                                key: ObjectKey(_foodOwner),
                                api: _api!,
                                thai: _thai,
                                owner: _foodOwner,
                                onAuthenticationRequired:
                                    _authenticationRequired,
                              ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
}
