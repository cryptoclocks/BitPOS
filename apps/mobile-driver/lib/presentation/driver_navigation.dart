import 'dart:async';

import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/owned_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show ValueListenable;

class DriverNavigation extends StatelessWidget {
  const DriverNavigation({
    super.key,
    required this.thai,
    required this.selectedIndex,
    this.onSelected,
    this.compact = false,
  });
  final bool thai;
  final int selectedIndex;
  final ValueChanged<int>? onSelected;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final colors = theme.colorScheme;
    return NavigationBarTheme(
      data: NavigationBarThemeData(
        height: compact ? 62 : 72,
        backgroundColor: dark ? colors.surfaceContainer : Colors.white,
        indicatorColor: Colors.transparent,
        elevation: 0,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 11,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w400,
            color: states.contains(WidgetState.selected)
                ? (dark ? colors.primary : const Color(0xff64188a))
                : (dark ? colors.onSurfaceVariant : const Color(0xff7b7088)),
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            size: 22,
            color: states.contains(WidgetState.selected)
                ? (dark ? colors.primary : const Color(0xff64188a))
                : (dark ? colors.onSurfaceVariant : const Color(0xff7b7088)),
          ),
        ),
      ),
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: dark ? colors.outlineVariant : const Color(0xffe9e1f1),
            ),
          ),
        ),
        child: NavigationBar(
          selectedIndex: selectedIndex,
          onDestinationSelected: onSelected,
          labelBehavior: compact
              ? NavigationDestinationLabelBehavior.alwaysShow
              : null,
          destinations: [
            NavigationDestination(
              icon: const Icon(Icons.delivery_dining_outlined),
              label: thai ? 'รับงาน' : 'Work',
            ),
            NavigationDestination(
              icon: const Icon(Icons.history),
              label: thai ? 'ประวัติ' : 'History',
            ),
            NavigationDestination(
              icon: const Icon(Icons.account_balance_wallet_outlined),
              label: thai ? 'รายได้' : 'Earnings',
            ),
            NavigationDestination(
              icon: const Icon(Icons.account_circle_outlined),
              label: thai ? 'บัญชี' : 'Account',
            ),
          ],
        ),
      ),
    );
  }
}

/// Destination child retains its own data owner and lifecycle handling.
class DriverDestination extends StatefulWidget {
  const DriverDestination({
    super.key,
    required this.child,
    required this.thai,
    required this.index,
    this.api,
    this.travelMode,
  });
  final MobileApi? api;
  final Widget child;
  final bool thai;
  final int index;
  final ValueListenable<bool>? travelMode;
  @override
  State<DriverDestination> createState() => _DriverDestinationState();
}

class _DriverDestinationState extends State<DriverDestination> {
  late final owner = widget.api?.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? changes;
  ModalRoute<dynamic>? route;
  bool retired = false;
  @override
  void initState() {
    super.initState();
    changes = widget.api?.sessionScopes.listen((next) {
      if (next != owner && mounted) {
        setState(() => retired = true);
        removeOwnedRoute(route);
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    route = ModalRoute.of(context);
    if (widget.api != null &&
        (!widget.api!.signedIn || widget.api!.sessionScope != owner)) {
      retired = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) removeOwnedRoute(route);
      });
    }
  }

  @override
  void dispose() {
    unawaited(changes?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (retired) return const SizedBox.shrink();
    final travelMode = widget.travelMode;
    return travelMode == null
        ? _surface(false)
        : ValueListenableBuilder<bool>(
            valueListenable: travelMode,
            builder: (context, travelling, child) => _surface(travelling),
          );
  }

  Widget _surface(bool travelling) => Scaffold(
          body: widget.child,
          bottomNavigationBar: travelling ? null : DriverNavigation(
            thai: widget.thai,
            selectedIndex: widget.index,
            onSelected: (next) {
              if (widget.api != null &&
                  (!widget.api!.signedIn ||
                      widget.api!.sessionScope != owner)) {
                return;
              }
              if (next != widget.index) Navigator.of(context).pop(next);
            },
          ),
        );
}
