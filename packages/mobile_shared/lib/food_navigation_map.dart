import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'mobile_api.dart';
import 'mobile_v1.generated.dart';

/// Finite, assignment-private viewport. Tiles and routes come from server authority,
/// never from public fallback providers or interpolated driver animations.
class FoodNavigationMap extends StatefulWidget {
  const FoodNavigationMap({
    super.key,
    required this.api,
    required this.assignmentId,
    required this.generation,
    required this.leaseGeneration,
    required this.revision,
    required this.thai,
    this.height = 260,
    this.cameraBottomInset = 0,
    this.orderId,
    this.presentationBuilder,
  });
  final MobileApi api;
  final String assignmentId, generation, leaseGeneration, revision;
  final String? orderId;
  final double height, cameraBottomInset;
  final bool thai;
  final Widget Function(
    BuildContext context,
    Widget viewport,
    Widget controls,
    Widget? estimate,
    Widget notices,
  )?
  presentationBuilder;
  @override
  State<FoodNavigationMap> createState() => _FoodNavigationMapState();
}

class _FoodNavigationMapState extends State<FoodNavigationMap>
    with WidgetsBindingObserver {
  late final _owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? _owners;
  bool _foreground = true, _retired = false;
  bool get _current =>
      mounted &&
      _foreground &&
      !_retired &&
      widget.api.signedIn &&
      widget.api.sessionScope == _owner;
  void _clearPrivate() {
    _epoch++;
    _expiry?.cancel();
    _snapshot = null;
    _tiles.clear();
    _loading = false;
    _error = null;
    _expired = false;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!mounted) return;
    setState(_clearPrivate);
    if (_current) unawaited(_load(reset: true, preempt: true));
  }

  void _failed(Object error, int epoch) {
    if (!_current || epoch != _epoch) return;
    setState(() {
      _clearPrivate();
      _error = error;
    });
  }

  FoodNavigationSnapshot? _snapshot;
  final _tiles = <(int, int), Uint8List>{};
  int _epoch = 0, _zoom = 14;
  bool _loading = false;
  Object? _error;
  int _left = 0, _top = 0;
  final _cameraController = TransformationController();
  double _viewportWidth = 0;
  Offset _viewportAnchor = Offset.zero;
  Timer? _expiry;
  bool _expired = false;
  String t(String th, String en) => widget.thai ? th : en;
  String _localTime(String iso) {
    final at = DateTime.parse(iso).toLocal();
    return '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
  }

  String _routeReason(String reason) => switch (reason) {
    'no_assignment' => t(
      'ยังไม่มีงานส่งที่ติดตามได้',
      'No active delivery to track',
    ),
    'unconfigured' => t(
      'บริการเส้นทางยังไม่พร้อมใช้งาน',
      'Routing service is not configured yet',
    ),
    'location_unavailable' => t(
      'กำลังรอพิกัดจากไรเดอร์',
      'Waiting for the rider’s location',
    ),
    'location_stale' => t(
      'พิกัดล่าสุดเก่าแล้ว กรุณาโหลดใหม่',
      'Location is out of date. Refresh to check again.',
    ),
    'provider_unavailable' => t(
      'บริการเส้นทางไม่ตอบสนอง กรุณาลองใหม่',
      'Routing service is unavailable. Try again.',
    ),
    'invalid_response' => t(
      'ยังยืนยันเส้นทางไม่ได้ กรุณาลองใหม่',
      'The route could not be verified. Try again.',
    ),
    _ => t('เส้นทางยังไม่พร้อมใช้งาน', 'Route unavailable'),
  };

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _owners = widget.api.sessionScopes.listen((next) {
      if (mounted && next != _owner) {
        setState(() {
          _clearPrivate();
          _retired = true;
        });
      }
    });
    _load();
  }

  @override
  void didUpdateWidget(covariant FoodNavigationMap old) {
    super.didUpdateWidget(old);
    if (!identical(old.api, widget.api)) {
      _clearPrivate();
      _retired = true;
      return;
    }
    if ((old.assignmentId, old.generation, old.leaseGeneration, old.orderId) !=
        (
          widget.assignmentId,
          widget.generation,
          widget.leaseGeneration,
          widget.orderId,
        )) {
      _load(reset: true, preempt: true);
    } else if (widget.revision != old.revision) {
      _load();
    }
  }

  bool _stale(FoodTrackedLocation point) =>
      _expired ||
      point.stale ||
      DateTime.now().difference(DateTime.parse(point.capturedAt)) >=
          const Duration(seconds: 30) ||
      DateTime.now().difference(DateTime.parse(point.receivedAt)) >=
          const Duration(seconds: 30);
  void _expire(FoodTrackedLocation? point) {
    _expiry?.cancel();
    _expired = false;
    if (point == null) return;
    final captured = DateTime.parse(point.capturedAt),
        received = DateTime.parse(point.receivedAt),
        until = (captured.isBefore(received) ? captured : received)
            .add(const Duration(seconds: 30))
            .difference(DateTime.now());
    if (until <= Duration.zero) {
      _expired = true;
      return;
    }
    _expiry = Timer(until, () {
      if (mounted) setState(() => _expired = true);
    });
  }

  Offset _project(int latitude, int longitude) {
    final size = 256.0 * math.pow(2, _zoom),
        lat = (latitude / 1e7).clamp(-85.05112878, 85.05112878) * math.pi / 180;
    return Offset(
      (longitude / 1e7 + 180) / 360 * size,
      (1 - math.log(math.tan(lat) + 1 / math.cos(lat)) / math.pi) / 2 * size,
    );
  }

  Offset _nearestWorld(Offset point, double referenceX) {
    final width = 256.0 * (1 << _zoom);
    return Offset(
      point.dx + ((referenceX - point.dx) / width).round() * width,
      point.dy,
    );
  }

  Future<void> _load({bool reset = false, bool preempt = false}) async {
    if (!_current || (_loading && !preempt)) return;
    final epoch = ++_epoch;
    final recenter = reset || _snapshot == null;
    setState(() {
      _loading = true;
      _error = null;
      if (recenter) {
        _expiry?.cancel();
        _tiles.clear();
        _snapshot = null;
      }
    });
    try {
      final snapshot = await widget.api.foodNavigation(
        orderId: widget.orderId,
        assignmentId: widget.assignmentId,
        generation: widget.generation,
        leaseGeneration: widget.leaseGeneration,
      );
      if (!_current || epoch != _epoch) return;
      final a = snapshot.assignment;
      _expire(a?.location);
      if (a == null) {
        setState(() {
          _snapshot = snapshot;
          _tiles.clear();
        });
        return;
      }
      final count = math.pow(2, _zoom).toInt();
      if (recenter) {
        final center = _project(
          a.location?.latitudeE7 ?? a.targetLatitudeE7,
          a.location?.longitudeE7 ?? a.targetLongitudeE7,
        );
        _left = (center.dx / 256).floor() - 1;
        _top = ((center.dy / 256).floor() - 1).clamp(0, count - 3);
        _cameraController.value = _cameraAt(
          center - Offset(_left * 256.0, _top * 256.0),
          math.max(1, _minimumCameraScale * 1.2),
          _viewportAnchor,
        );
      }
      setState(() => _snapshot = snapshot);
      if (snapshot.tilesAvailable) {
        for (var row = 0; row < 3; row++) {
          await Future.wait(
            List.generate(3, (column) async {
              if (_tiles.containsKey((column, row))) return;
              final x = (_left + column) % count, y = _top + row;
              try {
                final tile = await widget.api.foodNavigationTile(
                  orderId: widget.orderId,
                  assignmentId: widget.assignmentId,
                  generation: widget.generation,
                  leaseGeneration: widget.leaseGeneration,
                  z: _zoom,
                  x: x,
                  y: y,
                );
                if (!_current || epoch != _epoch) return;
                final bytes = base64Decode(tile.pngBase64);
                setState(() => _tiles[(column, row)] = bytes);
              } catch (error) {
                if (error is MobileApiException &&
                    ([401, 403, 404, 410].contains(error.status) ||
                        [
                          'ASSIGNMENT_CHANGED',
                          'LOCATION_STALE',
                        ].contains(error.code))) {
                  _failed(error, epoch);
                } else if (_current && epoch == _epoch) {
                  setState(() => _error = error);
                }
              }
            }),
          );
          if (!_current || epoch != _epoch) return;
        }
      }
    } catch (error) {
      _failed(error, epoch);
    } finally {
      if (_current && epoch == _epoch) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_retired || !_foreground) return const SizedBox.shrink();
    final snapshot = _snapshot, a = snapshot?.assignment;
    final stale = a?.location != null && _stale(a!.location!),
        route = stale ? null : snapshot?.route;
    final origin = Offset(_left * 256.0, _top * 256.0),
        viewportX = origin.dx + 384,
        points = <Offset>[];
    var previousX = viewportX;
    for (final point in route?.points ?? <FoodMapPoint>[]) {
      final projected = _nearestWorld(
        _project(point.latitudeE7, point.longitudeE7),
        previousX,
      );
      points.add(projected - origin);
      previousX = projected.dx;
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final viewport = LayoutBuilder(
          builder: (context, constraints) {
            final previousWidth = _viewportWidth;
            final previousAnchor = _viewportAnchor;
            _viewportWidth = constraints.maxWidth;
            _viewportAnchor = Offset(
              _viewportWidth / 2,
              math.min(
                widget.height / 2,
                math.max(24, widget.height - widget.cameraBottomInset - 24),
              ),
            );
            if (previousWidth > 0 &&
                ((_viewportWidth - previousWidth).abs() > 1 ||
                    (_viewportAnchor - previousAnchor).distance > 1) &&
                _snapshot != null) {
              final epoch = _epoch;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (!_current || epoch != _epoch) return;
                final matrix = _cameraController.value;
                final focus = _cameraController.toScene(previousAnchor);
                setState(() {
                  _cameraController.value = _cameraAt(
                    focus,
                    math.max(
                      matrix.getMaxScaleOnAxis(),
                      _minimumCameraScale * 1.2,
                    ),
                    _viewportAnchor,
                  );
                });
              });
            }
            return SizedBox(
              height: widget.height,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(22),
                child: ColoredBox(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  child: a == null || snapshot?.tilesAvailable != true
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.map_outlined, size: 40),
                                const SizedBox(height: 12),
                                Text(
                                  t(
                                    'แผนที่ยังไม่พร้อมใช้งาน',
                                    'Map unavailable',
                                  ),
                                ),
                                Text(
                                  t(
                                    'ต้องตั้งค่าผู้ให้บริการ ไม่มีแผนที่จำลองทดแทน',
                                    'Configured provider required; no invented map fallback',
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                              ],
                            ),
                          ),
                        )
                      : _camera(
                          SizedBox(
                            width: 768,
                            height: 768,
                            child: Stack(
                              children: [
                                for (var row = 0; row < 3; row++)
                                  for (var column = 0; column < 3; column++)
                                    Positioned(
                                      left: column * 256.0,
                                      top: row * 256.0,
                                      width: 256,
                                      height: 256,
                                      child: _tile(column, row),
                                    ),
                                Positioned.fill(
                                  child: IgnorePointer(
                                    child: CustomPaint(
                                      painter: _RoutePainter(
                                        points: points,
                                        color: Theme.of(context)
                                            .colorScheme
                                            .primary,
                                      ),
                                    ),
                                  ),
                                ),
                                _marker(
                                  _nearestWorld(
                                        _project(
                                          a.targetLatitudeE7,
                                          a.targetLongitudeE7,
                                        ),
                                        viewportX,
                                      ) -
                                      origin,
                                  Icons.flag,
                                  Colors.deepPurple,
                                ),
                                if (a.location case final location?)
                                  _marker(
                                    _nearestWorld(
                                          _project(
                                            location.latitudeE7,
                                            location.longitudeE7,
                                          ),
                                          viewportX,
                                        ) -
                                        origin,
                                    Icons.delivery_dining,
                                    _stale(location)
                                        ? Colors.grey
                                        : Colors.deepPurple,
                                  ),
                              ],
                            ),
                          ),
                        ),
                ),
              ),
            );
          },
        );
        final controls = Row(
          children: [
            IconButton(
              tooltip: t('ย่อ', 'Zoom out'),
              onPressed: _loading || _zoom <= 12
                  ? null
                  : () {
                      _zoom--;
                      _load(reset: true);
                    },
              icon: const Icon(Icons.remove),
            ),
            IconButton(
              tooltip: t('ขยาย', 'Zoom in'),
              onPressed: _loading || _zoom >= 18
                  ? null
                  : () {
                      _zoom++;
                      _load(reset: true);
                    },
              icon: const Icon(Icons.add),
            ),
            const Spacer(),
            IconButton(
              tooltip: t('โหลดเส้นทางใหม่', 'Refresh route'),
              onPressed: _loading ? null : () => _load(reset: true),
              icon: const Icon(Icons.refresh),
            ),
          ],
        );
        final estimate = route == null
            ? null
            : Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  '${t('เวลาเดินทางตามเส้นทาง', 'Route travel estimate')} ${(route.durationSeconds / 60).ceil()} ${t('นาที', 'min')} · ${(route.distanceMetres / 1000).toStringAsFixed(1)} ${t('กม.', 'km')}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              );
        final notices = Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (snapshot?.routeUnavailable != null)
              Text(_routeReason(snapshot!.routeUnavailable!)),
            if (stale)
              Text(
                t(
                  'พิกัดเก่า ไม่แสดง ETA ปัจจุบัน',
                  'Stale location; current ETA unavailable',
                ),
              ),
            if (a?.location case final location?)
              Text(
                '${t('อัปเดตตำแหน่ง', 'Location updated')} ${_localTime(location.receivedAt)}${_stale(location) ? t(' · ข้อมูลเก่า', ' · STALE') : ''}',
              ),
            if (_error != null)
              Text(
                t(
                  'แผนที่/เส้นทางโหลดไม่สำเร็จ ไม่ยืนยันตำแหน่งปัจจุบัน',
                  'Map/route request failed; current tracking unconfirmed',
                ),
              ),
            if (snapshot?.tileAttribution case final attribution?)
              Text(attribution, style: Theme.of(context).textTheme.labelSmall),
            if (snapshot?.tileFixture == true)
              Text(
                t(
                  'แผนที่กริดจำลอง ไม่ใช่ถนนจริง',
                  'Synthetic grid map; not real streets',
                ),
                style: Theme.of(context).textTheme.labelSmall,
              ),
            if (route != null)
              Text(
                route.attribution,
                style: Theme.of(context).textTheme.labelSmall,
              ),
            if (widget.api.fixture &&
                (a?.fixture == true ||
                snapshot?.tileFixture == true ||
                route?.fixture == true))
              Text(
                t(
                  'AVD / ข้อมูลจำลอง ไม่ใช่ GPS หรือการส่งจริง',
                  'AVD / SYNTHETIC FIXTURE — not real GPS or delivery',
                ),
              ),
          ],
        );
        final builder = widget.presentationBuilder;
        if (builder != null) {
          return builder(
            context,
            viewport,
            controls,
            estimate,
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_loading) const LinearProgressIndicator(),
                notices,
              ],
            ),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            viewport,
            if (_loading) const LinearProgressIndicator(),
            controls,
            ?estimate,
            notices,
          ],
        );
      },
    );
  }

  double get _minimumCameraScale =>
      math.max(.4, math.max(_viewportWidth, widget.height) / 768);

  Matrix4 _cameraAt(Offset focus, double scale, Offset anchor) {
    // Fit the finite tile grid around the retained world focus, not a clamped replacement focus.
    scale = math.max(
      scale,
      math.max(
        math.max(
          anchor.dx / focus.dx,
          (_viewportWidth - anchor.dx) / (768 - focus.dx),
        ),
        math.max(
          anchor.dy / focus.dy,
          (widget.height - anchor.dy) / (768 - focus.dy),
        ),
      ),
    );
    final x = (anchor.dx - focus.dx * scale)
        .clamp(_viewportWidth - 768 * scale, 0.0)
        .toDouble();
    final y = (anchor.dy - focus.dy * scale)
        .clamp(widget.height - 768 * scale, 0.0)
        .toDouble();
    return Matrix4.diagonal3Values(scale, scale, 1)..setTranslationRaw(x, y, 0);
  }

  Widget _camera(Widget child) => InteractiveViewer(
    transformationController: _cameraController,
    minScale: _minimumCameraScale,
    maxScale: math.max(
      _cameraController.value.getMaxScaleOnAxis(),
      math.max(2, _minimumCameraScale * 4),
    ),
    constrained: false,
    boundaryMargin: EdgeInsets.zero,
    child: child,
  );
  Widget _tile(int column, int row) {
    final bytes = _tiles[(column, row)];
    return bytes == null
        ? const Center(child: Icon(Icons.map_outlined))
        : Image.memory(
            bytes,
            gaplessPlayback: false,
            errorBuilder: (_, error, stack) =>
                const Center(child: Icon(Icons.broken_image_outlined)),
          );
  }

  Widget _marker(Offset point, IconData icon, Color color) => Positioned(
    left: point.dx - 18,
    top: point.dy - 18,
    width: 36,
    height: 36,
    child: DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        border: Border.all(color: color, width: 2),
      ),
      child: Icon(icon, color: color, size: 24),
    ),
  );
  @override
  void dispose() {
    unawaited(_owners?.cancel());
    WidgetsBinding.instance.removeObserver(this);
    _epoch++;
    _expiry?.cancel();
    _tiles.clear();
    _cameraController.dispose();
    super.dispose();
  }
}

class _RoutePainter extends CustomPainter {
  const _RoutePainter({required this.points, required this.color});
  final List<Offset> points;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) return;
    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (final point in points.skip(1)) {
      path.lineTo(point.dx, point.dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..strokeWidth = 5
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(_RoutePainter old) =>
      old.points != points || old.color != color;
}
