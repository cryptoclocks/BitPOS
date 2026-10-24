import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

class AddressPinPage extends StatefulWidget {
  const AddressPinPage({
    super.key,
    required this.thai,
    this.latitudeE7,
    this.longitudeE7,
  });

  final bool thai;
  final int? latitudeE7;
  final int? longitudeE7;

  @override
  State<AddressPinPage> createState() => _AddressPinPageState();
}

class _AddressPinPageState extends State<AddressPinPage> {
  static const _tileTemplate = String.fromEnvironment('BITPOS_MAP_TILE_URL');
  static const _tileAttribution = String.fromEnvironment(
    'BITPOS_MAP_ATTRIBUTION',
  );
  static const _defaultLatitudeE7 = 137563000;
  static const _defaultLongitudeE7 = 1005018000;

  late final TextEditingController _latitude = TextEditingController(
    text: _coordinate(widget.latitudeE7),
  );
  late final TextEditingController _longitude = TextEditingController(
    text: _coordinate(widget.longitudeE7),
  );
  final _form = GlobalKey<FormState>();
  late final MapController _mapController = MapController();
  late LatLng _mapCenter = LatLng(
    (widget.latitudeE7 ?? _defaultLatitudeE7) / 10000000,
    (widget.longitudeE7 ?? _defaultLongitudeE7) / 10000000,
  );

  bool get _hasConfiguredTiles =>
      _tileTemplate.startsWith('https://') &&
      _tileTemplate.contains('{z}') &&
      _tileTemplate.contains('{x}') &&
      _tileTemplate.contains('{y}') &&
      _tileAttribution.trim().isNotEmpty;

  String t(String th, String en) => widget.thai ? th : en;

  String _coordinate(int? value) {
    if (value == null) return '';
    final absolute = value.abs();
    final fraction = (absolute % 10000000)
        .toString()
        .padLeft(7, '0')
        .replaceFirst(RegExp(r'0+$'), '');
    return '${value < 0 ? '-' : ''}${absolute ~/ 10000000}${fraction.isEmpty ? '' : '.$fraction'}';
  }

  int? _parse(String value, {required bool latitude}) {
    final match = RegExp(r'^(-?)([0-9]{1,3})(?:\.([0-9]{1,7}))?$')
        .firstMatch(value.trim());
    if (match == null) return null;
    final parsed =
        int.parse(match[2]!) * 10000000 +
        int.parse((match[3] ?? '').padRight(7, '0'));
    final signed = match[1] == '-' ? -parsed : parsed;
    final limit = latitude ? 900000000 : 1800000000;
    return signed.abs() <= limit ? signed : null;
  }

  String? _validate(String? value, {required bool latitude}) =>
      _parse(value ?? '', latitude: latitude) != null
      ? null
      : t('ระบุพิกัดที่ถูกต้อง', 'Enter a valid coordinate');

  void _confirm() {
    if (_hasConfiguredTiles) {
      _latitude.text = _coordinate((_mapCenter.latitude * 10000000).round());
      _longitude.text = _coordinate((_mapCenter.longitude * 10000000).round());
    }
    if (!_form.currentState!.validate()) return;
    Navigator.of(context).pop((
      _parse(_latitude.text, latitude: true),
      _parse(_longitude.text, latitude: false),
    ));
  }

  @override
  void dispose() {
    _latitude.dispose();
    _longitude.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final largeText = MediaQuery.textScalerOf(context).scale(20) - 20;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight:
            (112.0 - MediaQuery.paddingOf(context).top).clamp(48.0, 68.0) +
            largeText * 2,
        leadingWidth: 76,
        titleSpacing: 0,
        leading: Padding(
          padding: const EdgeInsets.only(left: 18, right: 10),
          child: Center(
            child: IconButton.filledTonal(
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
              onPressed: () => Navigator.of(context).maybePop(),
              style: IconButton.styleFrom(
                minimumSize: const Size(48, 48),
                backgroundColor: Theme.of(context).cardTheme.color,
                foregroundColor: colors.primary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              icon: const Icon(Icons.chevron_left, size: 22),
            ),
          ),
        ),
        title: Text(
          t('ปักหมุดจุดรับอาหาร', 'Pin delivery location'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          // Manual fallback needs room for both coordinates, unlike the map-only sheet.
          final sheetHeight =
              ((_hasConfiguredTiles ? 309 : 373) + largeText * 8).clamp(
                0.0,
                constraints.maxHeight * .72,
              );
          return Stack(
            children: [
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                bottom: sheetHeight - 28,
                child: _hasConfiguredTiles
                    ? ClipRect(
                        child: Stack(
                          children: [
                            FlutterMap(
                              key: const ValueKey('configured-address-map'),
                              mapController: _mapController,
                              options: MapOptions(
                                initialCenter: _mapCenter,
                                initialZoom: 16,
                                minZoom: 4,
                                maxZoom: 19,
                                onPositionChanged: (position, _) {
                                  _mapCenter = position.center;
                                },
                              ),
                              children: [
                                TileLayer(
                                  urlTemplate: _tileTemplate,
                                  userAgentPackageName:
                                      'com.cashlessthailand.bitpos',
                                  maxZoom: 19,
                                  panBuffer: 0,
                                ),
                              ],
                            ),
                            Center(
                              child: Padding(
                                padding: const EdgeInsets.only(bottom: 30),
                                child: Icon(
                                  Icons.location_pin,
                                  size: 42,
                                  color: colors.primary,
                                ),
                              ),
                            ),
                            Positioned(
                              left: 12,
                              bottom: 40,
                              right: 12,
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    color: colors.surface.withValues(
                                      alpha: .92,
                                    ),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                      vertical: 4,
                                    ),
                                    child: Text(
                                      _tileAttribution,
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodySmall,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      )
                    : ColoredBox(
                        color: colors.surfaceContainerHighest,
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.all(32),
                          child: Column(
                            children: [
                              Icon(
                                Icons.map_outlined,
                                size: 42,
                                color: colors.onSurfaceVariant,
                              ),
                              const SizedBox(height: 12),
                              Text(
                                t(
                                  'แผนที่ยังไม่พร้อมใช้งาน',
                                  'Map is unavailable',
                                ),
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                t(
                                  'ยังไม่ได้ตั้งค่าผู้ให้บริการแผนที่ คุณระบุพิกัดด้านล่างได้โดยไม่ต้องเปิด GPS',
                                  'A map provider is not configured. Enter coordinates below without using GPS.',
                                ),
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ),
              ),
              Align(
                alignment: Alignment.bottomCenter,
                child: Container(
                  key: const ValueKey('address-pin-sheet'),
                  height: sheetHeight,
                  decoration: BoxDecoration(
                    color: Theme.of(context).cardTheme.color,
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(28),
                    ),
                  ),
                  child: SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(24, 24, 24, 23),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(
                            child: SingleChildScrollView(
                              child: Form(
                                key: _form,
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    Text(
                                      t('พิกัดจุดส่ง', 'Delivery pin'),
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleLarge,
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      t(
                                        _hasConfiguredTiles
                                            ? 'เลื่อนแผนที่เพื่อเลือกตำแหน่งส่ง'
                                            : 'เลื่อนแผนที่ไม่ได้ในขณะนี้ กรอกละติจูดและลองจิจูดแทนได้',
                                        _hasConfiguredTiles
                                            ? 'Move the map to choose the delivery location.'
                                            : 'Map selection is unavailable. Enter latitude and longitude instead.',
                                      ),
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodySmall,
                                    ),
                                    const SizedBox(height: 12),
                                    if (!_hasConfiguredTiles) ...[
                                      TextFormField(
                                        key: const ValueKey(
                                          'address-pin-latitude',
                                        ),
                                        controller: _latitude,
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                              signed: true,
                                            ),
                                        decoration: InputDecoration(
                                          labelText: t('ละติจูด', 'Latitude'),
                                          hintText: '13.7560000',
                                        ),
                                        validator: (value) =>
                                            _validate(value, latitude: true),
                                      ),
                                      const SizedBox(height: 12),
                                      TextFormField(
                                        key: const ValueKey(
                                          'address-pin-longitude',
                                        ),
                                        controller: _longitude,
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                              signed: true,
                                            ),
                                        decoration: InputDecoration(
                                          labelText: t('ลองจิจูด', 'Longitude'),
                                          hintText: '100.5018000',
                                        ),
                                        validator: (value) =>
                                            _validate(value, latitude: false),
                                      ),
                                      const SizedBox(height: 12),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          FilledButton(
                            key: const ValueKey('address-pin-confirm'),
                            onPressed: _confirm,
                            child: Text(
                              t('ยืนยันตำแหน่งนี้', 'Use this location'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
