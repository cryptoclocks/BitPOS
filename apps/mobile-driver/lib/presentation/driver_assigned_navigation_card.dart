import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

/// R09/R12 presentation only. Snapshot, camera and command ownership stay outside.
class DriverAssignedNavigationCard extends StatefulWidget {
  const DriverAssignedNavigationCard({
    super.key,
    required this.assignment,
    required this.thai,
    required this.status,
    required this.mapBuilder,
    required this.onViewMap,
    required this.onChat,
    required this.onArrive,
  });

  final FoodDriverAssignment assignment;
  final bool thai;
  final Widget Function(double height, double cameraBottomInset, Widget Function(BuildContext, Widget, Widget, Widget?, Widget) compose) mapBuilder;
  final String status;
  final VoidCallback? onViewMap, onChat, onArrive;

  @override
  State<DriverAssignedNavigationCard> createState() => _DriverAssignedNavigationCardState();
}

class _DriverAssignedNavigationCardState extends State<DriverAssignedNavigationCard> {
  static const _overlayBottom = 54.0;
  final _panelKey = GlobalKey();
  double _cameraBottomInset = 0;
  bool _measurementScheduled = false;

  void _measurePanel() {
    if (_measurementScheduled) return;
    _measurementScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _measurementScheduled = false;
      final height = _panelKey.currentContext?.size?.height;
      if (height != null && (height + _overlayBottom - _cameraBottomInset).abs() > .5) {
        setState(() => _cameraBottomInset = height + _overlayBottom);
      }
    });
  }

  String _t(String th, String en) => widget.thai ? th : en;

  @override
  Widget build(BuildContext context) => widget.mapBuilder(456, _cameraBottomInset, _compose);

  Widget _compose(BuildContext context, Widget viewport, Widget controls, Widget? estimate, Widget notices) {
    if (_panelKey.currentContext == null) _measurePanel();
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final pickup = widget.assignment.state == 'ACCEPTED';
    final buttonStyle = OutlinedButton.styleFrom(
      minimumSize: const Size(48, 52),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    );
    final sheet = Container(
      key: const ValueKey('food-assigned-navigation-actions'),
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 55),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DefaultTextStyle.merge(
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w600, color: colors.onSurface, height: 1.4),
            child: estimate ?? Text(_t('ยังไม่มี ETA ปัจจุบัน', 'Current ETA unavailable')),
          ),
          const SizedBox(height: 8),
          Text(
            pickup ? _t('ข้อมูลจุดรับอาหารยังไม่พร้อม', 'Pickup details unavailable') : widget.assignment.addressText,
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w400, color: colors.onSurfaceVariant, height: 1.5),
          ),
          const SizedBox(height: 26),
          LayoutBuilder(builder: (context, constraints) {
            final stacked = constraints.maxWidth < 300 || MediaQuery.textScalerOf(context).scale(16) > 20;
            final viewMap = OutlinedButton.icon(
              key: const ValueKey('food-assigned-navigation-details'),
              onPressed: widget.onViewMap,
              style: buttonStyle.copyWith(backgroundColor: WidgetStatePropertyAll(colors.primaryContainer)),
              icon: const Icon(Icons.receipt_long_outlined),
              label: Text(_t('รายละเอียดงาน', 'Job details')),
            );
            final chat = OutlinedButton.icon(
              key: const ValueKey('food-assigned-navigation-chat'),
              onPressed: widget.onChat,
              style: buttonStyle,
              icon: const Icon(Icons.chat_bubble_outline),
              label: Text(_t('คุยกับลูกค้า', 'Chat with customer')),
            );
            return stacked
                ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [viewMap, const SizedBox(height: 14), chat])
                : Row(children: [Expanded(child: viewMap), const SizedBox(width: 14), Expanded(child: chat)]);
          }),
          const SizedBox(height: 36),
          FilledButton(
            key: ValueKey('food-assigned-arrive-${pickup ? 'PICKUP' : 'DROPOFF'}'),
            onPressed: widget.onArrive,
            style: FilledButton.styleFrom(
              minimumSize: const Size(48, 52),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            child: Text(pickup ? _t('ถึงร้านแล้ว', 'Arrived at store') : _t('ถึงปลายทางแล้ว', 'Arrived at destination'), textAlign: TextAlign.center),
          ),
        ],
      ),
    );
    return LayoutBuilder(builder: (context, constraints) {
      final wide = constraints.maxWidth >= 900;
      final mapWidth = wide ? (constraints.maxWidth - 24) * .58 : constraints.maxWidth;
      final sheetWidth = wide ? constraints.maxWidth - mapWidth - 24 : constraints.maxWidth;
      // A stable Stack retains the one private map/camera across width changes.
      return Stack(
        clipBehavior: Clip.none,
        children: [
          SizedBox(
            width: mapWidth,
            child: Stack(children: [
              viewport,
              Positioned(
                left: 12, right: 12, bottom: _overlayBottom,
                child: NotificationListener<SizeChangedLayoutNotification>(
                  onNotification: (_) { _measurePanel(); return true; },
                  child: SizeChangedLayoutNotifier(child: Material(
                  key: _panelKey,
                  color: colors.surface.withValues(alpha: .94),
                  borderRadius: BorderRadius.circular(14),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Text(widget.status, style: theme.textTheme.labelMedium),
                      controls,
                      ConstrainedBox(constraints: const BoxConstraints(maxHeight: 100), child: SingleChildScrollView(child: notices)),
                    ]),
                  ),
                ))),
              ),
            ]),
          ),
          Padding(
            padding: EdgeInsets.only(top: wide ? 0 : 414, left: wide ? mapWidth + 24 : 0),
            child: SizedBox(width: sheetWidth, child: sheet),
          ),
        ],
      );
    });
  }
}
