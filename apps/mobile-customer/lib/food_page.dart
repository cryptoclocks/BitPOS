import 'presentation/cart_coupon_page.dart';
import 'presentation/schedule_slot_picker.dart';

import 'dart:async';

import 'food_review_page.dart';
import 'presentation/merchant_search_empty.dart';
import 'package:mobile_shared/presentation/bitpos_info.dart';
import 'package:mobile_shared/presentation/bitpos_state_view.dart';
import 'presentation/merchant_search_controls.dart';
import 'presentation/merchant_branch_card.dart';
import 'presentation/food_product_card.dart';
import 'presentation/food_cart_line_card.dart';
import 'presentation/quote_confirmation.dart';
import 'presentation/quote_price_summary.dart';
import 'branch_reviews_page.dart';
import 'support_page.dart';
import 'favourites_sheet.dart';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'order_history_sheet.dart';
import 'food_labels.dart';

import 'package:mobile_shared/payment_handoff.dart';

import 'product_options_sheet.dart';
import 'configured_food_lines.dart';
import 'order_refunds_sheet.dart';
import 'food_cancellation_review_page.dart';

import 'package:mobile_shared/bitpos_design_tokens.dart';

import 'presentation/food_presentation.dart';
import 'food_delivery_panel.dart';
import 'delivery_address_picker_page.dart';
import 'payment_method_page.dart';

import 'package:mobile_shared/owned_route.dart';

/// Delegates root navigation to the mounted cart and its authenticated owner.
class FoodPageNavigation {
  Object? _owner;
  Future<void> Function()? _orders;
  Future<void> Function()? _favourites;
  Future<void> Function()? _account;
  VoidCallback? _continueOrderReview;
  VoidCallback? _returnToCart;
  VoidCallback? _returnToMenu;
  bool Function()? _canContinueOrderReview;
  bool Function()? _canReturnToCart;
  bool Function()? _canConfirmOrder;
  VoidCallback? _confirmOrder;
  VoidCallback? onCartReviewChanged;
  bool cartReviewActive = false;
  bool orderReviewActive = false;
  bool orderDetailActive = false;
  bool orderDetailCanTrack = false;
  bool orderDetailHasPrimary = false;
  bool orderDetailHideNavigation = false;
  String? orderDetailActionLabel;
  String? orderDetailSecondaryLabel;
  String? orderDetailTitle;
  String? orderDetailBackLabel;
  VoidCallback? _leaveOrderDetail;
  VoidCallback? _trackOrderDetail;
  VoidCallback? _orderDetailPrimary;
  VoidCallback? _orderDetailSecondary;
  String? orderReviewValidUntil;
  String? orderReviewTotal;
  bool orderReviewDelivery = false;
  String? menuTitle;
  VoidCallback? _leaveMenu;
  bool Function()? _canLeaveMenu;
  bool get canLeaveMenu => _canLeaveMenu?.call() ?? false;
  void leaveMenu() => _leaveMenu?.call();
  void setMenu(
    Object owner,
    String? title,
    VoidCallback onBack,
    bool Function() canBack,
  ) {
    if (!identical(owner, _owner)) return;
    final changed = menuTitle != title;
    menuTitle = title;
    _leaveMenu = onBack;
    _canLeaveMenu = canBack;
    if (changed) onCartReviewChanged?.call();
  }

  void _bind(
    Object owner,
    Future<void> Function() orders,
    Future<void> Function() favourites,
    Future<void> Function()? account,
    VoidCallback continueOrderReview,
    VoidCallback returnToCart,
    VoidCallback returnToMenu,
    bool Function() canContinueOrderReview,
    bool Function() canReturnToCart,
    bool Function() canConfirmOrder,
    VoidCallback confirmOrder,
  ) {
    _owner = owner;
    _orders = orders;
    _favourites = favourites;
    _account = account;
    _continueOrderReview = continueOrderReview;
    _returnToCart = returnToCart;
    _returnToMenu = returnToMenu;
    _canContinueOrderReview = canContinueOrderReview;
    _canReturnToCart = canReturnToCart;
    _canConfirmOrder = canConfirmOrder;
    _confirmOrder = confirmOrder;
  }

  void _unbind(Object owner) {
    if (identical(owner, _owner)) {
      _owner = null;
      _orders = null;
      _favourites = null;
      _account = null;
      _continueOrderReview = null;
      _returnToCart = null;
      _returnToMenu = null;
      _canContinueOrderReview = null;
      _canReturnToCart = null;
      _canConfirmOrder = null;
      _confirmOrder = null;
      cartReviewActive = false;
      orderReviewActive = false;
      orderDetailActive = false;
      orderDetailCanTrack = false;
      orderDetailHasPrimary = false;
      orderDetailHideNavigation = false;
      orderDetailActionLabel = null;
      orderDetailSecondaryLabel = null;
      orderDetailTitle = null;
      orderDetailBackLabel = null;
      _leaveOrderDetail = null;
      _trackOrderDetail = null;
      _orderDetailPrimary = null;
      _orderDetailSecondary = null;
      orderReviewValidUntil = null;
      orderReviewTotal = null;
      orderReviewDelivery = false;
      menuTitle = null;
      _leaveMenu = null;
      _canLeaveMenu = null;
    }
  }

  void setCartReview(Object owner, bool active) {
    if (!identical(owner, _owner) || cartReviewActive == active) return;
    cartReviewActive = active;
    onCartReviewChanged?.call();
  }

  void continueOrderReview() => _continueOrderReview?.call();
  void returnToCart() => _returnToCart?.call();
  void returnToMenu() => _returnToMenu?.call();
  void selectDestination(int index) {
    switch (index) {
      case 0:
        returnToMenu();
      case 1:
        unawaited(showOrders());
      case 2:
        unawaited(showFavourites());
      case 3:
        unawaited(_account?.call());
    }
  }

  bool get canContinueOrderReview => _canContinueOrderReview?.call() ?? false;
  bool get canReturnToCart => _canReturnToCart?.call() ?? false;
  bool get canConfirmOrder => _canConfirmOrder?.call() ?? false;
  void confirmOrder() => _confirmOrder?.call();
  void notifyCartReviewChanged() => onCartReviewChanged?.call();
  void setOrderDetail(
    Object owner, {
    required bool active,
    required String? actionLabel,
    required String? title,
    required String? backLabel,
    required VoidCallback onBack,
    required VoidCallback? onTrack,
    VoidCallback? onPrimary,
    String? secondaryLabel,
    VoidCallback? onSecondary,
    bool hideNavigation = false,
  }) {
    if (!identical(owner, _owner)) return;
    final changed =
        orderDetailActive != active ||
        orderDetailCanTrack != (onTrack != null) ||
        orderDetailHasPrimary != (onPrimary != null || onTrack != null) ||
        orderDetailHideNavigation != hideNavigation ||
        orderDetailActionLabel != actionLabel ||
        orderDetailSecondaryLabel != secondaryLabel ||
        orderDetailTitle != title ||
        orderDetailBackLabel != backLabel;
    orderDetailActive = active;
    orderDetailCanTrack = onTrack != null;
    orderDetailHasPrimary = onPrimary != null || onTrack != null;
    orderDetailHideNavigation = hideNavigation;
    orderDetailActionLabel = actionLabel;
    orderDetailSecondaryLabel = secondaryLabel;
    orderDetailTitle = title;
    orderDetailBackLabel = backLabel;
    _leaveOrderDetail = onBack;
    _trackOrderDetail = onTrack;
    _orderDetailPrimary = onPrimary ?? onTrack;
    _orderDetailSecondary = onSecondary;
    if (changed) onCartReviewChanged?.call();
  }

  void leaveOrderDetail() => _leaveOrderDetail?.call();
  void trackOrderDetail() => _trackOrderDetail?.call();
  void activateOrderDetailPrimary() => _orderDetailPrimary?.call();
  void activateOrderDetailSecondary() => _orderDetailSecondary?.call();
  void setOrderReview(
    Object owner,
    bool active, {
    String? validUntil,
    String? total,
    bool delivery = false,
  }) {
    if (!identical(owner, _owner)) return;
    final unchanged =
        orderReviewActive == active &&
        orderReviewValidUntil == (active ? validUntil : null) &&
        orderReviewTotal == (active ? total : null) &&
        orderReviewDelivery == (active && delivery);
    if (unchanged) return;
    orderReviewActive = active;
    orderReviewValidUntil = active ? validUntil : null;
    orderReviewTotal = active ? total : null;
    orderReviewDelivery = active && delivery;
    onCartReviewChanged?.call();
  }

  Future<void> showOrders() async {
    await _orders?.call();
  }

  Future<void> showFavourites() async {
    await _favourites?.call();
  }

  Future<void> selectAddressDestination(int index) async {
    if (index == 1) await _orders?.call();
    if (index == 2) await _favourites?.call();
    if (index == 3) await _account?.call();
  }
}

/// Customer discovery, configured cart, canonical quotes and owned order recovery.
class FoodPage extends StatefulWidget {
  final FoodPageNavigation? navigation;
  final bool rootOwnsHeader;
  final Future<void> Function()? onAccount;
  final MobileApi api;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final ValueListenable<bool>? owner;
  final PaymentHandoff? paymentHandoff;
  final Widget? sessionTools;
  final String? initialOrderId;
  /// Test seam for the quote lease clock; production always uses the device clock.
  @visibleForTesting
  final DateTime Function() clock;
  const FoodPage({
    super.key,
    required this.api,
    required this.thai,
    required this.onAuthenticationRequired,
    this.owner,
    this.paymentHandoff,
    this.sessionTools,
    this.initialOrderId,
    this.navigation,
    this.rootOwnsHeader = false,
    this.onAccount,
    this.clock = DateTime.now,
  });
  @override
  State<FoodPage> createState() => _FoodPageState();
}

class _FoodPageState extends State<FoodPage> with WidgetsBindingObserver {
  final List<MobileBranch> _branches = [];
  final Map<String, MobileConfiguredCartItem> _cart = {};
  String? _cartBranchId;
  MobileBranch? _cartBranch;
  String? _branchCursor;
  bool _discoveryLoaded = false;
  final _branchSearchController = TextEditingController();
  String _branchSearch = '', _branchServing = 'all';
  MobileMenu? _menu;
  List<MobileProduct> _products = [];
  MobileFoodQuote? _quote;
  // The quote that carries a server-applied coupon; a refreshed quote never inherits it.
  String? _couponQuoteId, _couponCode;
  // One-line explanation after the app replaced the quote on its own (new totals,
  // or a coupon the server would not re-apply). Cleared by the next manual action.
  String? _quoteNotice;
  // Quote lease: refresh shortly before the server lease ends so the customer never
  // reads an expired price. Only the server decides the new totals.
  static const _leaseMargin = Duration(seconds: 12);
  Timer? _leaseTimer;
  DateTime? _lastLeaseAttempt;
  ScheduleAvailability _scheduleAvailability = ScheduleAvailability.loading;
  List<MobileScheduleSlot> _slots = const [];
  MobileScheduleSlot? _selectedSlot;
  // Held slot command per quote+slot so a retried confirm replays the same server hold.
  ({String quoteId, String slotId, String key})? _slotCommand;
  MobileScheduleSlot? _scheduledSlot;
  bool _cartReview = false;
  bool _delivery = false;
  MobileCustomerDeliveryPolicy? _deliveryPolicy;
  MobileAddress? _deliveryAddress;
  final List<MobileAddress> _deliveryAddresses = [];
  String? _addressCursor;
  MobileFoodOrderRequest? _pending;
  MobileFoodOrder? _order;
  MobileFoodEvents? _timeline;
  String? _recoverOrderId;
  static const _paymentOrigin = String.fromEnvironment('BITPOS_PAYMENT_ORIGIN');
  late final _payment =
      widget.paymentHandoff ??
      PaymentHandoff(
        fixture: const bool.fromEnvironment('BITPOS_FIXTURE'),
        destinationOrigin: _paymentOrigin,
      );
  bool _busy = true;
  String? _detailsOrderId;
  bool _accountRequested = false;
  bool _refreshOnResume = false;
  Object? _error;
  String _search = '';
  final _searchController = TextEditingController();
  MaterialPageRoute<String>? _historyRoute;
  MaterialPageRoute<MobileBranch>? _favouritesRoute;
  ModalBottomSheetRoute<MobileConfiguredCartItem>? _productRoute;
  Route<void>? _refundRoute;
  MaterialPageRoute<void>? _deliveryRoute;
  MaterialPageRoute<void>? _supportRoute;
  MaterialPageRoute<void>? _reviewRoute;
  MaterialPageRoute<void>? _cancellationReviewRoute;
  MaterialPageRoute<MobileAddress>? _addressPickerRoute;
  MaterialPageRoute<void>? _paymentMethodRoute;
  bool get _current => mounted && (widget.owner?.value ?? true);
  void _ownerChanged() {
    if (widget.owner?.value == false) {
      removeOwnedRoute(_addressPickerRoute);
      removeOwnedRoute(_paymentMethodRoute);
      _closeFavourites();
      _closeHistory();
      _closeProduct();
      _closeRefunds();
      _closeDelivery();
      _closeSupport();
      _closeReview();
      _closeCancellationReview();
    }
  }

  void _closeFavourites() {
    final route = _favouritesRoute;
    _favouritesRoute = null;
    removeOwnedRoute(route);
  }

  void _closeHistory() {
    final route = _historyRoute;
    _historyRoute = null;
    removeOwnedRoute(route);
  }

  void _closeProduct() {
    final route = _productRoute;
    _productRoute = null;
    removeOwnedRoute(route);
  }

  void _closeRefunds() {
    final route = _refundRoute;
    _refundRoute = null;
    removeOwnedRoute(route);
  }

  void _closeReview() {
    final route = _reviewRoute;
    _reviewRoute = null;
    removeOwnedRoute(route);
  }

  void _closeSupport() {
    final route = _supportRoute;
    _supportRoute = null;
    removeOwnedRoute(route);
  }

  void _closeCancellationReview() {
    final route = _cancellationReviewRoute;
    _cancellationReviewRoute = null;
    removeOwnedRoute(route);
  }

  void _closeDelivery() {
    final route = _deliveryRoute;
    _deliveryRoute = null;
    removeOwnedRoute(route);
  }

  String t(String th, String en) => widget.thai ? th : en;
  String money(MobileMoney value) =>
      formatMinorUnits(value.amountMinor, value.decimals, value.currency);

  void _syncOrderDetailNavigation() {
    if (!widget.rootOwnsHeader) return;
    final order = _order;
    final phase = order == null ? null : _visibleOrderPhase(order);
    final pending = phase == _FoodOrderPhase.paymentPending;
    final summary = phase != null && phase != _FoodOrderPhase.detail;
    final canTrack =
        order != null &&
        order.delivery != null &&
        !pending &&
        !['REJECTED', 'TIMED_OUT'].contains(order.acceptanceStatus);
    final canReturnToStatus =
        order != null &&
        _detailsOrderId == order.id &&
        _phaseFor(order) != _FoodOrderPhase.detail;
    widget.navigation?.setOrderDetail(
      this,
      active: order != null,
      title: phase?.title(widget.thai),
      backLabel: canReturnToStatus
          ? t('กลับไปสถานะออเดอร์', 'Back to order status')
          : t('กลับไปออเดอร์', 'Back to orders'),
      actionLabel: pending
          ? t('ดูสถานะออเดอร์', 'Check order status')
          : canTrack
          ? summary
                ? t('ติดตามไรเดอร์', 'Track rider')
                : t('ติดตามการจัดส่ง', 'Track delivery')
          : summary
          ? t('อัปเดตสถานะ', 'Refresh status')
          : null,
      secondaryLabel: pending
          ? t('ติดต่อช่วยเหลือ', 'Contact support')
          : summary
          ? t('ดูรายละเอียดออเดอร์', 'View order details')
          : null,
      onSecondary: pending
          ? () => unawaited(_run(_support))
          : summary
          ? () => _setOrderDetails(true)
          : null,
      onPrimary: summary && !canTrack
          ? () => unawaited(_run(_refreshOrder))
          : null,
      hideNavigation: pending,
      onBack: order == null
          ? () {}
          : () {
              if (!_current || _busy) return;
              if (canReturnToStatus) {
                _setOrderDetails(false);
                return;
              }
              setState(() {
                _order = null;
                _timeline = null;
                _quote = null;
              });
              unawaited(_run(_history));
            },
      onTrack: canTrack ? () => unawaited(_run(_trackDelivery)) : null,
    );
  }

  void _setOrderDetails(bool active) {
    if (!_current || _busy || _order == null) return;
    setState(() => _detailsOrderId = active ? _order!.id : null);
    _syncOrderDetailNavigation();
  }

  void _syncOrderReview() {
    final q = _quote;
    if (q == null) return;
    widget.navigation?.setOrderReview(
      this,
      true,
      validUntil: q.validUntil,
      total: money(q.total),
      delivery: q.delivery != null,
    );
  }

  void _setCartReview(bool active) {
    _cartReview = active;
    widget.navigation?.setOrderReview(this, false);
    widget.navigation?.setCartReview(this, active);
    _syncMenuNavigation();
  }

  void _syncMenuNavigation() {
    final branch = _menu?.branch;
    widget.navigation?.setMenu(
      this,
      branch != null && _quote == null && _order == null
          ? merchantBranchLabel(
              thai: widget.thai,
              name: branch.name,
              nameEn: branch.nameEn,
              merchantName: branch.merchantName,
            )
          : null,
      () {
        if (!_current || _busy || _pending != null) return;
        setState(() => _menu = null);
        _syncMenuNavigation();
      },
      () => _current && !_busy && _pending == null,
    );
  }

  @override
  void initState() {
    super.initState();
    widget.navigation?._bind(
      this,
      () => _run(_history),
      () => _run(_favourites),
      () async {
        await widget.onAccount?.call();
      },
      () {
        if (!_current || _busy || _quote == null) return;
        setState(() {
          _setCartReview(false);
          _syncOrderReview();
        });
      },
      () {
        if (!_current || _busy || _quote == null) return;
        setState(() {
          widget.navigation?.setOrderReview(this, false);
          _setCartReview(true);
        });
      },
      () {
        if (!_current || _busy || _quote == null) return;
        setState(() {
          _quote = null;
          _setCartReview(false);
        });
      },
      () => _current && !_busy && _quote != null && _pending == null,
      () => _current && !_busy && _quote != null && _pending == null,
      () => _current && !_busy && _quote != null && _pending == null,
      () => unawaited(_run(_submit)),
    );
    WidgetsBinding.instance.addObserver(this);
    widget.owner?.addListener(_ownerChanged);
    _initialize();
  }

  @override
  void dispose() {
    widget.navigation?._unbind(this);
    widget.owner?.removeListener(_ownerChanged);
    removeOwnedRoute(_addressPickerRoute);
    removeOwnedRoute(_paymentMethodRoute);
    _closeFavourites();
    _closeHistory();
    _closeProduct();
    _closeRefunds();
    _closeDelivery();
    _closeSupport();
    _closeReview();
    _leaseTimer?.cancel();
    _searchController.dispose();
    _branchSearchController.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _leaseTick();
    if (state == AppLifecycleState.resumed && _order != null) {
      if (_busy) {
        _refreshOnResume = true;
      } else {
        _run(_refreshOrder);
      }
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (!_current || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    widget.navigation?.notifyCartReviewChanged();
    try {
      await action();
    } catch (error) {
      _error = error;
      if (error is MobileApiException &&
          _pending == null &&
          [
            'QUOTE_CHANGED',
            'QUOTE_EXPIRED',
            'PRICE_VERSION_CHANGED',
            'STOCK_UNAVAILABLE',
          ].contains(error.code)) {
        _quote = null;
        _setCartReview(false);
      }
      if (_current &&
          error is MobileApiException &&
          error.code == 'AUTH_REQUIRED' &&
          !widget.api.signedIn) {
        widget.onAuthenticationRequired();
      }
    }
    if (_current) {
      setState(() => _busy = false);
      _syncOrderDetailNavigation();
      _syncMenuNavigation();
      widget.navigation?.notifyCartReviewChanged();
    }
    if (_current && _accountRequested) {
      _accountRequested = false;
      await widget.onAccount?.call();
    }
    if (_current && _refreshOnResume) {
      _refreshOnResume = false;
      await _run(_refreshOrder);
    }
  }

  Future<void> _initialize() async {
    try {
      _pending = await widget.api.pendingFoodOrder();
      if (!_current) return;
      _recoverOrderId =
          widget.initialOrderId ?? await widget.api.activeFoodOrderId();
      if (!_current) return;
    } catch (error) {
      _error = error;
      if (_current &&
          error is MobileApiException &&
          error.code == 'AUTH_REQUIRED' &&
          !widget.api.signedIn) {
        widget.onAuthenticationRequired();
      }
      if (mounted) setState(() => _busy = false);
      return;
    }
    try {
      await _reloadBranches();
    } catch (error) {
      _error = const MobileApiException('DISCOVERY_FAILED', 503);
    }
    if (_recoverOrderId != null) {
      try {
        await _restoreActiveOrder();
      } catch (error) {
        _error = error;
        if (_current &&
            error is MobileApiException &&
            error.code == 'AUTH_REQUIRED' &&
            !widget.api.signedIn) {
          widget.onAuthenticationRequired();
        }
      }
    }
    if (mounted) setState(() => _busy = false);
    _syncOrderDetailNavigation();
  }

  Future<void> _restoreActiveOrder() async {
    final id = _recoverOrderId;
    if (id == null) return;
    final page = await widget.api.foodEvents(id);
    _order = page.order;
    _timeline = page;
    _syncOrderDetailNavigation();
  }

  Future<void> _openPayment() async {
    final order = _order;
    if (order == null) return;
    await widget.api.rememberFoodOrder(order.id);
    if (!_current) return;
    await _payment.open(order.paymentUrl);
    if (_current) await _refreshOrder();
  }

  Future<void> _choosePaymentMethod() async {
    final order = _order;
    if (!_current || _busy || order == null || _pending != null) return;
    bool available;
    try {
      _payment.destination(order.paymentUrl);
      available = true;
    } on MobileApiException {
      available = false;
    }
    final route = MaterialPageRoute<void>(
      builder: (_) => PaymentMethodPage(
        thai: widget.thai,
        total: money(order.total),
        checkoutAvailable: available,
        onOpenOriginalCheckout: () async {
          if (!_current || _order?.id != order.id || _busy) {
            throw const MobileApiException('SESSION_CHANGED', 409);
          }
          await _openPayment();
          if (_current) {
            setState(() {});
            _syncOrderDetailNavigation();
          }
        },
        onNavigate: widget.navigation == null
            ? null
            : (index) async {
                if (index != 0 && _current) {
                  widget.navigation!.selectDestination(index);
                }
              },
      ),
    );
    _paymentMethodRoute = route;
    await Navigator.of(context).push(route);
    if (identical(_paymentMethodRoute, route)) _paymentMethodRoute = null;
  }

  Future<void> _reloadBranches() async {
    _branches.clear();
    _branchCursor = null;
    _discoveryLoaded = false;
    final page = await widget.api.branches(
      search: _branchSearch,
      serving: _branchServing,
    );
    if (!_current) return;
    _branches.addAll(page.branches);
    _branchCursor = page.nextCursor;
    _discoveryLoaded = true;
  }

  Future<void> _loadMore() async {
    final page = await widget.api.branches(
      cursor: _branchCursor,
      search: _branchSearch,
      serving: _branchServing,
    );
    if (!_current) return;
    final ids = _branches.map((b) => b.id).toSet();
    _branches.addAll(page.branches.where((b) => ids.add(b.id)));
    _branchCursor = page.nextCursor;
  }

  Future<void> _chooseDelivery() async {
    final branch = _menu!.branch;
    final previousAddressId = _deliveryAddress?.id;
    final policy = await widget.api.deliveryPolicy(branch.id);
    if (!_current) return;
    final addresses = await widget.api.addresses();
    if (!_current) return;
    _delivery = true;
    _deliveryPolicy = policy;
    _deliveryAddress = null;
    for (final address in addresses.addresses) {
      if (address.id == previousAddressId) {
        _deliveryAddress = address;
        break;
      }
    }
    _addressCursor = addresses.nextCursor;
    _deliveryAddresses
      ..clear()
      ..addAll(addresses.addresses);
    _quote = null;
    _setCartReview(false);
    await _pickDeliveryAddress();
  }

  Future<void> _pickDeliveryAddress() async {
    if (!_current) return;
    final route = MaterialPageRoute<MobileAddress>(
      builder: (_) => DeliveryAddressPickerPage(
        addresses: List.unmodifiable(_deliveryAddresses),
        selected: _deliveryAddress,
        thai: widget.thai,
        isEligible: _inDeliveryArea,
        onAddAddress: () async {
          await widget.onAccount?.call();
          if (!_current) return const <MobileAddress>[];
          final page = await widget.api.addresses();
          if (!_current) return const <MobileAddress>[];
          final previous = _deliveryAddress;
          MobileAddress? refreshedSelection;
          if (previous != null) {
            for (final address in page.addresses) {
              if (address.id == previous.id) {
                refreshedSelection = address;
                break;
              }
            }
            _deliveryAddress =
                refreshedSelection != null &&
                    _inDeliveryArea(refreshedSelection)
                ? refreshedSelection
                : null;
            if (_deliveryAddress == null ||
                _deliveryAddress!.version != previous.version) {
              _quote = null;
              _setCartReview(false);
              setState(() {});
            }
          }
          _deliveryAddresses
            ..clear()
            ..addAll(page.addresses);
          _addressCursor = page.nextCursor;
          return List.unmodifiable(_deliveryAddresses);
        },
        hasMore: () => _addressCursor != null,
        onLoadMore: () async {
          await _moreDeliveryAddresses();
          return List.unmodifiable(_deliveryAddresses);
        },
        onNavigate: (index) =>
            widget.navigation?.selectAddressDestination(index) ??
            Future<void>.value(),
      ),
    );
    _addressPickerRoute = route;
    final selected = await Navigator.of(context).push(route);
    if (identical(_addressPickerRoute, route)) _addressPickerRoute = null;
    if (!_current || selected == null) return;
    if (!_deliveryAddresses.any((address) => address.id == selected.id)) {
      throw const MobileApiException('RESOURCE_NOT_FOUND', 404);
    }
    _deliveryAddress = selected;
    _quote = null;
    _setCartReview(false);
  }

  Future<void> _moreDeliveryAddresses() async {
    final cursor = _addressCursor;
    if (cursor == null) return;
    final page = await widget.api.addresses(cursor: cursor);
    if (!_current) return;
    if (page.nextCursor == cursor)
      throw const FormatException('Repeated address cursor');
    _deliveryAddresses.addAll(
      page.addresses.where(
        (address) => !_deliveryAddresses.any((old) => old.id == address.id),
      ),
    );
    _addressCursor = page.nextCursor;
  }

  bool _inDeliveryArea(MobileAddress address) {
    final p = _deliveryPolicy,
        lat = address.address.latitudeE7,
        lng = address.address.longitudeE7;
    return !address.archived &&
        p != null &&
        lat != null &&
        lng != null &&
        lat >= p.southE7 &&
        lat <= p.northE7 &&
        lng >= p.westE7 &&
        lng <= p.eastE7;
  }

  Future<void> _open(MobileBranch branch, {bool preserveCart = false}) async {
    final keepDraft =
        preserveCart || (_cart.isNotEmpty && _cartBranchId == branch.id);
    if (!keepDraft && _cart.isNotEmpty) {
      final replace = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(t('เปลี่ยนร้านอาหาร?', 'Change merchant?')),
          content: Text(
            t(
              'ตะกร้าปัจจุบันเป็นของอีกร้าน หากเปลี่ยนร้านจะเริ่มตะกร้าใหม่',
              'Your current cart belongs to another merchant. Changing merchants starts a new cart.',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(t('เก็บตะกร้าเดิม', 'Keep current cart')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(t('เปลี่ยนร้าน', 'Change merchant')),
            ),
          ],
        ),
      );
      if (replace != true || !_current) return;
    }
    final first = await widget.api.menu(branch.id);
    if (!_current) return;
    final products = [...first.products], seen = <String>{};
    var cursor = first.nextCursor;
    while (cursor != null) {
      if (!seen.add(cursor))
        throw const FormatException('Repeated menu cursor');
      final page = await widget.api.menu(
        branch.id,
        cursor: cursor,
        menuVersion: first.menuVersion,
      );
      if (!_current) return;
      if (page.menuVersion != first.menuVersion)
        throw const MobileApiException('QUOTE_CHANGED', 409);
      products.addAll(page.products);
      cursor = page.nextCursor;
    }
    if (_cartBranchId != branch.id) {
      _couponCode = null;
      _couponQuoteId = null;
      _quoteNotice = null;
    }
    _menu = first;
    _products = products;
    _cartBranchId = branch.id;
    _cartBranch = branch;
    if (!keepDraft) _cart.clear();
    if (!preserveCart) {
      _search = '';
      _searchController.clear();
    }
    _quote = null;
    _setCartReview(false);
    _order = null;
    _timeline = null;
    if (!keepDraft) {
      _delivery = false;
      _deliveryPolicy = null;
      _deliveryAddress = null;
      _deliveryAddresses.clear();
      _addressCursor = null;
    }
  }

  Future<void> _review() async {
    final menu = _menu!;
    _quoteNotice = null;
    await _requestQuote();
    await _reapplyCoupon();
    _setCartReview(true);
    unawaited(_loadSlots(menu.branch.id, _delivery ? 'delivery' : 'pickup'));
  }

  /// Automatic or on-resume replacement of the quote. Keeps the stage the customer
  /// is on, re-applies the chosen coupon on the new server quote and shows the
  /// new server totals. The picked slot is held against whichever quote is ordered.
  Future<void> _refreshQuote() async {
    if (_menu == null || _quote == null) return;
    final orderStage = !_cartReview;
    final before = _quote!.total.amountMinor;
    _quoteNotice = null;
    await _requestQuote();
    await _reapplyCoupon();
    if (_quoteNotice == null && _quote!.total.amountMinor != before) {
      _quoteNotice = t(
        'ราคาถูกอัปเดตจากเซิร์ฟเวอร์ ยอดใหม่ ${money(_quote!.total)}',
        'Price refreshed by the server. New total ${money(_quote!.total)}',
      );
    }
    if (orderStage) {
      _syncOrderReview();
    } else {
      _setCartReview(true);
    }
  }

  /// Re-attaches the coupon the customer had applied to the replacement quote.
  /// A server refusal drops it with a one-line reason; a network failure keeps
  /// the code so the next refresh tries again.
  Future<void> _reapplyCoupon() async {
    final code = _couponCode, q = _quote;
    if (code == null || q == null) return;
    try {
      final result = await widget.api.applyFoodCoupon(
        q.id,
        MobileCouponApplyRequest(
          code: code,
          idempotencyKey: widget.api.newCommandKey(),
        ),
      );
      _quote = result.quote;
      _couponQuoteId = result.quote.id;
      _couponCode = result.couponCode;
    } catch (error) {
      if (error is MobileApiException && error.code == 'AUTH_REQUIRED') {
        rethrow;
      }
      _couponQuoteId = null;
      if (error is MobileApiException && error.status < 500) {
        _couponCode = null;
        _quoteNotice = t(
          'ใส่คูปอง $code กลับไม่ได้: ${checkoutRefusalMessage(error, true)}',
          'Coupon $code could not be re-applied: ${checkoutRefusalMessage(error, false)}',
        );
      } else {
        _quoteNotice = t(
          'ยังใส่คูปอง $code กลับไม่สำเร็จ แตะที่คูปองเพื่อลองอีกครั้ง',
          'Coupon $code was not re-applied yet. Tap the coupon to try again.',
        );
      }
    }
  }

  void _leaseTick() {
    final q = _quote;
    if (!_current || q == null || _order != null) {
      _leaseTimer?.cancel();
      _leaseTimer = null;
      return;
    }
    if (_busy || _pending != null) return;
    final until = DateTime.tryParse(q.validUntil);
    if (until == null || until.difference(widget.clock()) > _leaseMargin) {
      return;
    }
    final last = _lastLeaseAttempt;
    if (last != null &&
        DateTime.now().difference(last) < const Duration(seconds: 5)) {
      return;
    }
    _lastLeaseAttempt = DateTime.now();
    unawaited(_run(_refreshQuote));
  }

  void _startLeaseTimer() {
    _leaseTimer ??= Timer.periodic(
      const Duration(seconds: 1),
      (_) => _leaseTick(),
    );
  }

  Future<void> _requestQuote() async {
    final menu = _menu!;
    if (_cart.values.any(
      (item) => !_products.any(
        (p) =>
            p.id == item.productId && p.options.version == item.optionVersion,
      ),
    ))
      throw const MobileApiException('QUOTE_CHANGED', 409);
    if (_delivery) {
      final address = _deliveryAddress, policy = _deliveryPolicy;
      if (address == null || policy == null || !_inDeliveryArea(address))
        throw const MobileApiException('SERVING_UNAVAILABLE', 409);
      _quote = await widget.api.quoteDelivery(
        MobileDeliveryQuoteRequest(
          branchId: menu.branch.id,
          serving: 'delivery',
          items: _cart.values.toList(),
          delivery: MobileDeliverySelection(
            addressId: address.id,
            addressVersion: address.version,
            policyVersionId: policy.policyVersionId,
          ),
        ),
      );
    } else {
      _quote = await widget.api.quoteFood(
        MobileFoodQuoteRequest(
          branchId: menu.branch.id,
          serving: 'pickup',
          items: _cart.values.toList(),
        ),
      );
    }
    _startLeaseTimer();
  }

  /// Slots are optional: any failure leaves the order immediate and says so.
  Future<void> _loadSlots(String branchId, String serving) async {
    if (mounted) setState(() => _scheduleAvailability = ScheduleAvailability.loading);
    ScheduleAvailability result;
    var slots = <MobileScheduleSlot>[];
    try {
      final published = await widget.api.scheduleSlots(branchId, serving);
      if (published.branchId != branchId || published.serving != serving) {
        throw const FormatException('Schedule slots identity mismatch');
      }
      slots = published.slots;
      result = slots.isEmpty ? ScheduleAvailability.none : ScheduleAvailability.published;
    } catch (_) {
      result = ScheduleAvailability.failed;
    }
    if (!mounted) return;
    setState(() {
      _slots = slots;
      _scheduleAvailability = result;
      final chosen = _selectedSlot;
      if (chosen != null && !slots.any((s) => s.id == chosen.id)) _selectedSlot = null;
    });
  }

  Future<void> _openCoupon(MobileFoodQuote q) async {
    final applied = _couponQuoteId == q.id ? _couponCode : null;
    // Reward vouchers are optional help only; a failed lookup just means the customer types the code.
    var vouchers = const <MobileVoucher>[];
    try {
      vouchers = (await widget.api.vouchers()).vouchers
          .where((v) => v.state == 'AVAILABLE' && v.merchantId == q.merchantId)
          .toList();
    } catch (_) {}
    if (!mounted || !_current) return;
    final result = await Navigator.of(context).push<Object>(
      MaterialPageRoute<Object>(
        builder: (_) => CartCouponPage(
          thai: widget.thai,
          appliedCode: applied,
          vouchers: vouchers,
          newKey: widget.api.newCommandKey,
          onApply: (code, key) => widget.api.applyFoodCoupon(
            q.id,
            MobileCouponApplyRequest(code: code, idempotencyKey: key),
          ),
        ),
      ),
    );
    if (!mounted || !_current) return;
    if (result is MobileCouponQuote) {
      setState(() {
        _quote = result.quote;
        _couponQuoteId = result.quote.id;
        _couponCode = result.couponCode;
        _error = null;
        _quoteNotice = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            t(
              'ใช้คูปอง ${result.couponCode} แล้ว ยอดใหม่ ${money(result.quote.total)}',
              'Coupon ${result.couponCode} applied. New total ${money(result.quote.total)}',
            ),
          ),
        ),
      );
    } else if (result is CouponRemoveRequest) {
      _couponCode = null;
      _couponQuoteId = null;
      await _run(_review);
    }
  }

  Future<void> _submit() async {
    final q = _quote;
    if (_pending == null) {
      if (q == null) throw const MobileApiException('QUOTE_EXPIRED', 409);
      if (!DateTime.parse(q.validUntil).isAfter(widget.clock())) {
        // Never order on a stale price: fetch the new server quote and ask again.
        await _refreshQuote();
        _quoteNotice = t(
          'ราคาหมดอายุ จึงอัปเดตเป็น ${money(_quote!.total)} ตรวจยอดแล้วกดยืนยันอีกครั้ง',
          'The price expired and was refreshed to ${money(_quote!.total)}. Check it and confirm again.',
        );
        return;
      }
      final slot = _selectedSlot;
      if (slot != null) {
        var command = _slotCommand;
        if (command == null || command.quoteId != q.id || command.slotId != slot.id) {
          command = (quoteId: q.id, slotId: slot.id, key: widget.api.newCommandKey());
          _slotCommand = command;
        }
        try {
          // Server-side capacity and window; an exhausted/closed slot refuses before any order exists.
          await widget.api.holdScheduleSlot(
            q.id,
            MobileScheduleHoldRequest(slotId: slot.id, idempotencyKey: command.key),
          );
        } on MobileApiException catch (error) {
          if (error.reason != null && error.reason!.startsWith('SCHEDULE_')) {
            _selectedSlot = null;
            _slotCommand = null;
            unawaited(_loadSlots(q.branchId, q.delivery != null ? 'delivery' : 'pickup'));
          }
          rethrow;
        }
      }
      // The transport saves this UUID before sending, including process-death recovery.
      _pending = widget.api.newFoodOrderCommand(
        branchId: q.branchId,
        quoteId: q.id,
        priceVersion: q.priceVersion,
      );
    }
    try {
      final result = await widget.api.submitFoodOrder(_pending!);
      if (!mounted) return;
      _pending = null;
      _scheduledSlot = _selectedSlot;
      _selectedSlot = null;
      _slotCommand = null;
      _couponCode = null;
      _couponQuoteId = null;
      _quoteNotice = null;
      _order = result.order;
      _timeline = null;
      _quote = null;
      _setCartReview(false);
      _cart.clear();
      _timeline = await widget.api.foodEvents(result.order.id);
      _order = _timeline!.order;
      _syncOrderDetailNavigation();
    } on MobileApiException {
      if (widget.api.signedIn) _pending = await widget.api.pendingFoodOrder();
      rethrow;
    }
  }

  Future<void> _refreshOrder() async {
    if (_order == null) return;
    _timeline = await widget.api.foodEvents(_order!.id);
    _order = _timeline!.order;
    _syncOrderDetailNavigation();
  }

  Future<void> _nextEvents() async {
    final cursor = _timeline?.nextCursor;
    if (_order == null || cursor == null) return;
    final page = await widget.api.foodEvents(_order!.id, cursor: cursor);
    _timeline = page;
    _order = page.order;
  }

  Future<void> _favourites() async {
    final page = await widget.api.favourites();
    if (!mounted || !_current) return;
    int? destination;
    final route = MaterialPageRoute<MobileBranch>(
      builder: (_) => FavouritesSheet(
        onNavigate: (index) {
          if (index == 2) return;
          destination = index;
          Navigator.of(context).pop();
        },
        api: widget.api,
        firstPage: page,
        thai: widget.thai,
        onAuthenticationRequired: () {
          if (_current) widget.onAuthenticationRequired();
        },
      ),
    );
    _favouritesRoute = route;
    final branch = await Navigator.of(context).push(route);
    if (identical(_favouritesRoute, route)) _favouritesRoute = null;
    if (!mounted || !_current) return;
    if (destination == 1) {
      await _history();
      return;
    }
    if (destination == 3) {
      _accountRequested = true;
      return;
    }
    if (branch == null) return;
    if (_pending != null || _cart.isNotEmpty && _menu?.branch.id != branch.id) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            t(
              'จัดการตะกร้าหรือคำสั่งเดิมก่อนเปลี่ยนร้าน',
              'Resolve the current cart or saved command before changing merchants.',
            ),
          ),
        ),
      );
      return;
    }
    await _open(branch, preserveCart: _menu?.branch.id == branch.id);
  }

  Future<void> _history() async {
    final page = await widget.api.foodOrders();
    if (!mounted || !_current) return;
    int? destination;
    final route = MaterialPageRoute<String>(
      builder: (routeContext) => OrderHistorySheet(
        onNavigate: (index) {
          if (index == 1) return;
          destination = index;
          Navigator.of(routeContext).pop();
        },
        api: widget.api,
        firstPage: page,
        thai: widget.thai,
        onAuthenticationRequired: () {
          if (_current) widget.onAuthenticationRequired();
        },
      ),
    );
    _historyRoute = route;
    final selected = await Navigator.of(context).push(route);
    if (identical(_historyRoute, route)) _historyRoute = null;
    if (!_current) return;
    if (destination == 2) {
      await _favourites();
      return;
    }
    if (destination == 3) {
      _accountRequested = true;
      return;
    }
    if (selected != null) {
      final detail = await widget.api.foodOrder(selected);
      if (!_current) return;
      _scheduledSlot = null;
      _order = detail;
      _timeline = null;
      _quote = null;
      _setCartReview(false);
      await widget.api.rememberFoodOrder(detail.id);
      if (_current) await _refreshOrder();
    }
  }

  Future<void> _refunds() async {
    final order = _order;
    if (order == null) return;
    final route = MaterialPageRoute<void>(
      builder: (context) => OrderRefundsSheet(
        api: widget.api,
        orderId: order.id,
        onNavigation: widget.navigation?.selectDestination,
        firstPage: MobileFoodRefunds(
          refunds: order.refunds,
          nextCursor: order.nextRefundCursor,
          generation: order.eventSequence,
        ),
        thai: widget.thai,
        onAuthenticationRequired: () {
          if (_current) widget.onAuthenticationRequired();
        },
        onViewOrder: () => Navigator.maybePop(context),
        onContactSupport: () {
          unawaited(() async {
            await Navigator.maybePop(context);
            if (_current) await _support();
          }());
        },
      ),
    );
    _refundRoute = route;
    await Navigator.of(context).push(route);
    if (identical(_refundRoute, route)) _refundRoute = null;
  }

  Future<void> _reviewMeal() async {
    final order = _order;
    if (!_current || order == null || _reviewRoute != null) return;
    final route = MaterialPageRoute<void>(
      builder: (_) => FoodReviewPage(
        api: widget.api,
        orderId: order.id,
        owner: widget.owner,
        thai: widget.thai,
        onAuthenticationRequired: () {
          if (_current) widget.onAuthenticationRequired();
        },
      ),
    );
    _reviewRoute = route;
    await Navigator.of(context).push(route);
    if (identical(_reviewRoute, route)) _reviewRoute = null;
  }

  Future<void> _requestCancellationReview() async {
    final order = _order;
    if (!_current ||
        order?.delivery == null ||
        _cancellationReviewRoute != null) {
      return;
    }
    final work = await widget.api.foodCustomerWork(order!.id);
    if (!mounted) return;
    if (!_current) return;
    if (['DELIVERED', 'CANCELLED', 'FAILED'].contains(work.state)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            t(
              'ออเดอร์อยู่ในสถานะที่ขอทบทวนการยกเลิกไม่ได้',
              'This order state is not eligible for a cancellation review request.',
            ),
          ),
        ),
      );
      return;
    }
    final route = MaterialPageRoute<void>(
      builder: (_) => FoodCancellationReviewPage(
        api: widget.api,
        orderId: order.id,
        shipmentId: work.shipmentId,
        thai: widget.thai,
        owner: widget.owner,
        onAuthenticationRequired: () {
          if (_current) widget.onAuthenticationRequired();
        },
        onNavigationSelected: widget.navigation?.selectDestination,
      ),
    );
    _cancellationReviewRoute = route;
    await Navigator.of(context).push(route);
    if (identical(_cancellationReviewRoute, route)) {
      _cancellationReviewRoute = null;
    }
  }

  Future<void> _publicReviews() async {
    final branch = _menu?.branch;
    if (!_current || branch == null || _reviewRoute != null) return;
    final route = MaterialPageRoute<void>(
      builder: (_) => BranchReviewsPage(
        api: widget.api,
        branchId: branch.id,
        thai: widget.thai,
      ),
    );
    _reviewRoute = route;
    await Navigator.of(context).push(route);
    if (identical(_reviewRoute, route)) _reviewRoute = null;
  }

  Future<void> _support() async {
    final order = _order;
    if (!_current || order == null || _supportRoute != null) return;
    final route = MaterialPageRoute<void>(
      builder: (_) => SupportPage(
        api: widget.api,
        owner: widget.owner,
        thai: widget.thai,
        initialSubject: t('ช่วยเหลือเกี่ยวกับออเดอร์', 'Order enquiry'),
        order: MobileSupportOrder(
          merchantId: order.merchantId,
          orderId: order.id,
        ),
        onAuthenticationRequired: () {
          if (_current) widget.onAuthenticationRequired();
        },
      ),
    );
    _supportRoute = route;
    await Navigator.of(context).push(route);
    if (identical(_supportRoute, route)) _supportRoute = null;
  }

  Future<void> _trackDelivery() async {
    final order = _order;
    if (!_current || order?.delivery == null || _deliveryRoute != null) return;
    final route = MaterialPageRoute<void>(
      builder: (context) => FoodDeliveryPage(
        api: widget.api,
        orderId: order!.id,
        orderTotal: order.total,
        thai: widget.thai,
        owner: widget.owner,
        onViewReceipt: () {
          Navigator.of(context).popUntil((route) => route.isFirst);
          unawaited(_run(_refreshOrder));
        },
        onAuthenticationRequired: () {
          if (_current) widget.onAuthenticationRequired();
        },
        onNavigationSelected: _chatNavigationSelected,
      ),
    );
    _deliveryRoute = route;
    await Navigator.of(context).push(route);
    if (identical(_deliveryRoute, route)) _deliveryRoute = null;
  }

  void _chatNavigationSelected(int index) {
    if (!_current) return;
    Navigator.of(context).popUntil((route) => route.isFirst);
    if (index == 1) {
      unawaited(_history());
    } else if (index == 2) {
      unawaited(_favourites());
    } else if (index == 3) {
      unawaited(widget.onAccount?.call());
    }
  }

  int _productQuantity(String product) => _cart.values
      .where((i) => i.productId == product)
      .fold(0, (n, i) => n + i.qty);
  Future<void> _editProduct(
    MobileProduct product, {
    MobileConfiguredCartItem? initial,
  }) async {
    final other = _productQuantity(product.id) - (initial?.qty ?? 0),
        available = (product.available < 100 ? product.available : 100) - other;
    final route = ModalBottomSheetRoute<MobileConfiguredCartItem>(
      isScrollControlled: true,
      useSafeArea: true,
      constraints: const BoxConstraints(maxWidth: 520),
      shape: const RoundedRectangleBorder(),
      builder: (_) => ProductOptionsSheet(
        product: product,
        options: product.options,
        lineId: initial?.lineId ?? widget.api.newFoodLineId(),
        thai: widget.thai,
        maximumQuantity: available,
        initial: initial,
      ),
    );
    _productRoute = route;
    final result = await Navigator.of(context).push(route);
    if (identical(_productRoute, route)) _productRoute = null;
    if (!_current || result == null) return;
    setState(() {
      _cart[result.lineId] = result;
      _quote = null;
      _setCartReview(false);
    });
  }

  Widget _amount(String label, MobileMoney value, {bool total = false}) =>
      FoodAmountRow(label: label, amount: money(value), total: total);
  // No "−0.00" line when the order has no discount.
  Widget _discountAmount(String label, MobileMoney value) =>
      BigInt.parse(value.amountMinor) == BigInt.zero
      ? const SizedBox.shrink()
      : FoodAmountRow(label: label, amount: '−${money(value)}');
  Widget _orderNotice(String message) => Container(
    margin: const EdgeInsets.only(top: 10),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.primaryContainer,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Text(message, style: Theme.of(context).textTheme.bodySmall),
  );
  Widget _destination(
    MobileFoodDeliverySnapshot destination, {
    bool includeFees = true,
  }) {
    if (widget.rootOwnsHeader) {
      return Card(
        key: const ValueKey('customer-order-detail-destination'),
        child: ListTileTheme(
          minLeadingWidth: 44,
          horizontalTitleGap: 14,
          child: ExpansionTile(
            tilePadding: const EdgeInsets.symmetric(horizontal: 14),
            childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
            minTileHeight: 82,
            visualDensity: VisualDensity.standard,
            leading: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(13),
              ),
              child: const Icon(Icons.location_on_outlined, size: 22),
            ),
            title: Text(destination.addressText),
            subtitle: destination.instructions.isEmpty
                ? null
                : Text(destination.instructions),
            children: [
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: Text(
                  '${destination.recipientName} · ${destination.phone}',
                ),
              ),
              if (includeFees) ...[
                _amount(
                  t('ค่าจัดส่ง', 'Delivery fee'),
                  destination.deliveryFee,
                ),
                _amount(t('ค่าบริการ', 'Service fee'), destination.serviceFee),
              ],
              if (destination.fixture)
                Text(
                  t(
                    'ข้อมูลทดสอบ · ตำแหน่งและค่าจัดส่งจำลอง',
                    'FIXTURE · synthetic location and delivery fees',
                  ),
                ),
            ],
          ),
        ),
      );
    }
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              t('ส่งถึง', 'Deliver to'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text('${destination.recipientName} · ${destination.phone}'),
            Text(destination.addressText),
            if (destination.instructions.isNotEmpty)
              Text(destination.instructions),
            if (includeFees) ...[
              _amount(t('ค่าจัดส่ง', 'Delivery fee'), destination.deliveryFee),
              _amount(t('ค่าบริการ', 'Service fee'), destination.serviceFee),
            ],
            if (destination.fixture)
              Text(
                t(
                  'ข้อมูลทดสอบ · ตำแหน่งและค่าจัดส่งจำลอง',
                  'FIXTURE · synthetic location and delivery fees',
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _originalCheckout() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (_payment.destinationOrigin.isEmpty)
        Text(
          t(
            'ยังไม่ตั้งค่าช่องทางชำระเงิน ไม่สามารถเปิดการชำระได้',
            'Payment unavailable: checkout origin is not configured.',
          ),
        ),
      FilledButton(
        onPressed: _busy || _pending != null
            ? null
            : () => unawaited(_choosePaymentMethod()),
        child: Text(
          t(
            'เลือกวิธีชำระออเดอร์เดิม',
            'Choose payment method for this order',
          ),
        ),
      ),
      BitPosInfoLine(
        thai: widget.thai,
        summary: t('ระบบตรวจสถานะออเดอร์เดิมเมื่อกลับมา', 'We re-check this order when you return'),
        title: t('เกี่ยวกับการชำระ', 'About payment'),
        paragraphs: [
          t(
            'กลับจากหน้าชำระแล้วระบบตรวจสอบสถานะออเดอร์เดิม ไม่สร้างการชำระใหม่จากผล callback',
            'On return, the app checks the original order. A callback never creates or confirms a payment.',
          ),
        ],
      ),
    ],
  );

  _FoodOrderPhase _visibleOrderPhase(MobileFoodOrder order) =>
      _detailsOrderId == order.id ? _FoodOrderPhase.detail : _phaseFor(order);

  _FoodOrderPhase _phaseFor(MobileFoodOrder order) {
    if (['REJECTED', 'TIMED_OUT'].contains(order.acceptanceStatus) ||
        order.refunds.isNotEmpty ||
        order.nextRefundCursor != null) {
      return _FoodOrderPhase.detail;
    }
    if (order.status == 'CONFIRMING') return _FoodOrderPhase.paymentPending;
    if (order.status != 'PAID') return _FoodOrderPhase.detail;
    if (order.acceptanceStatus == 'ACCEPTED' &&
        order.fulfillmentStatus == 'PREPARING') {
      return _FoodOrderPhase.preparing;
    }
    if (order.acceptanceStatus == 'ACCEPTED' &&
        order.fulfillmentStatus == 'RECEIVED') {
      return _FoodOrderPhase.accepted;
    }
    return _FoodOrderPhase.detail;
  }

  Widget _orderPhase(MobileFoodOrder order, _FoodOrderPhase phase) {
    if (phase == _FoodOrderPhase.detail) return const SizedBox.shrink();
    return _FoodOrderPhasePanel(
      key: ValueKey('food-order-phase.${phase.name}'),
      order: order,
      phase: phase,
      thai: widget.thai,
      onRefresh: _busy ? null : () => _run(_refreshOrder),
      onSupport: _busy ? null : () => _run(_support),
      onTrack: order.delivery == null || _busy ? null : _trackDelivery,
      showInlineActions: !widget.rootOwnsHeader,
    );
  }

  @override
  Widget build(BuildContext context) {
    final menu = _menu, q = _quote, o = _order;
    final phase = o == null ? null : _visibleOrderPhase(o);
    final home = menu == null && q == null && o == null;
    final menuQuery = _search.toLowerCase();
    final visibleProducts = _products
        .where(
          (p) => '${p.name} ${p.nameEn} ${p.category}'.toLowerCase().contains(
            menuQuery,
          ),
        )
        .toList();
    final history = IconButton(
      tooltip: t('ออเดอร์ของฉัน', 'My orders'),
      onPressed: _busy ? null : () => _run(_history),
      icon: const Icon(Icons.receipt_long),
    );
    return FoodPresentation(
      child: Builder(
        builder: (context) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (home && widget.sessionTools != null) ...[
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'BitPOS',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  history,
                  widget.sessionTools!,
                ],
              ),
              const SizedBox(height: 8),
            ],
            if (widget.rootOwnsHeader && home)
              Text(
                t('วันนี้อยากทานอะไร?', 'What would you like today?'),
                style: Theme.of(context).textTheme.headlineSmall,
              )
            else if (widget.rootOwnsHeader)
              ...[]
            else if (home && widget.sessionTools != null)
              Text(
                t('วันนี้อยากทานอะไร?', 'What would you like today?'),
                style: Theme.of(context).textTheme.headlineSmall,
              )
            else
              FoodHeader(
                title: o != null
                    ? phase!.title(widget.thai)
                    : q != null
                    ? _cartReview
                          ? t('ตะกร้าของคุณ', 'Your cart')
                          : t('ตรวจสอบออเดอร์', 'Review order')
                    : menu != null
                    ? merchantBranchLabel(
                        thai: widget.thai,
                        name: menu.branch.name,
                        nameEn: menu.branch.nameEn,
                        merchantName: menu.branch.merchantName,
                      )
                    : t('วันนี้อยากทานอะไร?', 'What would you like today?'),
                trailing: q != null && _cartReview
                    ? Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            tooltip: t('กลับไปเมนู', 'Back to menu'),
                            onPressed: _busy || _pending != null
                                ? null
                                : () => setState(() {
                                    _quote = null;
                                    _setCartReview(false);
                                  }),
                            icon: const Icon(Icons.arrow_back),
                          ),
                          history,
                        ],
                      )
                    : history,
              ),
            SizedBox(
              height: widget.rootOwnsHeader && q != null
                  ? 12
                  : q != null && !_cartReview
                  ? 9
                  : 12,
            ),
            if (_busy) const LinearProgressIndicator(),
            if (_error != null)
              Semantics(
                liveRegion: true,
                child: Container(
                  key: const ValueKey('food-action-error'),
                  margin: const EdgeInsets.symmetric(vertical: 12),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.info_outline,
                        size: 20,
                        color: Theme.of(context).colorScheme.onErrorContainer,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          checkoutRefusalMessage(_error!, widget.thai),
                          style: TextStyle(
                            color: Theme.of(context)
                                .colorScheme
                                .onErrorContainer,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            if (_pending != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        t('คำขอออเดอร์ที่บันทึกไว้', 'Saved order request'),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        t(
                          'หากยังไม่ทราบผล ห้ามสร้างออเดอร์ใหม่ ลองคำขอเดิมด้วยเลขเดิม',
                          'When outcome is unknown, do not create another order. Retry the same saved request.',
                        ),
                      ),
                      FilledButton(
                        onPressed: _busy ? null : () => _run(_submit),
                        child: Text(
                          t(
                            'ตรวจสอบ / ลองคำขอเดิม',
                            'Recover / retry saved request',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            if (_recoverOrderId != null && o == null)
              OutlinedButton(
                onPressed: _busy ? null : () => _run(_restoreActiveOrder),
                child: Text(
                  t(
                    'กู้คืนสถานะออเดอร์เดิม',
                    'Recover original order status',
                  ),
                ),
              ),
            if (o != null) ...[
              Card(
                margin: widget.rootOwnsHeader ? EdgeInsets.zero : null,
                elevation: widget.rootOwnsHeader ? 0 : null,
                color: widget.rootOwnsHeader ? Colors.transparent : null,
                shape: widget.rootOwnsHeader
                    ? RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(18),
                      )
                    : null,
                child: Padding(
                  padding: widget.rootOwnsHeader
                      ? EdgeInsets.zero
                      : const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (phase != _FoodOrderPhase.detail) ...[
                        _orderPhase(o, phase!),
                        if (phase == _FoodOrderPhase.paymentPending)
                          ExpansionTile(
                            title: Text(
                              t(
                                'ตัวเลือกชำระเงินเดิม',
                                'Original payment options',
                              ),
                            ),
                            children: [_originalCheckout()],
                          ),
                        if (!widget.rootOwnsHeader) ...[
                          const SizedBox(height: BitPosDesignTokens.s20),
                          OutlinedButton(
                            onPressed: _busy
                                ? null
                                : () => _setOrderDetails(true),
                            child: Text(
                              t('ดูรายละเอียดออเดอร์', 'View order details'),
                            ),
                          ),
                        ],
                        if (phase != _FoodOrderPhase.paymentPending &&
                            !widget.rootOwnsHeader) ...[
                          OutlinedButton(
                            onPressed: _busy ? null : () => _run(_refreshOrder),
                            child: Text(
                              t(
                                'อัปเดตสถานะจากเซิร์ฟเวอร์',
                                'Refresh server status',
                              ),
                            ),
                          ),
                          OutlinedButton(
                            onPressed: _busy ? null : () => _run(_support),
                            child: Text(
                              t(
                                'ขอความช่วยเหลือออเดอร์นี้',
                                'Get help with this order',
                              ),
                            ),
                          ),
                        ],
                      ] else ...[
                        if (!widget.rootOwnsHeader) ...[
                          Text(
                            t('รายละเอียดออเดอร์', 'Order details'),
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          Text('#${o.id.substring(0, 8)}'),
                          const SizedBox(height: 12),
                        ],
                        if (o.configured != null)
                          ConfiguredFoodLines(
                            lines: o.configured!.lines,
                            thai: widget.thai,
                            compact: widget.rootOwnsHeader,
                          )
                        else
                          ...o.lines.map(
                            (l) => Text(
                              '${l.qty} × ${widget.thai ? l.name : l.nameEn} · ${money(l.unitPrice)}',
                            ),
                          ),
                        if (o.configured != null) ...[
                          _amount(
                            t('ค่าอาหาร', 'Food subtotal'),
                            o.configured!.subtotal,
                          ),
                          if (o.delivery != null) ...[
                            _amount(
                              t('ค่าจัดส่ง', 'Delivery fee'),
                              o.delivery!.deliveryFee,
                            ),
                            _discountAmount(
                              t('ส่วนลด', 'Discount'),
                              o.configured!.discount,
                            ),
                            _amount(
                              t('ค่าบริการ', 'Service fee'),
                              o.delivery!.serviceFee,
                            ),
                          ] else ...[
                            _amount(
                              t('ค่าธรรมเนียม', 'Fees'),
                              o.configured!.fees,
                            ),
                            _discountAmount(
                              t('ส่วนลด', 'Discount'),
                              o.configured!.discount,
                            ),
                          ],
                          if (BigInt.parse(o.configured!.tax.amountMinor) >
                              BigInt.zero)
                            _amount(
                              t('ภาษีเพิ่มเติม', 'Additional tax'),
                              o.configured!.tax,
                            ),
                          if (widget.rootOwnsHeader) const Divider(height: 20),
                          _amount(t('ยอดรวม', 'Total'), o.total, total: true),
                        ] else ...[
                          Text(
                            t(
                              'ไม่มีรายละเอียดแยกค่าใช้จ่ายในข้อมูลออเดอร์เดิม',
                              'This order snapshot does not contain a fee breakdown.',
                            ),
                          ),
                          _amount(t('ยอดรวม', 'Total'), o.total, total: true),
                        ],
                        if (o.delivery != null)
                          _destination(o.delivery!, includeFees: false),
                        const SizedBox(height: BitPosDesignTokens.s20),
                        if (widget.rootOwnsHeader)
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  key: const ValueKey(
                                    'order-detail-cancel-review',
                                  ),
                                  onPressed:
                                      _busy ||
                                          o.delivery == null ||
                                          [
                                            'REJECTED',
                                            'TIMED_OUT',
                                          ].contains(o.acceptanceStatus)
                                      ? null
                                      : () => _run(_requestCancellationReview),
                                  child: Text(t('ตรวจยกเลิก', 'Cancel review')),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: OutlinedButton(
                                  key: const ValueKey('order-detail-refunds'),
                                  onPressed:
                                      _busy ||
                                          (o.refunds.isEmpty &&
                                              o.nextRefundCursor == null)
                                      ? null
                                      : () => _run(_refunds),
                                  child: Text(t('ดูคืนเงิน', 'Refunds')),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: OutlinedButton(
                                  key: const ValueKey('order-detail-review'),
                                  onPressed: _busy
                                      ? null
                                      : () => _run(_reviewMeal),
                                  child: Text(t('รีวิว', 'Review')),
                                ),
                              ),
                            ],
                          ),
                        if ([
                          'REJECTED',
                          'TIMED_OUT',
                        ].contains(o.acceptanceStatus))
                          _orderNotice(
                            t(
                              'ร้านไม่ดำเนินการออเดอร์นี้ ตรวจสอบรายการชำระเดิมก่อนดำเนินการต่อ',
                              'The merchant will not prepare this order. Check the original payment before taking another step.',
                            ),
                          ),
                        if (o.status == 'RECOVERY')
                          _orderNotice(
                            t(
                              'การชำระต้องตรวจสอบ ห้ามชำระซ้ำ และภาระคืนเงินยังไม่ใช่เงินที่โอนคืนแล้ว',
                              'Payment needs reconciliation. Do not pay again; a refund obligation is not a completed transfer.',
                            ),
                          ),
                        if (o.refunds.isNotEmpty)
                          _orderNotice(
                            '${t('บันทึกภาระคืนเงิน', 'Recorded refund obligation')} ${money(o.refunds.first.money)} · ${t('ยังไม่ใช่หลักฐานโอนคืน', 'Not proof of transfer')}',
                          ),
                        if (o.status != 'PAID' && o.status != 'RECOVERY')
                          _originalCheckout(),
                        ExpansionTile(
                          key: const ValueKey('order-detail-status-history'),
                          tilePadding: EdgeInsets.zero,
                          initiallyExpanded: !widget.rootOwnsHeader,
                          title: Text(
                            t('สถานะและประวัติ', 'Status and history'),
                          ),
                          children: [
                            const Divider(height: 28),
                            if (_scheduledSlot case final slot?)
                              Text(
                                key: const ValueKey('order-scheduled-slot'),
                                '${t('นัดเวลา', 'Scheduled for')}: ${ScheduleSlotTile.format(slot, widget.thai)} · ${t('เวลาตามที่ร้านกำหนด', 'time set by the merchant')}',
                              ),
                            Text(
                              '${t('การชำระ', 'Payment')}: ${foodStateLabel(o.status, widget.thai)}',
                            ),
                            Text(
                              '${t('ร้านรับออเดอร์', 'Merchant acceptance')}: ${foodStateLabel(o.acceptanceStatus, widget.thai)}',
                            ),
                            if (o.preparation case final estimate?)
                              Text(
                                '${t('เวลาเตรียมโดยประมาณ', 'Estimated preparation')}: ${estimate.minutes} ${t('นาที', 'minutes')} · ${t('ไม่ใช่เวลาพร้อมรับที่รับประกัน', 'Not a guaranteed ready time')}',
                              ),
                            Text(
                              '${t('ครัว / จุดรับ', 'Kitchen / pickup')}: ${foodStateLabel(o.fulfillmentStatus, widget.thai)}',
                            ),
                            Text(
                              '${t('กำหนดรับออเดอร์', 'Acceptance deadline')}: ${DateTime.parse(o.acceptanceDeadline).toLocal()}',
                            ),
                            if (o.acceptanceReason != null)
                              Text(
                                '${t('เหตุผล', 'Reason')}: ${o.acceptanceReason == 'ACCEPTANCE_DEADLINE' ? foodStateLabel('TIMED_OUT', widget.thai) : o.acceptanceReason}',
                              ),
                            ...o.refunds
                                .take(1)
                                .map(
                                  (r) => Card(
                                    child: Padding(
                                      padding: const EdgeInsets.all(12),
                                      child: Text(
                                        '${t('ภาระคืนเงินที่บันทึกไว้', 'Recorded refund obligation')}: ${money(r.money)} · ${r.status}\n${t('ยังไม่ใช่หลักฐานโอนคืน ผู้ให้บริการคืนเงินยังไม่พร้อมใช้งาน', 'Not proof of a return transfer. Refund provider execution is not configured.')}',
                                      ),
                                    ),
                                  ),
                                ),
                            if (o.refunds.length > 1 ||
                                o.nextRefundCursor != null)
                              Text(
                                t(
                                  'แสดงรายการแรก เปิดทุกหน้าเพื่อดูประวัติคืนเงินทั้งหมด',
                                  'Showing the first obligation. Open all pages for the full refund history.',
                                ),
                              ),
                            if (!widget.rootOwnsHeader &&
                                (o.refunds.isNotEmpty ||
                                    o.nextRefundCursor != null))
                              OutlinedButton(
                                onPressed: _busy ? null : () => _run(_refunds),
                                child: Text(
                                  t(
                                    'ดูภาระคืนเงินทุกหน้า / อัปเดต',
                                    'All refund pages / refresh',
                                  ),
                                ),
                              ),
                            if (![
                              'REJECTED',
                              'TIMED_OUT',
                            ].contains(o.acceptanceStatus))
                              BitPosInfoLine(
                                thai: widget.thai,
                                summary: o.delivery == null
                                    ? t('รับอาหารที่ร้าน', 'Collect at the merchant')
                                    : t('จัดส่งไปยังที่อยู่ที่ยืนยันไว้', 'Delivery to the confirmed address'),
                                title: t('เกี่ยวกับการรับอาหาร', 'About receiving your order'),
                                paragraphs: [
                                  o.delivery == null
                                      ? t(
                                          'รับอาหารที่ร้าน การรับจากร้านไม่ใช่การส่งถึงลูกค้า',
                                          'Collect at the merchant. Store collection is not delivery to a customer.',
                                        )
                                      : t(
                                          'จัดส่งไปยังที่อยู่ที่ยืนยันไว้ การส่งมอบที่ร้านให้ไรเดอร์ไม่ใช่การส่งถึงลูกค้า',
                                          'Delivery to the confirmed address. Merchant handoff to a driver is not delivery to the customer.',
                                        ),
                                ],
                              ),
                            const SizedBox(height: BitPosDesignTokens.s12),
                            if (o.delivery != null && !widget.rootOwnsHeader)
                              FilledButton.icon(
                                style: FilledButton.styleFrom(
                                  minimumSize: const Size.fromHeight(52),
                                ),
                                onPressed: _busy ? null : _trackDelivery,
                                icon: const Icon(Icons.delivery_dining),
                                label: Text(
                                  t('ติดตามการจัดส่ง', 'Track delivery'),
                                ),
                              ),
                            if (!widget.rootOwnsHeader &&
                                o.delivery != null &&
                                ![
                                  'REJECTED',
                                  'TIMED_OUT',
                                ].contains(o.acceptanceStatus))
                              OutlinedButton.icon(
                                onPressed: _busy
                                    ? null
                                    : () => _run(_requestCancellationReview),
                                icon: const Icon(Icons.cancel_outlined),
                                label: Text(
                                  t(
                                    'ขอให้ตรวจสอบการยกเลิก',
                                    'Request cancellation review',
                                  ),
                                ),
                              ),
                            if (!['PAID', 'RECOVERY'].contains(o.status))
                              BitPosInfoLine(
                                thai: widget.thai,
                                summary: t('ยังไม่มีหลักฐานชำระเงินที่ยืนยัน', 'No verified payment yet'),
                                title: t('เกี่ยวกับการยืนยันชำระ', 'About payment confirmation'),
                                paragraphs: [
                                  t(
                                    'ยังไม่มีหลักฐานชำระเงินที่ยืนยันแล้ว หน้านี้ไม่ใช้ลายเซ็นหรือการกดปุ่มเป็นหลักฐานชำระ',
                                    'No verified payment yet. A signature or UI action cannot confirm payment.',
                                  ),
                                ],
                              ),
                            if (!widget.rootOwnsHeader)
                              OutlinedButton.icon(
                                onPressed: _busy
                                    ? null
                                    : () => _run(_reviewMeal),
                                icon: const Icon(Icons.star_border),
                                label: Text(
                                  t('ให้คะแนนมื้อนี้', 'Rate this meal'),
                                ),
                              ),
                            OutlinedButton.icon(
                              onPressed: _busy ? null : () => _run(_support),
                              icon: const Icon(Icons.support_agent),
                              label: Text(
                                t(
                                  'ขอความช่วยเหลือออเดอร์นี้',
                                  'Get help with this order',
                                ),
                              ),
                            ),
                            OutlinedButton(
                              onPressed: _busy
                                  ? null
                                  : () => _run(_refreshOrder),
                              child: Text(
                                t(
                                  'อัปเดตสถานะจากเซิร์ฟเวอร์',
                                  'Refresh server status',
                                ),
                              ),
                            ),
                            if (_timeline != null)
                              ..._timeline!.events.map(
                                (e) => ListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(
                                    foodStateLabel(e.kind, widget.thai),
                                  ),
                                  subtitle: Text(
                                    '${foodStateLabel(e.paymentStatus, widget.thai)} · ${foodStateLabel(e.acceptanceStatus, widget.thai)} · ${foodStateLabel(e.fulfillmentStatus, widget.thai)}\n${DateTime.parse(e.occurredAt).toLocal()}',
                                  ),
                                ),
                              ),
                            if (_timeline?.nextCursor != null)
                              OutlinedButton(
                                onPressed: _busy
                                    ? null
                                    : () => _run(_nextEvents),
                                child: Text(
                                  t('เหตุการณ์ถัดไป', 'Next timeline events'),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              if (phase == _FoodOrderPhase.detail && !widget.rootOwnsHeader)
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => _run(() async {
                          await widget.api.forgetFoodOrder();
                          _scheduledSlot = null;
                          _recoverOrderId = null;
                          _order = null;
                          _timeline = null;
                          _menu = null;
                          _syncOrderDetailNavigation();
                        }),
                  child: Text(t('กลับไปร้านอาหาร', 'Back to merchants')),
                ),
            ] else if (q != null) ...[
              if (_quoteNotice != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    _quoteNotice!,
                    key: const ValueKey('quote-notice'),
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (_cartReview) ...[
                ConfiguredFoodLines(
                  lines: q.configured.lines,
                  imageUrls: {
                    for (final product in _products)
                      product.id: product.imageUrl,
                  },
                  thai: widget.thai,
                  compact: true,
                ),
                QuotePriceSummary(
                  thai: widget.thai,
                  compact: widget.rootOwnsHeader,
                  showDiscount:
                      BigInt.parse(q.discount.amountMinor) != BigInt.zero,
                  showFees: BigInt.parse(q.fees.amountMinor) != BigInt.zero,
                  showTax: BigInt.parse(q.tax.amountMinor) != BigInt.zero,
                  subtotal: money(q.subtotal),
                  discount: money(q.discount),
                  fees: money(q.fees),
                  tax: money(q.tax),
                  total: money(q.total),
                ),
                if (q.delivery != null) _destination(q.delivery!),
                Card(
                  key: const ValueKey('cart-coupon-entry'),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14),
                    horizontalTitleGap: 14,
                    minLeadingWidth: 44,
                    minTileHeight: 82,
                    leading: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: const Icon(Icons.local_offer_outlined),
                    ),
                    title: Text(t('ใช้คูปองส่วนลด', 'Discount coupons')),
                    subtitle: Text(
                      _couponQuoteId == q.id
                          ? t(
                              'ใช้คูปอง $_couponCode · ลด ${money(q.discount)}',
                              'Coupon $_couponCode · saves ${money(q.discount)}',
                            )
                          : t('ใส่รหัสคูปอง', 'Enter a coupon code'),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: _busy || _pending != null
                        ? null
                        : () => _openCoupon(q),
                  ),
                ),
                ScheduleSlotTile(
                  thai: widget.thai,
                  availability: _scheduleAvailability,
                  slots: _slots,
                  selected: _selectedSlot,
                  enabled: !_busy && _pending == null,
                  onChanged: (slot) => setState(() {
                    _selectedSlot = slot;
                    _slotCommand = null;
                  }),
                ),
                TextButton.icon(
                  onPressed: _busy || _pending != null
                      ? null
                      : () => setState(() {
                          _quote = null;
                          _setCartReview(false);
                        }),
                  icon: const Icon(Icons.edit_outlined),
                  label: Text(t('แก้ไขตะกร้า', 'Edit cart')),
                ),
                if (widget.navigation == null)
                  FilledButton(
                    onPressed: _busy || _pending != null
                        ? null
                        : () => setState(() => _setCartReview(false)),
                    child: Text(
                      t('ไปตรวจสอบออเดอร์', 'Continue to order review'),
                    ),
                  ),
                TextButton(
                  onPressed: _busy || _pending != null
                      ? null
                      : () => _run(_review),
                  child: Text(t('อัปเดตราคา', 'Refresh server quote')),
                ),
              ] else ...[
                ConfiguredFoodLines(
                  lines: q.configured.lines,
                  imageUrls: {
                    for (final product in _products)
                      product.id: product.imageUrl,
                  },
                  thai: widget.thai,
                  compact: true,
                ),
                QuotePriceSummary(
                  thai: widget.thai,
                  compact: true,
                  showDiscount:
                      BigInt.parse(q.discount.amountMinor) != BigInt.zero,
                  showFees: BigInt.parse(q.fees.amountMinor) != BigInt.zero,
                  showTax: BigInt.parse(q.tax.amountMinor) != BigInt.zero,
                  subtotal: money(q.subtotal),
                  discount: money(q.discount),
                  fees: money(q.fees),
                  tax: money(q.tax),
                  total: money(q.total),
                ),
                if (q.delivery != null) _destination(q.delivery!),
                Text(
                  '${t('ยอดชำระทดสอบ', 'Test settlement')}: ${money(q.settlement.money)}',
                ),
                Text(
                  'Solana devnet · ${t('ไม่ใช่เงินจริง', 'not real money')}',
                ),
                if (_couponQuoteId == q.id)
                  Text(
                    key: const ValueKey('review-coupon-line'),
                    '${t('คูปอง', 'Coupon')} $_couponCode: -${money(q.discount)}',
                  ),
                if (_selectedSlot case final slot?)
                  Text(
                    key: const ValueKey('review-scheduled-slot'),
                    '${t('นัดเวลา', 'Scheduled for')}: ${ScheduleSlotTile.format(slot, widget.thai)}',
                  ),
                if (!widget.rootOwnsHeader)
                  QuoteConfirmation(
                    key: ValueKey(q.id),
                    validUntil: q.validUntil,
                    total: money(q.total),
                    thai: widget.thai,
                    delivery: q.delivery != null,
                    blocked: _busy || _pending != null,
                    onConfirm: () => _run(_submit),
                  ),
                TextButton(
                  onPressed: _busy || _pending != null
                      ? null
                      : () => setState(() {
                          _quote = null;
                          _setCartReview(false);
                        }),
                  child: Text(t('แก้ตะกร้า', 'Edit cart')),
                ),
              ],
            ] else if (menu != null) ...[
              if (!widget.rootOwnsHeader)
                TextButton.icon(
                  onPressed: _busy || _pending != null
                      ? null
                      : () => setState(() => _menu = null),
                  icon: const Icon(Icons.arrow_back),
                  label: Text(t('ร้านอาหาร', 'Merchants')),
                ),
              Semantics(
                label: t('ยังไม่มีภาพร้าน', 'Merchant photo unavailable'),
                image: true,
                child: ExcludeSemantics(
                  child: Container(
                    key: const ValueKey('merchant-detail-hero'),
                    height: 192,
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                      color: Theme.of(context)
                          .colorScheme
                          .surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Icon(
                      Icons.storefront_outlined,
                      size: 64,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
              if (widget.rootOwnsHeader)
                Text(
                  merchantBranchLabel(
                    thai: widget.thai,
                    name: menu.branch.name,
                    nameEn: menu.branch.nameEn,
                    merchantName: menu.branch.merchantName,
                  ),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              Text(menu.branch.addressLabel),
              const SizedBox(height: BitPosDesignTokens.s12),
              Wrap(
                spacing: 8,
                children: [
                  ChoiceChip(
                    label: Text(t('รับที่ร้าน', 'Pickup')),
                    selected: !_delivery,
                    onSelected:
                        _busy || _pending != null || !menu.branch.pickupEnabled
                        ? null
                        : (_) => setState(() {
                            _delivery = false;
                            _quote = null;
                            _setCartReview(false);
                          }),
                  ),
                  ChoiceChip(
                    label: Text(t('จัดส่ง', 'Delivery')),
                    selected: _delivery,
                    onSelected:
                        _busy ||
                            _pending != null ||
                            !menu.branch.deliveryEnabled
                        ? null
                        : (_) => _run(_chooseDelivery),
                  ),
                ],
              ),
              if (menu.branch.openNow == false)
                BitPosStateView(
                  kind: BitPosStateKind.closed,
                  thai: widget.thai,
                  message: branchClosedMessage(menu.branch, widget.thai),
                ),
              if (!menu.branch.pickupEnabled && !menu.branch.deliveryEnabled)
                Text(
                  t(
                    'ร้านนี้ยังไม่เปิดรับออเดอร์',
                    'Ordering unavailable at this branch',
                  ),
                ),
              if (_delivery && _deliveryPolicy != null) ...[
                _amount(
                  t('ค่าจัดส่ง', 'Delivery fee'),
                  _deliveryPolicy!.deliveryFee,
                ),
                _amount(
                  t('ค่าบริการ', 'Service fee'),
                  _deliveryPolicy!.serviceFee,
                ),
                if (_deliveryPolicy!.fixture)
                  Text(
                    t(
                      'ข้อมูลทดสอบ · พื้นที่และค่าจัดส่งจำลอง',
                      'FIXTURE · synthetic service area and fees',
                    ),
                  ),
                if (_deliveryAddress case final address?)
                  Card(
                    color: Theme.of(context).colorScheme.surface,
                    child: ListTile(
                      leading: const Icon(Icons.location_on_outlined),
                      title: Text(address.address.label),
                      subtitle: Text(address.address.addressText),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: _busy || _pending != null
                          ? null
                          : () => _run(_pickDeliveryAddress),
                    ),
                  )
                else
                  OutlinedButton.icon(
                    onPressed: _busy || _pending != null
                        ? null
                        : () => _run(_pickDeliveryAddress),
                    icon: const Icon(Icons.location_on_outlined),
                    label: Text(
                      t('เลือกที่อยู่จัดส่ง', 'Choose delivery address'),
                    ),
                  ),
                if (_deliveryAddress == null && _deliveryAddresses.isEmpty)
                  Text(
                    t(
                      'เพิ่มที่อยู่พร้อมพิกัดในบัญชี แล้วโหลดที่อยู่อีกครั้ง',
                      'Add an address with coordinates in Account, then reload addresses.',
                    ),
                  ),
                if (_addressCursor != null)
                  TextButton(
                    onPressed: _busy || _pending != null
                        ? null
                        : () => _run(_moreDeliveryAddresses),
                    child: Text(t('ที่อยู่เพิ่มเติม', 'More addresses')),
                  ),
                TextButton(
                  onPressed: _busy || _pending != null
                      ? null
                      : () => _run(_chooseDelivery),
                  child: Text(
                    t(
                      'โหลดพื้นที่ ค่าจัดส่ง และที่อยู่อีกครั้ง',
                      'Reload delivery area, fees and addresses',
                    ),
                  ),
                ),
              ],
              TextField(
                controller: _searchController,
                enabled: !_busy && _pending == null,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: t('ค้นหาเมนู', 'Search menu'),
                  suffixIcon: _search.isEmpty
                      ? null
                      : IconButton(
                          tooltip: t('ล้างการค้นหาเมนู', 'Clear menu search'),
                          onPressed: _busy || _pending != null
                              ? null
                              : () => setState(() {
                                  _search = '';
                                  _searchController.clear();
                                }),
                          icon: const Icon(Icons.clear),
                        ),
                ),
                onChanged: (value) => setState(() => _search = value),
              ),
              const SizedBox(height: BitPosDesignTokens.s20),
              Text(
                t('เมนูของร้าน', 'Menu'),
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: BitPosDesignTokens.s12),
              ...visibleProducts.map((p) {
                final enabled =
                    !_busy &&
                    _pending == null &&
                    p.unitPrice != null &&
                    _productQuantity(p.id) < p.available &&
                    _productQuantity(p.id) < 100 &&
                    _cart.length < 50;
                return FoodProductCard(
                  product: p,
                  thai: widget.thai,
                  onConfigure: enabled
                      ? () => _run(() => _editProduct(p))
                      : null,
                );
              }),
              if (_products.isEmpty)
                Text(t('ยังไม่มีเมนู', 'No menu items available'))
              else if (visibleProducts.isEmpty)
                Semantics(
                  liveRegion: true,
                  child: Text(
                    t(
                      'ไม่พบเมนูที่ตรงกับการค้นหา ล้างการค้นหาเพื่อดูเมนูทั้งหมด',
                      'No matching menu items. Clear search to see all menu items.',
                    ),
                  ),
                ),
              if (_cart.isNotEmpty) ...[
                const SizedBox(height: BitPosDesignTokens.s20),
                Text(
                  t('ตะกร้าของคุณ', 'Your cart'),
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: BitPosDesignTokens.s12),
              ],
              ..._cart.values.map((item) {
                final matches = _products.where((p) => p.id == item.productId),
                    product = matches.isEmpty ? null : matches.first;
                return FoodCartLineCard(
                  item: item,
                  product: product,
                  thai: widget.thai,
                  onEdit: _busy || _pending != null || product == null
                      ? null
                      : () => _run(() => _editProduct(product, initial: item)),
                  onRemove: _busy || _pending != null
                      ? null
                      : () => setState(() {
                          _cart.remove(item.lineId);
                          _quote = null;
                          _setCartReview(false);
                        }),
                );
              }),
              FilledButton(
                onPressed:
                    _busy ||
                        _pending != null ||
                        _cart.isEmpty ||
                        (_delivery
                            ? (!menu.branch.deliveryEnabled ||
                                  _deliveryAddress == null)
                            : !menu.branch.pickupEnabled)
                    ? null
                    : () => _run(_review),
                child: Text(
                  '${t('ตรวจตะกร้า', 'Review cart')} · ${_cart.values.fold<int>(0, (a, b) => a + b.qty)}',
                ),
              ),
              OutlinedButton(
                onPressed: _busy || _pending != null
                    ? null
                    : () => _run(() => _open(menu.branch, preserveCart: true)),
                child: Text(
                  t('โหลดเมนูใหม่โดยเก็บตะกร้า', 'Refresh menu; keep cart'),
                ),
              ),
              TextButton.icon(
                onPressed: _busy ? null : () => _run(_publicReviews),
                icon: const Icon(Icons.star_border),
                label: Text(t('อ่านรีวิวจากลูกค้า', 'Read customer reviews')),
              ),
            ] else ...[
              MerchantSearchControls(
                controller: _branchSearchController,
                thai: widget.thai,
                busy: _busy,
                serving: _branchServing,
                onSearch: () => _run(() async {
                  _branchSearch = _branchSearchController.text.trim();
                  await _reloadBranches();
                }),
                onServing: (mode) => _run(() async {
                  _branchServing = mode;
                  _branchSearch = _branchSearchController.text.trim();
                  await _reloadBranches();
                }),
              ),
              MerchantSearchInformation(thai: widget.thai),
              if (_cart.isNotEmpty && _cartBranch != null)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          t('ตะกร้าของคุณยังอยู่', 'Your cart is saved'),
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${t('ร้านเดิม', 'Saved merchant')}: ${merchantBranchLabel(thai: widget.thai, name: _cartBranch!.name, nameEn: _cartBranch!.nameEn, merchantName: _cartBranch!.merchantName)}',
                        ),
                        TextButton.icon(
                          key: const ValueKey('discovery-return-to-cart'),
                          onPressed: _busy || _pending != null
                              ? null
                              : () => _run(() => _open(_cartBranch!)),
                          icon: const Icon(Icons.shopping_bag_outlined),
                          label: Text(
                            t('กลับไปตะกร้าร้านเดิม', 'Return to saved cart'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

              Text(
                t('ร้านที่ค้นพบ', 'Available merchants'),
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: BitPosDesignTokens.s12),
              if (_busy && _branches.isEmpty)
                MerchantDiscoveryLoading(thai: widget.thai),
              ..._branches.map(
                (b) => MerchantBranchCard(
                  branch: b,
                  thai: widget.thai,
                  onOpen: _busy || _pending != null
                      ? null
                      : () => _run(() => _open(b)),
                  onFavourite: _busy
                      ? null
                      : () => _run(() async {
                          await widget.api.setFavourite(b.id, true);
                          if (context.mounted && _current)
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  t('บันทึกร้านโปรดแล้ว', 'Favourite saved.'),
                                ),
                              ),
                            );
                        }),
                ),
              ),
              if (_branches.isEmpty && !_discoveryLoaded && !_busy && _error != null)
                BitPosStateView(
                  kind: _error is MobileApiException
                      ? BitPosStateKind.error
                      : BitPosStateKind.offline,
                  thai: widget.thai,
                  message: checkoutRefusalMessage(_error!, widget.thai),
                  actionLabel: t('ลองอีกครั้ง', 'Try again'),
                  onAction: () => _run(_reloadBranches),
                ),
              if (_branches.isEmpty && _discoveryLoaded && !_busy)
                MerchantSearchEmpty(
                  thai: widget.thai,
                  query: _branchSearch,
                  filtered: _branchServing != 'all',
                  onReset: _busy
                      ? null
                      : () => _run(() async {
                          _branchSearchController.clear();
                          _branchSearch = '';
                          _branchServing = 'all';
                          await _reloadBranches();
                        }),
                ),
              OutlinedButton(
                onPressed: _busy ? null : () => _run(_reloadBranches),
                child: Text(
                  _discoveryLoaded
                      ? t('อัปเดตร้านอาหาร', 'Refresh merchants')
                      : t('ลองโหลดร้านอีกครั้ง', 'Retry loading merchants'),
                ),
              ),
              if (_branchCursor != null)
                OutlinedButton(
                  onPressed: _busy ? null : () => _run(_loadMore),
                  child: Text(t('ร้านเพิ่มเติม', 'More merchants')),
                ),
            ],
            if (!home && widget.sessionTools != null) ...[
              const SizedBox(height: 24),
              Align(
                alignment: Alignment.centerRight,
                child: widget.sessionTools!,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

enum _FoodOrderPhase {
  paymentPending('กำลังตรวจสอบการชำระเงิน', 'Checking payment'),
  accepted('ร้านรับออเดอร์แล้ว', 'Order accepted'),
  preparing('กำลังเตรียมมื้อของคุณ', 'Preparing your meal'),
  detail('รายละเอียดออเดอร์', 'Order details');

  const _FoodOrderPhase(this.thaiTitle, this.englishTitle);
  final String thaiTitle, englishTitle;
  String title(bool thai) => thai ? thaiTitle : englishTitle;
}

class _FoodOrderPhasePanel extends StatelessWidget {
  const _FoodOrderPhasePanel({
    super.key,
    required this.order,
    required this.phase,
    required this.thai,
    this.onRefresh,
    this.onSupport,
    this.onTrack,
    this.showInlineActions = true,
  });

  final MobileFoodOrder order;
  final _FoodOrderPhase phase;
  final bool thai;
  final VoidCallback? onRefresh;
  final VoidCallback? onSupport;
  final VoidCallback? onTrack;
  final bool showInlineActions;

  String t(String th, String en) => thai ? th : en;

  @override
  Widget build(BuildContext context) {
    final pending = phase == _FoodOrderPhase.paymentPending;
    final preparing = phase == _FoodOrderPhase.preparing;
    final estimate = order.preparation;
    final colors = Theme.of(context).colorScheme;
    final title = phase.title(thai);
    final subtitle = pending
        ? t(
            'เรากำลังตรวจสอบรายการชำระเงินเดิม คุณกลับมาอัปเดตสถานะได้',
            'We are checking the original payment. You can return to refresh its status.',
          )
        : preparing
        ? t(
            'ร้านเริ่มเตรียมรายการแล้ว เราจะแจ้งเมื่อมีสถานะใหม่',
            'The merchant has started preparing your order. We will show new server status here.',
          )
        : t(
            'ร้านยืนยันออเดอร์แล้ว',
            'The merchant has confirmed your order.',
          );
    return Semantics(
      container: true,
      label: title,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (pending) ...[
            const SizedBox(height: 42),
            Center(
              child: Container(
                width: 116,
                height: 116,
                decoration: BoxDecoration(
                  color: const Color(0xffefe6f8),
                  borderRadius: BorderRadius.circular(58),
                ),
                child: const Icon(
                  Icons.sync_rounded,
                  color: Color(0xff64188a),
                  size: 48,
                ),
              ),
            ),
            const SizedBox(height: 28),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            Text(subtitle, textAlign: TextAlign.center),
            const SizedBox(height: 28),
            _OrderIdentityCard(order: order, thai: thai),
            if (showInlineActions) ...[
              const SizedBox(height: 20),
              FilledButton(
                onPressed: onRefresh,
                child: Text(t('ดูสถานะออเดอร์', 'Check order status')),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: onSupport,
                child: Text(t('ติดต่อช่วยเหลือ', 'Contact support')),
              ),
            ],
          ] else ...[
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Container(
                constraints: const BoxConstraints(minWidth: 142, minHeight: 30),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 5,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xffefe6f8),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Text(
                  '${t('ออเดอร์', 'Order')} #${order.id.substring(0, 8)}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Color(0xff64188a),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            if (estimate != null) ...[
              const SizedBox(height: 4),
              Text(
                t(
                  'เวลาเตรียมโดยประมาณ ${estimate.minutes} นาที',
                  'Estimated preparation: ${estimate.minutes} minutes',
                ),
                style: Theme.of(context).textTheme.bodyMedium
                    ?.copyWith(color: const Color(0xff7b7088)),
              ),
            ] else ...[
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: Theme.of(context).textTheme.bodyMedium
                    ?.copyWith(color: const Color(0xff7b7088)),
              ),
            ],
            const SizedBox(height: 44),
            _PhaseStep(
              active: true,
              title: t('ร้านรับออเดอร์แล้ว', 'Order accepted'),
              detail: t(
                'ยืนยันรายการโดยร้านแล้ว',
                'The merchant confirmed the order.',
              ),
            ),
            _PhaseStep(
              active: preparing,
              title: t('กำลังทำอาหาร', 'Preparing food'),
              detail: preparing
                  ? t(
                      'ร้านเริ่มเตรียมรายการแล้ว',
                      'The merchant has started preparation.',
                    )
                  : t(
                      'รอให้ร้านเริ่มเตรียมรายการ',
                      'Waiting for the merchant to begin preparation.',
                    ),
            ),
            if (order.delivery != null)
              _PhaseStep(
                active: false,
                title: t('รับอาหารโดยไรเดอร์', 'Rider pickup'),
                detail: t(
                  'จะแสดงเมื่อเซิร์ฟเวอร์ยืนยันการรับอาหาร',
                  'Shown when the server confirms collection.',
                ),
              ),
            if (order.delivery != null)
              _PhaseStep(
                active: false,
                last: true,
                title: t('ส่งถึงคุณ', 'Delivered to you'),
                detail: t(
                  'จะแสดงเมื่อเซิร์ฟเวอร์ยืนยันการส่งมอบ',
                  'Shown when the server confirms delivery.',
                ),
              )
            else
              _PhaseStep(
                active: false,
                last: true,
                title: t('พร้อมรับที่ร้าน', 'Ready for collection'),
                detail: t(
                  'จะแสดงเมื่อครัวยืนยันว่าพร้อมรับ',
                  'Shown when the kitchen confirms collection is ready.',
                ),
              ),
            if (order.delivery != null && showInlineActions) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: onTrack,
                icon: const Icon(Icons.delivery_dining),
                label: Text(t('ติดตามการจัดส่ง', 'Track delivery')),
              ),
            ],
          ],
          if (!pending && order.status != 'PAID')
            Text(
              '${t('การชำระ', 'Payment')}: ${foodStateLabel(order.status, thai)}',
              style: TextStyle(color: colors.onSurfaceVariant),
            ),
        ],
      ),
    );
  }
}

class _OrderIdentityCard extends StatelessWidget {
  const _OrderIdentityCard({required this.order, required this.thai});

  final MobileFoodOrder order;
  final bool thai;

  @override
  Widget build(BuildContext context) => Card(
    child: SizedBox(
      height: 82,
      child: ListTile(
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: const Color(0xffefe6f8),
            borderRadius: BorderRadius.circular(13),
          ),
          child: const Icon(
            Icons.receipt_long_outlined,
            color: Color(0xff64188a),
          ),
        ),
        title: Text(
          '${thai ? 'ออเดอร์' : 'Order'} #${order.id.substring(0, 8)}',
        ),
        subtitle: Text(
          formatMinorUnits(
            order.total.amountMinor,
            order.total.decimals,
            order.total.currency,
          ),
        ),
      ),
    ),
  );
}

class _PhaseStep extends StatelessWidget {
  const _PhaseStep({
    required this.active,
    required this.title,
    required this.detail,
    this.last = false,
  });

  final bool active;
  final bool last;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    const activeColor = Color(0xff64188a);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 42,
            child: Column(
              children: [
                Container(
                  width: 21,
                  height: 21,
                  decoration: BoxDecoration(
                    color: active ? activeColor : const Color(0xffe9e1f1),
                    shape: BoxShape.circle,
                  ),
                  child: active
                      ? const Icon(Icons.check, size: 14, color: Colors.white)
                      : null,
                ),
                if (!last)
                  Expanded(
                    child: Container(width: 2, color: const Color(0xffe9e1f1)),
                  ),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 2),
                  Text(
                    detail,
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: const Color(0xff7b7088)),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
