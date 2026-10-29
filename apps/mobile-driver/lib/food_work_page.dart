import 'package:mobile_shared/food_chat_page.dart';

import 'presentation/driver_work_map_card.dart';
import 'presentation/driver_food_offer_card.dart';
import 'presentation/driver_job_details_card.dart';
import 'presentation/driver_assigned_navigation_card.dart';
import 'presentation/driver_food_custody_card.dart';

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';

import 'food_location_controller.dart';

import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/bitpos_theme.dart' show formatMinorUnits;

import 'presentation/driver_presentation.dart';

import 'package:mobile_shared/owned_route.dart';
import 'package:mobile_shared/food_navigation_map.dart';

import 'food_idle_location_controller.dart';
import 'food_idle_discovery_panel.dart';
import 'earnings_page.dart';

class FoodWorkPage extends StatefulWidget {
  const FoodWorkPage({
    super.key,
    required this.api,
    required this.thai,
    this.availability,
    this.dailySummary,
    this.onTravelModeChanged,
  });
  final Widget? availability, dailySummary;
  final MobileApi api;
  final bool thai;
  final ValueChanged<bool>? onTravelModeChanged;
  @override
  State<FoodWorkPage> createState() => _FoodWorkPageState();
}

enum _AssignedPresentationMode { journey, details }

class _FoodWorkPageState extends State<FoodWorkPage>
    with WidgetsBindingObserver {
  bool _reportedTravelMode = false;
  _AssignedPresentationMode _assignedPresentationMode =
      _AssignedPresentationMode.journey;
  (String, String, String, String)? _detailsIdentity;
  FoodDriverWork? _work;
  FoodDispatchMutation? _pending;
  FoodProofConfirmed? _lastDelivery;
  Object? _lastDeliveryOwner, _receiptSession;
  int _receiptEpoch = 0;
  StreamSubscription<({String accountId, String sessionId})?>? _receiptSessions;

  void _receiptOwnerChanged(({String accountId, String sessionId})? next) {
    if (next == _receiptSession) return;
    _receiptSession = next;
    _receiptEpoch++;
    removeOwnedRoute(_receiptEarningsRoute);
    if (mounted) {
      setState(() {
        _assignedPresentationMode = _AssignedPresentationMode.journey;
        _detailsIdentity = null;
        _lastDelivery = null;
        _lastDeliveryOwner = null;
      });
    }
  }
  Object? _error;
  bool _busy = false, _foreground = true;
  DateTime? _loadedAt;
  FoodRecoveryReceipt? _lastRecovery;
  FoodIncidentReceipt? _lastIncident;
  void _idleStatusChanged() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() {});
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  final _offersHeading = GlobalKey();
  final _workScroll = ScrollController();
  bool _revealingOffers = false;
  void _resetAssignedPresentationScroll(
    _AssignedPresentationMode mode,
    (String, String, String, String) identity,
  ) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted ||
          _assignedPresentationMode != mode ||
          _detailsIdentity != identity ||
          !_workScroll.hasClients) {
        return;
      }
      _workScroll.jumpTo(_workScroll.position.minScrollExtent);
    });
  }

  Future<void> _viewOffers() async {
    if (_revealingOffers || !_workScroll.hasClients) return;
    _revealingOffers = true;
    final owner = widget.api.sessionScope;
    try {
      for (
        var pass = 0;
        pass < 12 &&
            mounted &&
            _foreground &&
            _work != null &&
            _work!.assignment == null &&
            owner == widget.api.sessionScope;
        pass++
      ) {
        final target = _offersHeading.currentContext;
        if (target != null && target.mounted) {
          await Scrollable.ensureVisible(
            target,
            duration: const Duration(milliseconds: 200),
            alignment: 0.1,
          );
          return;
        }
        final position = _workScroll.position;
        final next = (position.pixels + position.viewportDimension * .8).clamp(
          position.minScrollExtent,
          position.maxScrollExtent,
        );
        if (next == position.pixels) return;
        await _workScroll.animateTo(
          next,
          duration: const Duration(milliseconds: 120),
          curve: Curves.easeOut,
        );
      }
    } finally {
      _revealingOffers = false;
    }
  }

  MaterialPageRoute<void>? _chatRoute;
  (String, String, String)? _chatFence;
  void _closeChat() {
    final route = _chatRoute;
    _chatRoute = null;
    _chatFence = null;
    removeOwnedRoute(route);
  }

  Future<void> _openChat(FoodDriverAssignment a) async {
    if (_chatRoute != null || _busy || !_foreground) return;
    final route = MaterialPageRoute<void>(
      builder: (chatContext) => FoodChatPageView(
        api: widget.api,
        assignmentId: a.id,
        thai: widget.thai,
        rider: true,
      ),
    );
    _chatRoute = route;
    _chatFence = (a.id, a.generation, a.leaseGeneration);
    try {
      await Navigator.of(context).push(route);
    } finally {
      if (identical(_chatRoute, route)) {
        _chatRoute = null;
        _chatFence = null;
      }
    }
  }

  DialogRoute<(String, String)>? _incidentRoute;
  DialogRoute<void>? _incidentHistoryRoute;
  void _closeIncident() {
    _closeChat();
    final route = _incidentRoute, history = _incidentHistoryRoute;
    _incidentRoute = null;
    _incidentHistoryRoute = null;
    removeOwnedRoute(route);
    removeOwnedRoute(history);
  }

  StreamSubscription<FoodRealtimeState<FoodDriverRealtimeSnapshot>>?
  _subscription;
  int _watchEpoch = 0, _snapshotVersion = 0;
  String _navigationRevision = 'none';
  (String, String, String)? _locationFence;
  (String, String, String)? _deniedFence;
  (String, String, String)? _incidentPendingFence;
  bool _journalReady = false;
  void _holdIncident(FoodIncidentMutation command) {
    final fence = (
      command.targetId,
      command.command.generation,
      command.command.leaseGeneration,
    );
    _incidentPendingFence = fence;
    final current = switch (_work?.assignment) {
      FoodDriverAssignment a => (a.id, a.generation, a.leaseGeneration),
      FoodDriverRestrictedAssignment a => (
        a.id,
        a.generation,
        a.leaseGeneration,
      ),
      null => null,
    };
    if (current != null && current != fence) return;
    _custodyUnconfirmed = true;
    _locationFence = null;
    _navigationRevision = 'none';
    _closeCustody();
    _retireDetails();
    setState(() => _work = null);
    unawaited(_location.stop());
    unawaited(_idleLocation.stop());
  }

  (String, String, String)? _withdrawalConflictFence;
  bool _custodyUnconfirmed = false;
  DialogRoute<String>? _custodyRoute;
  (String, String, String, String)? _custodyIdentity;
  void _closeCustody() {
    final route = _custodyRoute;
    _custodyRoute = null;
    _custodyIdentity = null;
    removeOwnedRoute(route);
  }
  void _retireDetails() {
    _assignedPresentationMode = _AssignedPresentationMode.journey;
    _detailsIdentity = null;
  }


  late final FoodLocationController _location;
  late final FoodIdleLocationController _idleLocation;
  void _locationChanged() {
    if (!mounted) return;
    final code = _location.error;
    if (foodDriverAuthorityDenials.contains(code) && _denyAuthority(code!)) {
      unawaited(_recoverAuthority());
      return;
    }
    setState(() {});
  }

  bool _denyAuthority(String code) {
    final a = _work?.assignment;
    if (a is! FoodDriverAssignment) return false;
    _snapshotVersion++;
    _deniedFence = (a.id, a.generation, a.leaseGeneration);
    _custodyUnconfirmed = true;
    _locationFence = null;
    _navigationRevision = 'none';
    _closeCustody();
    _retireDetails();
    final reason = code == 'DRIVER_UNAVAILABLE'
        ? 'FOOD_SERVICE_UNAVAILABLE'
        : code;
    setState(
      () => _work = FoodDriverWork(
        offers: [],
        assignment: FoodDriverRestrictedAssignment(
          access: 'RESTRICTED',
          id: a.id,
          shipmentId: a.shipmentId,
          generation: a.generation,
          leaseGeneration: a.leaseGeneration,
          shipmentVersion: a.shipmentVersion,
          custodyPhase: ['ACCEPTED', 'AT_PICKUP'].contains(a.state)
              ? 'PREPICKUP'
              : 'PICKED_UP',
          reason: reason,
        ),
      ),
    );
    if (_location.sharing) unawaited(_location.stop(preserveError: true));
    unawaited(_idleLocation.stop());
    return true;
  }

  Future<void> _recoverAuthority() async {
    try {
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    _location = FoodLocationController(widget.api)
      ..addListener(_locationChanged);
    _idleLocation = FoodIdleLocationController(widget.api)
      ..addListener(_idleStatusChanged);
    WidgetsBinding.instance.addObserver(this);
    _receiptSession = widget.api.sessionScope;
    _receiptSessions = widget.api.sessionScopes.listen(_receiptOwnerChanged);
    _startWatch();
    unawaited(_run(_load));
  }

  void _stopWatch() {
    _watchEpoch++;
    _snapshotVersion++;
    unawaited(_subscription?.cancel());
    _subscription = null;
  }

  void _startWatch() {
    _stopWatch();
    if (!mounted || !_foreground) return;
    final epoch = _watchEpoch;
    _subscription = widget.api.watchFoodWork().listen((state) {
      if (!mounted || !_foreground || epoch != _watchEpoch || !_journalReady)
        return;
      final revision = ++_snapshotVersion, snapshot = state.snapshot;
      if (snapshot == null) {
        _closeCustody();
        _closeIncident();
        _retireDetails();
        setState(() {
          _work = null;
          _loadedAt = null;
          _error = state.error;
        });
        if (state is FoodRealtimeDisconnected) {
          _locationFence = null;
          unawaited(_location.stop());
          unawaited(_idleLocation.stop());
        }
        return;
      }
      _navigationRevision = snapshot.location?.sequence ?? 'none';
      unawaited(_adopt(snapshot.work, revision));
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) {
      _startWatch();
      unawaited(_location.refreshPermissions());
      if (!_busy) unawaited(_run(_load));
    } else {
      _stopWatch();
      _closeCustody();
      _closeIncident();
      _retireDetails();
      unawaited(_idleLocation.stop());
      if (mounted)
        setState(() {
          _work = null;
          _loadedAt = null;
        });
    }
  }

  Future<void> _adopt(
    FoodDriverWork work,
    int revision, {
    bool confirmedRecovery = false,
  }) async {
    if (!mounted || !_foreground || revision != _snapshotVersion) return;
    final released = _lastRecovery;
    if (released != null &&
        switch (work.assignment) {
          FoodDriverAssignment a =>
            a.id == released.assignmentId &&
                a.generation == released.generation &&
                a.leaseGeneration == released.leaseGeneration,
          FoodDriverRestrictedAssignment a =>
            a.id == released.assignmentId &&
                a.generation == released.generation &&
                a.leaseGeneration == released.leaseGeneration,
          null => false,
        })
      return;
    final dutyFence = switch (work.assignment) {
      FoodDriverAssignment a => (a.id, a.generation, a.leaseGeneration),
      FoodDriverRestrictedAssignment a => (
        a.id,
        a.generation,
        a.leaseGeneration,
      ),
      null => null,
    };
    if (dutyFence != null &&
        dutyFence == _incidentPendingFence &&
        (!confirmedRecovery || work.assignment is FoodDriverAssignment))
      return;
    if (dutyFence != null &&
        dutyFence == _withdrawalConflictFence &&
        !confirmedRecovery) {
      unawaited(_recoverAuthority());
      return;
    }
    if (confirmedRecovery) _withdrawalConflictFence = null;
    final duty = work.assignment,
        a = duty is FoodDriverAssignment ? duty : null,
        fence = a == null ? null : (a.id, a.generation, a.leaseGeneration);
    if (a != null && fence == _deniedFence && !confirmedRecovery) {
      unawaited(_recoverAuthority());
      return;
    }
    if (_chatFence != null && _chatFence != fence) _closeChat();
    final identity = _custodyIdentity;
    if (identity != null &&
        (a == null ||
            (a.id, a.generation, a.leaseGeneration) !=
                (identity.$1, identity.$2, identity.$3) ||
            !a.proofs.any((proof) => proof.id == identity.$4)))
      _closeCustody();
    final stopLocation = fence != _locationFence;
    _locationFence = fence;
    _custodyUnconfirmed = false;
    if (duty == null || a != null && confirmedRecovery) _deniedFence = null;
    // Private presentation retires before native cancellation can suspend or fail.
    final detailsIdentity = a == null
        ? null
        : (a.id, a.generation, a.leaseGeneration, a.state);
    setState(() {
      if (_detailsIdentity != detailsIdentity) {
        _assignedPresentationMode = _AssignedPresentationMode.journey;
        _detailsIdentity = null;
      }
      _work = work;
      _error = null;
      _loadedAt = DateTime.now();
      if (a != null) _lastDelivery = null;
    });
    await Future.wait<void>([
      if (duty != null) _idleLocation.stop(),
      if (stopLocation) _location.stop(),
    ]);
    if (!mounted || !_foreground || revision != _snapshotVersion) return;
    if (_idleLocation.error == 'LOCATION_STOP_UNCONFIRMED') setState(() {});
    if (a != null) await _location.refreshPermissions();
  }

  Future<void> _load() async {
    final revision = _snapshotVersion;
    try {
      final pending = await widget.api.pendingFoodDispatch();
      if (!mounted || !_foreground) return;
      setState(() {
        _pending = pending;
        _journalReady = true;
      });
      if (pending is FoodIncidentMutation) {
        _holdIncident(pending);
      } else {
        _incidentPendingFence = null;
      }
      final work = await widget.api.foodDriverWork();
      if (!mounted || !_foreground) return;
      if (pending != null) _retireDetails();
      if (revision == _snapshotVersion)
        await _adopt(work, revision, confirmedRecovery: true);
    } catch (error) {
      if (!mounted) return;
      if (revision != _snapshotVersion &&
          !(error is MobileApiException &&
              error.code == 'AUTH_REQUIRED' &&
              !widget.api.signedIn))
        return;
      rethrow;
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (error is MobileApiException &&
          foodDriverAuthorityDenials.contains(error.code)) {
        _denyAuthority(error.code);
        await _recoverAuthority();
      } else if (error is MobileApiException &&
          [
            'AUTH_REQUIRED',
            'SESSION_EXPIRED',
            'SESSION_CHANGED',
            'RESOURCE_NOT_FOUND',
            'ASSIGNMENT_CHANGED',
          ].contains(error.code)) {
        _snapshotVersion++;
        _locationFence = null;
        _deniedFence = null;
        _closeCustody();
        _closeIncident();
        _retireDetails();
        if (mounted)
          setState(() {
            _work = null;
            _lastDelivery = null;
            _lastIncident = null;
          });
        await Future.wait<void>([_location.stop(), _idleLocation.stop()]);
      }
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit(FoodDispatchMutation command) async {
    final receiptOwner = widget.api.sessionScope;
    final receiptEpoch = _receiptEpoch;
    if (command is FoodWithdrawMutation) {
      _closeCustody();
      unawaited(_location.stop());
    }
    if (command is FoodIncidentMutation) {
      _snapshotVersion++;
      _holdIncident(command);
    } else {
      await _idleLocation.stop();
    }
    if (!mounted) return;
    _retireDetails();
    setState(() => _pending = command);
    try {
      final result = await widget.api.submitFoodDispatch(command);
      if (result is FoodRecoveryReceipt) {
        _snapshotVersion++;
        _closeCustody();
        _retireDetails();
        if (mounted)
          setState(() {
            _lastRecovery = result;
            _work = null;
            _locationFence = null;
          });
      }
      if (result is FoodIncidentReceipt) {
        _snapshotVersion++;
        _closeCustody();
        if (result.paused) {
          final incident = result.incident;
          _deniedFence = (
            incident.assignmentId,
            incident.generation,
            incident.leaseGeneration,
          );
          _custodyUnconfirmed = true;
          _locationFence = null;
          unawaited(_location.stop());
          _retireDetails();
        }
        if (mounted)
          setState(() {
            _lastIncident = result;
            if (result.paused) _work = null;
          });
      }
      if (result is FoodProofRejected)
        throw MobileApiException(
          'PROOF_INVALID_${result.receipt.attemptsRemaining}',
          422,
        );
      if (result is FoodProofAccepted && result.receipt.kind == 'DELIVERY') {
        try {
          await _location.stop();
        } finally {
          if (mounted &&
              receiptOwner != null &&
              widget.api.signedIn &&
              widget.api.sessionScope == receiptOwner &&
              _receiptEpoch == receiptEpoch) {
            _retireDetails();
            setState(() {
              _lastDelivery = result.receipt;
              _lastDeliveryOwner = receiptOwner;
              _work = null;
            });
          }
        }
      }
    } on MobileApiException catch (error) {
      if (command is FoodWithdrawMutation &&
          ['VERSION_CONFLICT', 'CUSTODY_RETAINED'].contains(error.code)) {
        _snapshotVersion++;
        _withdrawalConflictFence = (
          command.targetId,
          command.command.generation,
          command.command.leaseGeneration,
        );
        _custodyUnconfirmed = true;
        _locationFence = null;
        _navigationRevision = 'none';
        _closeCustody();
        _retireDetails();
        if (mounted) setState(() => _work = null);
        await Future.wait<void>([_location.stop(), _idleLocation.stop()]);
        await _recoverAuthority();
      }
      rethrow;
    } finally {
      if (widget.api.signedIn) {
        final pending = await widget.api.pendingFoodDispatch();
        if (mounted) {
          setState(() => _pending = pending);
          if (pending is FoodIncidentMutation) {
            _holdIncident(pending);
          } else {
            _incidentPendingFence = null;
          }
        }
      }
    }
    await _load();
  }

  Future<void> _report(
    FoodDriverDuty duty, {
    bool deliveryIssue = false,
  }) async {
    if (!mounted || !_foreground || _incidentRoute != null) return;
    final owner = widget.api.sessionScope;
    if (owner == null) throw const MobileApiException('AUTH_REQUIRED', 401);
    final route = DialogRoute<(String, String)>(
      context: context,
      builder: (_) => _IncidentReportDialog(
        thai: widget.thai,
        deliveryIssue: deliveryIssue,
      ),
    );
    _incidentRoute = route;
    final report = await Navigator.of(context, rootNavigator: true).push(route);
    if (identical(_incidentRoute, route)) _incidentRoute = null;
    if (!mounted ||
        !_foreground ||
        report == null ||
        owner != widget.api.sessionScope)
      return;
    await _submit(
      widget.api.reportFoodIncidentCommand(
        duty,
        kind: report.$1,
        body: report.$2,
      ),
    );
  }

  Future<void> _incidentHistory(String assignmentId) async {
    if (!mounted || !_foreground || _incidentHistoryRoute != null) return;
    final owner = widget.api.sessionScope;
    if (owner == null) throw const MobileApiException('AUTH_REQUIRED', 401);
    final route = DialogRoute<void>(
      context: context,
      builder: (_) => _IncidentHistoryDialog(
        api: widget.api,
        assignmentId: assignmentId,
        owner: owner,
        thai: widget.thai,
      ),
    );
    _incidentHistoryRoute = route;
    await Navigator.of(context, rootNavigator: true).push(route);
    if (identical(_incidentHistoryRoute, route)) _incidentHistoryRoute = null;
  }

  Future<void> _proof(
    FoodDriverAssignment assignment,
    FoodDriverProof proof,
  ) async {
    if (!mounted || !_foreground || _custodyRoute != null) return;
    final epoch = _watchEpoch,
        identity = (
          assignment.id,
          assignment.generation,
          assignment.leaseGeneration,
          proof.id,
        );
    final route = DialogRoute<String>(
      context: context,
      builder: (context) => _CustodyProofDialog(thai: widget.thai),
    );
    _custodyRoute = route;
    _custodyIdentity = identity;
    final secret = await Navigator.of(context, rootNavigator: true).push(route);
    if (identical(_custodyRoute, route)) {
      _custodyRoute = null;
      _custodyIdentity = null;
    }
    if (!mounted ||
        !_foreground ||
        epoch != _watchEpoch ||
        secret == null ||
        secret.isEmpty)
      return;
    final current = _work?.assignment;
    if (current is! FoodDriverAssignment ||
        (current.id, current.generation, current.leaseGeneration) !=
            (identity.$1, identity.$2, identity.$3))
      return;
    final matches = current.proofs.where(
      (value) =>
          value.id == proof.id &&
          value.kind == proof.kind &&
          DateTime.parse(value.expiresAt).isAfter(DateTime.now()),
    );
    if (matches.isEmpty || !['AT_PICKUP', 'AT_DROPOFF'].contains(current.state))
      return;
    await _submit(
      widget.api.consumeFoodCommand(current, matches.first, secret),
    );
  }

  String _state(String state) => switch (state) {
    'ACCEPTED' => t('รับงานแล้ว — เดินทางไปร้าน', 'Assigned — travel to store'),
    'AT_PICKUP' => t(
      'ถึงร้าน — รอหลักฐานรับอาหาร',
      'At store — pickup proof required',
    ),
    'PICKED_UP' => t(
      'รับอาหารแล้ว — ไปส่งลูกค้า',
      'Food collected — travel to customer',
    ),
    'AT_DROPOFF' => t(
      'ถึงปลายทาง — รอหลักฐานลูกค้า',
      'At destination — customer proof required',
    ),
    'INCIDENT' => t(
      'เหตุขัดข้อง — ติดต่อฝ่ายช่วยเหลือ',
      'Incident — contact support',
    ),
    _ => state,
  };
  String _restrictionReason(String reason) => switch (reason) {
    'DRIVER_SUSPENDED' => t(
      'บัญชีผู้ขับถูกระงับสิทธิ์บริการ',
      'Driver service is suspended',
    ),
    'DRIVER_VERIFICATION_REQUIRED' => t(
      'ต้องตรวจสอบคุณสมบัติผู้ขับใหม่',
      'Driver verification required',
    ),
    'DRIVER_DOCUMENT_EXPIRED' => t(
      'เอกสารผู้ขับหรือยานพาหนะหมดอายุ',
      'Driver or vehicle documents expired',
    ),
    'FOOD_SERVICE_UNAVAILABLE' => t(
      'สิทธิ์ให้บริการอาหารของสาขาไม่พร้อมใช้',
      'Branch food-service authority unavailable',
    ),
    'INCIDENT' => t(
      'งานมีเหตุขัดข้องที่ยังไม่คลี่คลาย',
      'Unresolved job incident',
    ),
    _ => reason,
  };
  Widget _panel(Widget child, {bool tinted = false}) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: tinted
          ? Theme.of(context).colorScheme.primaryContainer
          : Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusCard),
    ),
    child: child,
  );
  Widget _label(String text) => Text(
    text,
    style: Theme.of(context).textTheme.bodySmall
        ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
  );
  Widget _routePanel() => Container(
    width: double.infinity,
    constraints: const BoxConstraints(minHeight: 180),
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(22),
    ),
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          Icons.map_outlined,
          size: 40,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
        const SizedBox(height: 12),
        Text(
          t('แผนที่และเส้นทางยังไม่พร้อมใช้งาน', 'Map and routing unavailable'),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        _label(
          t(
            'ไม่มีเส้นทางสด ระยะทาง หรือเวลาถึงโดยประมาณ',
            'No live route, distance or arrival estimate',
          ),
        ),
      ],
    ),
  );

  MaterialPageRoute<void>? _receiptEarningsRoute;

  Future<void> _openReceiptEarnings(
    FoodProofConfirmed receipt,
    Object owner,
  ) async {
    if (!mounted ||
        !_foreground ||
        _busy ||
        _pending != null ||
        _receiptEarningsRoute != null ||
        !identical(_lastDelivery, receipt) ||
        !widget.api.signedIn ||
        widget.api.sessionScope != owner ||
        ModalRoute.of(context)?.isCurrent != true) {
      return;
    }
    // Work also opens from a void push route, not only driver-destination.
    final route = MaterialPageRoute<void>(
      builder: (_) => DriverEarningsPage(api: widget.api, thai: widget.thai),
    );
    _receiptEarningsRoute = route;
    final changes = widget.api.sessionScopes.listen((next) {
      if (next != owner) removeOwnedRoute(route);
    });
    try {
      await Navigator.of(context).push(route);
    } finally {
      if (identical(_receiptEarningsRoute, route)) {
        _receiptEarningsRoute = null;
      }
      await changes.cancel();
    }
  }

  void _returnToWork() {
    setState(() {
      _lastDelivery = null;
      _lastDeliveryOwner = null;
    });
    unawaited(_run(_load));
  }

  Widget _deliveryReceipt(FoodProofConfirmed receipt, {required bool frozen}) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final dark = theme.brightness == Brightness.dark;
    final owner = _lastDeliveryOwner;
    final confirmed = DateTime.parse(receipt.consumedAt).toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    final muted = dark ? colors.onSurfaceVariant : BitPosDesignTokens.muted;
    final primary = dark ? colors.primary : BitPosDesignTokens.primary;
    final surface = dark ? colors.surfaceContainer : Colors.white;
    final outline = dark ? colors.outlineVariant : BitPosDesignTokens.line;
    final cardShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(18),
      side: BorderSide(color: outline),
    );
    return Column(
      key: const ValueKey('food-delivery-confirmed'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 48),
        Center(
          child: ExcludeSemantics(
            child: Container(
              key: const ValueKey('food-delivery-success-badge'),
              width: 108,
              height: 108,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: dark
                    ? colors.tertiaryContainer
                    : BitPosDesignTokens.greenbg,
              ),
              child: Icon(
                Icons.check,
                size: 48,
                color: dark
                    ? colors.onTertiaryContainer
                    : BitPosDesignTokens.green,
              ),
            ),
          ),
        ),
        const SizedBox(height: 32),
        Semantics(
          header: true,
          liveRegion: true,
          child: Text(
            t('งานนี้ส่งสำเร็จแล้ว', 'Delivery confirmed'),
            textAlign: TextAlign.center,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontSize: 24,
              height: 1.65,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(height: 32),
        Card(
          key: const ValueKey('food-delivery-confirmation-time'),
          margin: EdgeInsets.zero,
          elevation: 0,
          color: surface,
          shape: cardShape,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 110),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    t('ยืนยันส่งมอบเมื่อ (เวลาท้องถิ่น)', 'Delivery confirmed at (local time)'),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 13,
                      height: 1.3,
                      color: muted,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${two(confirmed.hour)}:${two(confirmed.minute)}',
                    style: TextStyle(
                      fontSize: 30,
                      height: 1.3,
                      fontWeight: FontWeight.w600,
                      color: primary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${two(confirmed.day)}/${two(confirmed.month)}/${confirmed.year} · ${t('งานส่ง', 'Delivery')} #${receipt.assignmentId.substring(0, 8)}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      height: 1.5,
                      color: muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 28),
        Card(
          key: const ValueKey('food-delivery-obligation-status'),
          margin: EdgeInsets.zero,
          elevation: 0,
          color: surface,
          shape: cardShape,
          child: InkWell(
            key: const ValueKey('food-delivery-view-earnings'),
            borderRadius: BorderRadius.circular(18),
            onTap: frozen || !_foreground || owner == null
                ? null
                : () => _openReceiptEarnings(receipt, owner),
            child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 82),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ExcludeSemantics(
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: dark
                            ? colors.primaryContainer
                            : BitPosDesignTokens.tint,
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: Icon(
                        Icons.account_balance_wallet_outlined,
                        size: 22,
                        color: dark ? colors.onPrimaryContainer : primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          receipt.accrualId != null
                              ? t(
                                  'บันทึกภาระรายได้แล้ว',
                                  'Earning obligation recorded',
                                )
                              : t(
                                  'ยืนยันหลักฐานส่งมอบแล้ว',
                                  'Delivery proof confirmed',
                                ),
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontSize: 15,
                            height: 1.65,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          receipt.accrualId != null
                              ? t(
                                  'ยังไม่ใช่การจ่ายเงิน ตรวจรายละเอียดในหน้ารายได้',
                                  'Not paid out. Check details in Earnings.',
                                )
                              : t(
                                  'หลักฐานนี้ยังไม่ยืนยันภาระรายได้ และไม่ใช่หลักฐานการจ่ายเงิน ตรวจสถานะในหน้ารายได้',
                                  'This receipt does not confirm an earning obligation or a payout. Check Earnings for status.',
                                ),
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 12,
                            height: 1.65,
                            color: muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          ),
        ),
        const SizedBox(height: 77),
        FilledButton(
          key: const ValueKey('food-delivery-next-job'),
          style: FilledButton.styleFrom(
            minimumSize: const Size(48, 52),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
          onPressed: frozen || !_foreground || owner == null
              ? null
              : _returnToWork,
          child: Text(
            t('พร้อมรับงานถัดไป', 'Ready for next job'),
            textAlign: TextAlign.center,
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final work = _work,
        duty = work?.assignment,
        a = duty is FoodDriverAssignment ? duty : null,
        restricted = duty is FoodDriverRestrictedAssignment ? duty : null,
        frozen = _busy || _pending != null;
    final hasTravelAssignment =
        a != null && (a.state == 'ACCEPTED' || a.state == 'PICKED_UP');
    final showingDetails =
        hasTravelAssignment &&
        !frozen &&
        _assignedPresentationMode == _AssignedPresentationMode.details &&
        _detailsIdentity ==
            (a.id, a.generation, a.leaseGeneration, a.state);
    final navigating = hasTravelAssignment && !showingDetails;
    if (_reportedTravelMode != navigating) {
      _reportedTravelMode = navigating;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _reportedTravelMode == navigating) widget.onTravelModeChanged?.call(navigating);
      });
    }
    final error =
        _location.error == 'LOCATION_STOP_UNCONFIRMED' ||
            _idleLocation.error == 'LOCATION_STOP_UNCONFIRMED'
        ? const MobileApiException('LOCATION_STOP_UNCONFIRMED', 409)
        : _error;
    final receipt = _lastDelivery;
    if (receipt != null && duty == null && !frozen) {
      return DriverPresentation(
        child: Scaffold(
          body: SafeArea(
            child: ListView(
              key: const ValueKey('food-delivery-completion-page'),
              controller: _workScroll,
              padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
              children: [
                Transform.translate(
                  offset: const Offset(-6, 0),
                  child: Row(
                  children: [
                    IconButton.outlined(
                      key: const ValueKey('food-delivery-return-to-work'),
                      tooltip: t('กลับไปรับงาน', 'Back to work'),
                      onPressed: _returnToWork,
                      style: IconButton.styleFrom(
                        backgroundColor: Theme.of(context).colorScheme.surface,
                        foregroundColor: Theme.of(context).colorScheme.primary,
                        side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                      icon: const Icon(Icons.chevron_left),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        t('ส่งสำเร็จ ขอบคุณครับ', 'Delivery complete, thank you'),
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                ),
                const SizedBox(height: 12),
                _deliveryReceipt(receipt, frozen: false),
                if (error != null) ...[
                  const SizedBox(height: 16),
                  Semantics(
                    liveRegion: true,
                    child: _panel(Text(
                      error.toString(),
                      style: TextStyle(color: Theme.of(context).colorScheme.error),
                    )),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }
    final heading = restricted != null
        ? t('งานถูกระงับ — ยังมีหน้าที่ดูแล', 'Job restricted — duty retained')
        : showingDetails
        ? t('รายละเอียดงาน', 'Job details')
        : a == null
        ? t('พร้อมรับงานวันนี้', 'Ready for work today')
        : switch (a.state) {
            'ACCEPTED' => t('เดินทางไปรับอาหาร', 'Travel to food pickup'),
            'AT_PICKUP' => t('ยืนยันรับอาหาร', 'Confirm pickup'),
            'PICKED_UP' => t('กำลังนำส่งอาหาร', 'Delivering food'),
            'AT_DROPOFF' => t('ยืนยันส่งอาหาร', 'Confirm delivery'),
            _ => t('รายละเอียดงาน', 'Job details'),
          };
    return DriverPresentation(
      child: Scaffold(
        body: SafeArea(
          child: ListView(
            controller: _workScroll,
            padding: EdgeInsets.fromLTRB(
              navigating ? 0 : BitPosDesignTokens.mobileMargin,
              8,
              navigating ? 0 : BitPosDesignTokens.mobileMargin,
              BitPosDesignTokens.mobileMargin,
            ),
            children: [
              if (duty == null) ...[
                Align(
                  alignment: Alignment.centerLeft,
                  child: Image.asset(
                    'assets/design/bitpos-logo.png',
                    width: 104,
                    height: 104 / 3,
                    semanticLabel: 'BitPOS',
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Theme.of(context).colorScheme.onSurface
                        : null,
                  ),
                ),
                const SizedBox(height: 10),
              ],
              Padding(
                padding: EdgeInsets.symmetric(horizontal: navigating ? 18 : 0),
                child: Row(
                children: [
                  if (Navigator.of(context).canPop()) ...[
                    IconButton.filledTonal(
                      tooltip: t('กลับ', 'Back'),
                      onPressed: () => Navigator.of(context).maybePop(),
                      icon: const Icon(Icons.arrow_back),
                      constraints: const BoxConstraints(
                        minWidth: 48,
                        minHeight: 48,
                      ),
                    ),
                    SizedBox(width: navigating ? 10 : 12),
                  ],
                  Expanded(
                    child: Text(
                      heading,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(
                            fontSize: 20,
                            fontWeight: FontWeight.w600,
                            height: 1.65,
                          ),
                    ),
                  ),
                  IconButton(
                    tooltip: t('โหลดใหม่', 'Refresh'),
                    onPressed: _busy ? null : () => _run(_load),
                    icon: const Icon(Icons.refresh),
                    constraints: const BoxConstraints(
                      minWidth: 48,
                      minHeight: 48,
                    ),
                  ),
                ],
              ),
              ),
              SizedBox(height: navigating ? 12 : duty == null ? 8 : 24),
              if (!navigating && !showingDetails && widget.availability != null) ...[
                widget.availability!,
                const SizedBox(height: 18),
              ],
              if (work != null && duty == null) ...[
                DriverWorkMapCard(
                  thai: widget.thai,
                  offerCount: work.offers.length,
                  sharing: _idleLocation.sharing,
                  stopUnconfirmed:
                      _idleLocation.error == 'LOCATION_STOP_UNCONFIRMED',
                ),
                const SizedBox(height: 22),
              ],
              if (!navigating && !showingDetails && widget.dailySummary != null) ...[
                widget.dailySummary!,
                const SizedBox(height: 28),
              ],
              if (work != null && duty == null) ...[
                FilledButton(
                  onPressed: frozen ? null : _viewOffers,
                  child: Text(t('ดูงานที่เสนอให้คุณ', 'View your offers')),
                ),
                const SizedBox(height: 24),
              ],
              if (widget.api.fixture && !navigating && !showingDetails) ...[
                _label(
                  t(
                    'ข้อมูลทดสอบในเครื่อง / AVD ไม่ใช่การส่งจริง',
                    'LOCAL / AVD FIXTURE — not a physical delivery',
                  ),
                ),
                const SizedBox(height: 16),
              ],
              Column(
                children: [
                  if (_busy) ...[
                    const LinearProgressIndicator(),
                    const SizedBox(height: 16),
                  ],
                ],
              ),
              if (error != null) ...[
                Semantics(
                  liveRegion: true,
                  child: _panel(
                    Text(
                      error.toString(),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              if (_pending != null) ...[
                _panel(
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        t('กู้คืนคำสั่งเดิม', 'Recover original command'),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        t(
                          'คำสั่งค้าง: ลองคำสั่งเดิมก่อนทำรายการใหม่',
                          'Pending command: recover the same command before another action',
                        ),
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _busy
                            ? null
                            : () => _run(() => _submit(_pending!)),
                        child: Text(t('ลองคำสั่งเดิม', 'Recover same command')),
                      ),
                    ],
                  ),
                  tinted: true,
                ),
                const SizedBox(height: 16),
              ],
              if (_lastIncident case final reported?) ...[
                _panel(
                  Column(
                    key: const ValueKey('food-incident-confirmed'),
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        t(
                          'เซิร์ฟเวอร์บันทึกรายงานแล้ว',
                          'Incident report recorded',
                        ),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        t(
                          'นี่ไม่ใช่การติดต่อหน่วยฉุกเฉิน การยกเลิกงาน คืนเงิน หรือโอนเงิน หากอันตรายเร่งด่วนให้ติดต่อหน่วยฉุกเฉินในพื้นที่โดยตรง',
                          'This does not contact emergency services, cancel the order, refund or transfer money. For immediate danger, contact local emergency services directly.',
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        reported.paused
                            ? t(
                                'ขณะบันทึกรายงาน เซิร์ฟเวอร์ระงับขั้นตอนงานไว้ แต่หน้าที่ดูแลอาหารยังคงอยู่ การรับทราบของเจ้าหน้าที่ไม่ใช่การอนุญาตให้ทำงานต่อ ดูสถานะงานล่าสุดด้านล่าง',
                                'At reporting time, the server recorded paused work with food responsibility retained. Staff acknowledgement is not permission to resume. Check the latest duty status below.',
                              )
                            : t(
                                'รายงานนี้ไม่ได้ปล่อยหน้าที่ดูแลอาหารหรือยืนยันการเปลี่ยนผู้ขับ',
                                'This report does not release food responsibility or confirm a driver change.',
                              ),
                      ),
                    ],
                  ),
                  tinted: true,
                ),
                const SizedBox(height: 16),
              ],
              if (_lastRecovery != null) ...[
                _panel(
                  Column(
                    key: const ValueKey('food-withdrawal-confirmed'),
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        t(
                          'เซิร์ฟเวอร์ปล่อยงานก่อนรับอาหารแล้ว',
                          'Pre-pickup withdrawal confirmed',
                        ),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        t(
                          'รหัสรับอาหารเดิมถูกยกเลิกแล้ว ห้ามรับอาหารสำหรับงานเดิม นี่ไม่ใช่การยกเลิกออเดอร์ คืนเงิน หรือจ่ายรายได้',
                          'Old pickup proofs are revoked. Do not collect food for the released assignment. This does not cancel the order, refund payment or pay earnings.',
                        ),
                      ),
                    ],
                  ),
                  tinted: true,
                ),
                const SizedBox(height: 16),
              ],
              if (work == null && !_busy)
                _panel(
                  Text(
                    t('ยังไม่มีข้อมูลล่าสุด', 'No current snapshot available'),
                  ),
                ),
              if (a != null) ...[
                if (navigating) ...[
                  DriverAssignedNavigationCard(
                    assignment: a,
                    thai: widget.thai,
                    status: _state(a.state),
                    mapBuilder: (height, cameraBottomInset, compose) => FoodNavigationMap(
                      key: ValueKey((
                        a.id,
                        a.generation,
                        a.leaseGeneration,
                        a.state,
                      )),
                      api: widget.api,
                      assignmentId: a.id,
                      generation: a.generation,
                      leaseGeneration: a.leaseGeneration,
                      revision: _navigationRevision,
                      thai: widget.thai,
                      height: height,
                      cameraBottomInset: cameraBottomInset,
                      presentationBuilder: compose,
                    ),
                    onViewMap: frozen
                        ? null
                        : () {
                            final identity = (
                              a.id,
                              a.generation,
                              a.leaseGeneration,
                              a.state,
                            );
                            setState(() {
                              _assignedPresentationMode =
                                  _AssignedPresentationMode.details;
                              _detailsIdentity = identity;
                            });
                            _resetAssignedPresentationScroll(
                              _AssignedPresentationMode.details,
                              identity,
                            );
                          },
                    onChat: frozen ? null : () => _openChat(a),
                    onArrive: frozen
                        ? null
                        : () => _run(
                            () => _submit(
                              widget.api.arriveFoodCommand(
                                a,
                                a.state == 'ACCEPTED' ? 'PICKUP' : 'DROPOFF',
                              ),
                            ),
                          ),
                  ),
                  const SizedBox(height: 24),
                ] else if (showingDetails) ...[
                  DriverJobDetailsCard(assignment: a, thai: widget.thai),
                  const SizedBox(height: 24),
                  FilledButton(
                    key: const ValueKey('food-assigned-continue-navigation'),
                    onPressed: () {
                      final identity = _detailsIdentity;
                      setState(() {
                        _assignedPresentationMode =
                            _AssignedPresentationMode.journey;
                      });
                      if (identity != null) {
                        _resetAssignedPresentationScroll(
                          _AssignedPresentationMode.journey,
                          identity,
                        );
                      }
                    },
                    child: Text(
                      t('เดินทางต่อ', 'Continue navigation'),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 24),
                ] else ...[
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Theme.of(context).brightness == Brightness.dark
                          ? Theme.of(context).colorScheme.primaryContainer
                          : BitPosDesignTokens.tint,
                      borderRadius: BorderRadius.circular(15),
                    ),
                    child: Text(
                      a.state == 'AT_PICKUP' || a.state == 'AT_DROPOFF'
                          ? '${t('งาน', 'Job')} #${a.id.substring(0, 8)}'
                          : _state(a.state),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                if (a.state == 'AT_PICKUP' || a.state == 'AT_DROPOFF') ...[
                  DriverFoodCustodyCard(
                    assignment: a,
                    thai: widget.thai,
                    onEnterProof: frozen
                        ? null
                        : (proof) => _run(() => _proof(a, proof)),
                  ),
                  const SizedBox(height: 24),
                ],
                DriverJobDetailsCard(assignment: a, thai: widget.thai),
                const SizedBox(height: 24),
                OutlinedButton.icon(
                  onPressed: frozen ? null : () => _openChat(a),
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: Text(t('คุยกับลูกค้า', 'Chat with customer')),
                ),
                const SizedBox(height: 24),
                FoodNavigationMap(
                  key: ValueKey((
                    a.id,
                    a.generation,
                    a.leaseGeneration,
                    a.state,
                  )),
                  api: widget.api,
                  assignmentId: a.id,
                  generation: a.generation,
                  leaseGeneration: a.leaseGeneration,
                  revision: _navigationRevision,
                  thai: widget.thai,
                ),
                const SizedBox(height: 24),
                ],
                _panel(
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _label(
                        t(
                          'รายได้ตามใบเสนอราคา ไม่ใช่เงินโอนแล้ว',
                          'Quoted earning · not paid out',
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        formatMinorUnits(
                          a.earning.amountMinor,
                          a.earning.decimals,
                          a.earning.currency,
                        ),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _panel(
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.gps_fixed),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              t('GPS เฉพาะงานนี้', 'Assignment GPS'),
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _location.sharing
                            ? t(
                                'สตรีมตำแหน่งทำงาน ไม่ใช่หลักฐานว่าเซิร์ฟเวอร์ได้รับพิกัดปัจจุบัน',
                                'Native location stream active; not proof of a current server acknowledgement',
                              )
                            : t(
                                'ยังไม่แชร์ตำแหน่ง',
                                'Location sharing stopped',
                              ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _location.lastReceivedAt == null
                            ? t(
                                'ยังไม่มีพิกัดที่เซิร์ฟเวอร์รับของงานนี้',
                                'No acknowledged fix for this assignment',
                              )
                            : _location.acknowledgedFixStale
                            ? t(
                                'พิกัดที่รับเก่าแล้ว ห้ามถือว่ากำลังติดตามตำแหน่งปัจจุบัน',
                                'Acknowledged fix is stale; current tracking is unconfirmed',
                              )
                            : t(
                                'พิกัดล่าสุดได้รับภายใน 30 วินาที',
                                'Latest acknowledged fix is within 30 seconds',
                              ),
                      ),
                      if (_location.lastReceivedAt != null)
                        _label(
                          '${t('เซิร์ฟเวอร์รับล่าสุด', 'Server last received')}: ${_location.lastReceivedAt!.toLocal()}',
                        ),
                      const SizedBox(height: 12),
                      _label(
                        _location.backgroundAuthorized == null
                            ? t(
                                'ยังไม่ทราบ/กำลังตรวจสิทธิ์ตำแหน่งล่าสุด',
                                'Location permission unknown/checking',
                              )
                            : _location.backgroundAuthorized!
                            ? t(
                                'อนุญาตตำแหน่งตลอดเวลาแล้ว',
                                'Always location permission granted',
                              )
                            : t(
                                'ไม่มีสิทธิ์ตลอดเวลา Android ใช้บริการด้านหน้าได้เมื่อเริ่มจากแอพ iOS ขึ้นกับสิทธิ์และระบบ',
                                'Always not granted. Android may use a foreground service started in-app; iOS background behavior depends on OS permission.',
                              ),
                      ),
                      if (_location.serviceEnabled == false)
                        Text(
                          t(
                            'บริการตำแหน่งปิดอยู่',
                            'Location service is disabled',
                          ),
                        ),
                      if (_location.error != null)
                        Text(
                          _location.error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      const SizedBox(height: 16),
                      OutlinedButton(
                        onPressed: _busy || !_location.sharing && frozen
                            ? null
                            : () => _run(
                                () => _location.sharing
                                    ? _location.stop()
                                    : _location.start(a),
                              ),
                        child: Text(
                          _location.sharing
                              ? t('หยุดแชร์ตำแหน่ง', 'Stop sharing location')
                              : t(
                                  'อนุญาตและเริ่ม GPS ของงานนี้',
                                  'Allow and start assignment GPS',
                                ),
                        ),
                      ),
                      TextButton(
                        onPressed: () => Geolocator.openAppSettings(),
                        child: Text(
                          t(
                            'ตั้งค่าสิทธิ์ตำแหน่ง',
                            'Location permission settings',
                          ),
                        ),
                      ),
                      _label(
                        t(
                          'แชร์ตำแหน่งเฉพาะงานนี้กับผู้ร่วมงานที่ได้รับสิทธิ์',
                          'Share location only with authorized assignment participants',
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: Text(
                    t('รายละเอียดทางเทคนิคของงาน', 'Technical job details'),
                  ),
                  children: [
                    SelectableText(
                      '${t('งาน', 'Assignment')}: ${a.id}\n${t('รุ่นงาน/สิทธิ์', 'Service/lease generation')}: ${a.generation}/${a.leaseGeneration}\n${t('พิกัดร้าน', 'Store coordinates')}: ${a.pickupLatitudeE7 / 10000000}, ${a.pickupLongitudeE7 / 10000000}\n${t('พิกัดปลายทาง', 'Destination coordinates')}: ${a.latitudeE7 / 10000000}, ${a.longitudeE7 / 10000000}',
                    ),
                  ],
                ),
              ] else if (restricted != null) ...[
                _panel(
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.shield_outlined, size: 40),
                      const SizedBox(height: 16),
                      Text(
                        t(
                          'สิทธิ์ให้บริการงานนี้ถูกระงับ',
                          'Service access is restricted',
                        ),
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        t(
                          'ซ่อนข้อมูลติดต่อ ปลายทาง แผนที่ และรหัสส่งมอบแล้ว ไม่สามารถส่งพิกัดหรือทำขั้นตอนงานปกติ',
                          'Contact, destination, map and proof data are hidden. Ordinary job actions and location uploads are blocked.',
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _custodyUnconfirmed
                            ? t(
                                'ยังยืนยันสถานะการถือครองอาหารล่าสุดไม่ได้ งานและหน้าที่ดูแลยังไม่ถูกปล่อย รอข้อมูลเซิร์ฟเวอร์และให้ฝ่ายปฏิบัติการประสานงาน ห้ามรับหรือส่งต่อด้วยรหัสเก่า',
                                'Current food custody is unconfirmed. Assignment responsibility remains reserved while server recovery is pending. Operations must coordinate; do not collect or hand off using an old proof.',
                              )
                            : restricted.custodyPhase == 'PICKED_UP'
                            ? t(
                                'รับอาหารแล้ว: ยังถือครองอาหารและสิทธิ์งาน ต้องให้ฝ่ายปฏิบัติการประสานงาน ห้ามส่งต่องานเอง',
                                'Food already collected: custody and assignment remain active. Operations must coordinate resolution; do not hand off independently.',
                              )
                            : t(
                                'ยังไม่ได้รับอาหาร: งานยังถูกผูกไว้ รอฝ่ายปฏิบัติการจัดการ ห้ามรับอาหารด้วยรหัสเก่า',
                                'Food not collected: assignment remains reserved pending operations. Do not collect using an old proof.',
                              ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        '${t('สาเหตุ', 'Reason')}: ${_restrictionReason(restricted.reason)}',
                      ),
                      SelectableText(
                        '${t('งาน', 'Assignment')}: ${restricted.id}\n${t('รุ่นงาน/สิทธิ์', 'Service/lease generation')}: ${restricted.generation}/${restricted.leaseGeneration}',
                      ),
                    ],
                  ),
                  tinted: true,
                ),
              ] else if (work != null) ...[
                FoodIdleDiscoveryPanel(
                  key: const ValueKey('food-private-idle-panel'),
                  api: widget.api,
                  thai: widget.thai,
                  location: _idleLocation,
                  canCapture: !frozen,
                ),
                const SizedBox(height: 16),
                Text(
                  t('งานใหม่ใกล้คุณ', 'Offers near you'),
                  key: _offersHeading,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 16),
                if (work.offers.isEmpty)
                  _panel(
                    Column(
                      children: [
                        const Icon(Icons.delivery_dining, size: 40),
                        const SizedBox(height: 16),
                        Text(t('ไม่มีงานที่เสนอในขณะนี้', 'No current offers')),
                      ],
                    ),
                  ),
                for (final offer in work.offers) ...[
                  _routePanel(),
                  const SizedBox(height: 16),
                  DriverFoodOfferCard(
                    key: ValueKey('food-offer.${offer.id}'),
                    thai: widget.thai,
                    deadline: DateTime.parse(offer.expiresAt),
                    expiryLabel: driverOfferExpiryLabel(
                      context,
                      thai: widget.thai,
                      expiresAt: offer.expiresAt,
                    ),
                    earning: formatMinorUnits(
                      offer.earning.amountMinor,
                      offer.earning.decimals,
                      offer.earning.currency,
                    ),
                    pickup:
                        '${offer.pickupLatitudeE7 / 10000000}, ${offer.pickupLongitudeE7 / 10000000}',
                    onAccept:
                        frozen ||
                            !DateTime.parse(offer.expiresAt)
                                .isAfter(DateTime.now())
                        ? null
                        : () => _run(
                            () => _submit(widget.api.claimFoodCommand(offer)),
                          ),
                    declineAction: PopupMenuButton<String>(
                      enabled:
                          !frozen &&
                          DateTime.parse(offer.expiresAt)
                              .isAfter(DateTime.now()),
                      tooltip: t('ปฏิเสธงานพร้อมเหตุผล', 'Decline with reason'),
                      onSelected: (reason) {
                        // The popup route can outlive the launcher's eligibility.
                        // Fence new commands here; exact pending replay is separate.
                        if (!mounted ||
                            _busy ||
                            _pending != null ||
                            !DateTime.parse(offer.expiresAt)
                                .isAfter(DateTime.now())) {
                          return;
                        }
                        unawaited(
                          _run(
                            () => _submit(
                              widget.api.declineFoodCommand(offer, reason),
                            ),
                          ),
                        );
                      },
                      itemBuilder: (_) => [
                        PopupMenuItem(
                          value: 'UNAVAILABLE',
                          child: Text(t('ไม่พร้อมรับงาน', 'Unavailable')),
                        ),
                        PopupMenuItem(
                          value: 'DISTANCE',
                          child: Text(
                            t('ระยะทางไม่เหมาะสม', 'Pickup distance'),
                          ),
                        ),
                        PopupMenuItem(
                          value: 'VEHICLE',
                          child: Text(
                            t('ยานพาหนะไม่พร้อม', 'Vehicle unavailable'),
                          ),
                        ),
                        PopupMenuItem(
                          value: 'SAFETY',
                          child: Text(
                            t('เหตุผลด้านความปลอดภัย', 'Safety concern'),
                          ),
                        ),
                        PopupMenuItem(
                          value: 'OTHER',
                          child: Text(t('เหตุผลอื่น', 'Other reason')),
                        ),
                      ],
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                          t('ปฏิเสธงานนี้', 'Decline this offer'),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                ],
              ],
              if (duty != null) ...[
                const SizedBox(height: 16),
                if (duty is FoodDriverAssignment &&
                    ['PICKED_UP', 'AT_DROPOFF'].contains(duty.state))
                  OutlinedButton.icon(
                    key: const ValueKey('food-delivery-issue'),
                    onPressed: frozen
                        ? null
                        : () => _run(() => _report(duty, deliveryIssue: true)),
                    icon: const Icon(Icons.delivery_dining_outlined),
                    label: Text(
                      t(
                        'ส่งอาหารไม่ได้ / ขอเจ้าหน้าที่ช่วย',
                        'Cannot deliver / ask staff for help',
                      ),
                    ),
                  ),
                OutlinedButton.icon(
                  key: const ValueKey('food-report-incident'),
                  onPressed: frozen ? null : () => _run(() => _report(duty)),
                  icon: const Icon(Icons.health_and_safety_outlined),
                  label: Text(
                    t(
                      'รายงานเหตุ / ขอความช่วยเหลือ',
                      'Report incident / ask for help',
                    ),
                  ),
                ),
                TextButton.icon(
                  key: const ValueKey('food-incident-history'),
                  onPressed: frozen
                      ? null
                      : () => _run(
                          () => _incidentHistory(switch (duty) {
                            FoodDriverAssignment a => a.id,
                            FoodDriverRestrictedAssignment a => a.id,
                          }),
                        ),
                  icon: const Icon(Icons.history),
                  label: Text(
                    t(
                      'สถานะรายงานของงานนี้',
                      'This assignment’s incident reports',
                    ),
                  ),
                ),
              ],
              if (duty != null &&
                  (a != null && ['ACCEPTED', 'AT_PICKUP'].contains(a.state) ||
                      restricted?.custodyPhase == 'PREPICKUP')) ...[
                const SizedBox(height: 16),
                _panel(
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        t(
                          'ขอถอนตัวก่อนรับอาหาร',
                          'Request pre-pickup withdrawal',
                        ),
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        t(
                          'เซิร์ฟเวอร์ต้องยืนยันก่อน งานและหน้าที่ดูแลยังไม่ถูกปล่อยหากไม่ตอบกลับ ถ้ารับอาหารแล้วจะถอนไม่ได้ ต้องให้ฝ่ายปฏิบัติการประสานงาน',
                          'Wait for server confirmation. No response does not release assignment responsibility. Collected food cannot be released here; operations must coordinate.',
                        ),
                      ),
                      PopupMenuButton<String>(
                        enabled: !frozen,
                        tooltip: t(
                          'เลือกเหตุผลถอนตัว',
                          'Choose withdrawal reason',
                        ),
                        onSelected: (reason) => _run(
                          () => _submit(
                            widget.api.withdrawFoodCommand(duty, reason),
                          ),
                        ),
                        itemBuilder: (_) => [
                          PopupMenuItem(
                            value: 'UNAVAILABLE',
                            child: Text(t('ไม่พร้อมทำงานต่อ', 'Unavailable')),
                          ),
                          PopupMenuItem(
                            value: 'VEHICLE',
                            child: Text(t('ปัญหายานพาหนะ', 'Vehicle issue')),
                          ),
                          PopupMenuItem(
                            value: 'SAFETY',
                            child: Text(t('ความปลอดภัย', 'Safety')),
                          ),
                          PopupMenuItem(
                            value: 'OTHER',
                            child: Text(t('เหตุผลอื่น', 'Other reason')),
                          ),
                        ],
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(
                            t(
                              'เลือกเหตุผลเพื่อขอถอนตัว',
                              'Choose reason to request withdrawal',
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              if (_loadedAt != null) ...[
                const SizedBox(height: 16),
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: Text(
                    t('รายละเอียดการเชื่อมต่อ', 'Connection details'),
                  ),
                  children: [
                    _label(
                      '${t('โหลดล่าสุด', 'Last snapshot')}: ${_loadedAt!.toLocal()}',
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    unawaited(_receiptSessions?.cancel());
    removeOwnedRoute(_receiptEarningsRoute);
    _workScroll.dispose();
    _stopWatch();
    _closeCustody();
    _closeIncident();
    _idleLocation.removeListener(_idleStatusChanged);
    _idleLocation.dispose();
    _location.removeListener(_locationChanged);
    _location.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}

class _CustodyProofDialog extends StatefulWidget {
  const _CustodyProofDialog({required this.thai});
  final bool thai;
  @override
  State<_CustodyProofDialog> createState() => _CustodyProofDialogState();
}

class _CustodyProofDialogState extends State<_CustodyProofDialog> {
  final _controller = TextEditingController();
  String t(String th, String en) => widget.thai ? th : en;
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(t('หลักฐานรับ/ส่งอาหาร', 'Food custody proof')),
    content: TextField(
      controller: _controller,
      autocorrect: false,
      enableSuggestions: false,
      decoration: InputDecoration(
        labelText: t('รหัสจากร้าน/ลูกค้า', 'Secret from merchant/customer'),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(t('ยกเลิก', 'Cancel')),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, _controller.text.trim()),
        child: Text(t('ยืนยัน', 'Confirm')),
      ),
    ],
  );
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
}

class _IncidentReportDialog extends StatefulWidget {
  const _IncidentReportDialog({required this.thai, this.deliveryIssue = false});
  final bool thai;
  final bool deliveryIssue;
  @override
  State<_IncidentReportDialog> createState() => _IncidentReportDialogState();
}

class _IncidentReportDialogState extends State<_IncidentReportDialog> {
  final _body = TextEditingController();
  late String _kind = widget.deliveryIssue ? 'CUSTODY' : 'SUPPORT';
  String t(String th, String en) => widget.thai ? th : en;
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      widget.deliveryIssue
          ? t('แจ้งปัญหาการส่งอาหาร', 'Report a delivery problem')
          : t('รายงานเหตุของงานนี้', 'Report this assignment incident'),
    ),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            t(
              'ไม่ใช่บริการฉุกเฉิน รายงานความปลอดภัยจะระงับขั้นตอนงาน แต่ไม่ปล่อยหน้าที่ดูแลอาหาร',
              'Not an emergency service. Safety reports pause job actions, but do not release food responsibility.',
            ),
          ),
          const SizedBox(height: 16),
          if (widget.deliveryIssue)
            Text(
              t(
                'อธิบายเหตุที่ส่งไม่ได้ รายงานจะพักขั้นตอนงานเพื่อให้เจ้าหน้าที่ช่วย คุณยังรับผิดชอบอาหารอยู่ ไม่ใช่การยกเลิกออเดอร์ คืนเงิน หรือยืนยันส่งสำเร็จ',
                'Explain why delivery is not possible. Reporting pauses work for staff assistance. You retain responsibility for the food; this does not cancel, refund or complete the order.',
              ),
            )
          else
            DropdownButtonFormField<String>(
              initialValue: _kind,
              isExpanded: true,
              decoration: InputDecoration(labelText: t('ประเภท', 'Category')),
              items: [
                DropdownMenuItem(
                  value: 'SUPPORT',
                  child: Text(
                    t(
                      'ขอความช่วยเหลือ (ไม่ระงับงาน)',
                      'Support (does not pause work)',
                    ),
                  ),
                ),
                DropdownMenuItem(
                  value: 'SOS',
                  child: Text(
                    t('ความปลอดภัยเร่งด่วน', 'Urgent safety concern'),
                  ),
                ),
                DropdownMenuItem(
                  value: 'COLLISION',
                  child: Text(t('อุบัติเหตุ', 'Collision')),
                ),
                DropdownMenuItem(
                  value: 'HARASSMENT',
                  child: Text(t('การคุกคาม', 'Harassment')),
                ),
                DropdownMenuItem(
                  value: 'MISSING_ITEM',
                  child: Text(t('อาหาร/รายการสูญหาย', 'Missing food/item')),
                ),
                DropdownMenuItem(
                  value: 'CUSTODY',
                  child: Text(t('ปัญหาการถือครองอาหาร', 'Food custody issue')),
                ),
                DropdownMenuItem(
                  value: 'FRAUD',
                  child: Text(t('สงสัยทุจริต', 'Suspected fraud')),
                ),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _kind = value);
              },
            ),
          const SizedBox(height: 16),
          TextField(
            key: const ValueKey('food-incident-body'),
            controller: _body,
            maxLength: 4000,
            minLines: 3,
            maxLines: 6,
            autocorrect: false,
            enableSuggestions: false,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: t(
                'รายละเอียดส่วนตัวให้ฝ่ายช่วยเหลือ',
                'Private details for authorized support',
              ),
            ),
          ),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(t('ยกเลิก', 'Cancel')),
      ),
      FilledButton(
        key: const ValueKey('food-incident-send'),
        onPressed: _body.text.trim().isEmpty
            ? null
            : () => Navigator.pop(context, (_kind, _body.text.trim())),
        child: Text(t('ส่งรายงาน', 'Submit report')),
      ),
    ],
  );
  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }
}

class _IncidentHistoryDialog extends StatefulWidget {
  const _IncidentHistoryDialog({
    required this.api,
    required this.assignmentId,
    required this.owner,
    required this.thai,
  });
  final MobileApi api;
  final String assignmentId;
  final ({String accountId, String sessionId}) owner;
  final bool thai;
  @override
  State<_IncidentHistoryDialog> createState() => _IncidentHistoryDialogState();
}

class _IncidentHistoryDialogState extends State<_IncidentHistoryDialog> {
  final List<FoodIncident> _incidents = [];
  String? _cursor;
  Object? _error;
  bool _busy = true;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    if (widget.api.sessionScope != widget.owner) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final page = await widget.api.foodIncidents(
        widget.assignmentId,
        afterId: _cursor,
      );
      if (!mounted || widget.api.sessionScope != widget.owner) return;
      setState(() {
        _incidents.addAll(page.incidents);
        _cursor = page.nextCursor;
      });
    } catch (error) {
      if (mounted && widget.api.sessionScope == widget.owner)
        setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      t('สถานะรายงานของงานนี้', 'This assignment’s incident reports'),
    ),
    content: SizedBox(
      width: 420,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              t(
                'สถานะรายงาน ไม่ใช่สถานะงานปัจจุบัน การรับทราบไม่ใช่การอนุญาตให้ทำงานต่อ ไม่มีรายละเอียดส่วนตัวในหน้านี้',
                'Report history, not current duty status. Acknowledgement is not permission to resume. Private report details are not shown here.',
              ),
            ),
            if (_busy) const LinearProgressIndicator(),
            if (_error != null) ...[
              Text(_error.toString()),
              TextButton(
                onPressed: _busy ? null : _load,
                child: Text(t('ลองอีกครั้ง', 'Retry')),
              ),
            ],
            if (!_busy && _error == null && _incidents.isEmpty)
              Text(t('ยังไม่มีรายงาน', 'No reports recorded')),
            for (final incident in _incidents)
              ListTile(
                title: Text(
                  '${incident.kind} · ${DateTime.parse(incident.reportedAt).toLocal()}',
                ),
                subtitle: Text(
                  incident.resolution == 'RETURNED_TO_MERCHANT'
                      ? t(
                          'รับคืนที่ร้านและปิดหน้าที่แล้ว การเงินยังต้องตรวจแยก',
                          'Returned to merchant; duty closed. Financial review is separate.',
                        )
                      : incident.resolvedAt != null
                      ? t(
                          'ได้รับอนุญาตให้ทำงานเดิมต่อในขณะนั้นแล้ว ดูสถานะงานล่าสุดแยกต่างหาก',
                          'Same-custody resume was authorized then; check current duty separately',
                        )
                      : incident.acknowledgedAt != null
                      ? t(
                          'เจ้าหน้าที่รับทราบแล้ว ยังไม่ได้อนุญาตให้ทำงานต่อ',
                          'Acknowledged; not authorization to resume',
                        )
                      : t(
                          'บันทึกรายงานแล้ว ยังไม่รับทราบ',
                          'Recorded; not yet acknowledged',
                        ),
                ),
              ),
            if (_cursor != null)
              TextButton(
                onPressed: _busy ? null : _load,
                child: Text(t('โหลดรายงานเพิ่ม', 'Load more reports')),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(t('ปิด', 'Close')),
      ),
    ],
  );
}
