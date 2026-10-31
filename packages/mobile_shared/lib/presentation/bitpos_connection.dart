import 'dart:async';

import 'package:flutter/material.dart';

import '../mobile_api.dart';

/// App-wide registry so one calm banner can cover every route. The session
/// pages publish their [MobileApi] and UI language here.
class BitPosConnection {
  BitPosConnection._();
  static final ValueNotifier<MobileApi?> api = ValueNotifier<MobileApi?>(null);
  static final ValueNotifier<bool> thai = ValueNotifier<bool>(true);

  static void useApi(MobileApi? value) {
    if (identical(api.value, value)) return;
    api.value = value;
  }

  /// Safe to call from build: notifies after the frame.
  static void useThai(bool value) {
    if (thai.value == value) return;
    WidgetsBinding.instance.addPostFrameCallback((_) => thai.value = value);
  }
}

/// Wrap `MaterialApp.builder`'s child: shows one non-scary "reconnecting" strip
/// while the server cannot be reached, probes with backoff, and probes at once
/// when the app returns to the foreground.
class BitPosConnectionHost extends StatefulWidget {
  const BitPosConnectionHost({super.key, required this.child});
  final Widget? child;
  @override
  State<BitPosConnectionHost> createState() => _BitPosConnectionHostState();
}

class _BitPosConnectionHostState extends State<BitPosConnectionHost>
    with WidgetsBindingObserver {
  MobileApi? _api;
  Timer? _timer;
  int _attempt = 0;
  bool _probing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    BitPosConnection.api.addListener(_apiChanged);
    _bind(BitPosConnection.api.value);
  }

  void _apiChanged() => _bind(BitPosConnection.api.value);

  void _bind(MobileApi? next) {
    if (identical(next, _api)) return;
    _api?.connected.removeListener(_connectionChanged);
    _api = next;
    _api?.connected.addListener(_connectionChanged);
    _connectionChanged();
  }

  void _connectionChanged() {
    _timer?.cancel();
    final api = _api;
    if (api == null || api.connected.value) {
      _attempt = 0;
      if (mounted) setState(() {});
      return;
    }
    _schedule();
    if (mounted) setState(() {});
  }

  void _schedule() {
    _timer?.cancel();
    const steps = [2, 4, 8, 15];
    final seconds = steps[_attempt < steps.length ? _attempt : steps.length - 1];
    _timer = Timer(Duration(seconds: seconds), _probe);
  }

  Future<void> _probe() async {
    final api = _api;
    if (api == null || _probing || !mounted) return;
    _probing = true;
    try {
      await api.probe();
    } finally {
      _probing = false;
    }
    if (!mounted) return;
    if (!api.connected.value) {
      _attempt++;
      _schedule();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final api = _api;
    if (state != AppLifecycleState.resumed || api == null) return;
    // Foreground return: confirm reachability right away (also refreshes pages
    // through MobileApi.reconnects when the link had dropped while away).
    _attempt = 0;
    unawaited(_probe());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _api?.connected.removeListener(_connectionChanged);
    BitPosConnection.api.removeListener(_apiChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final child = widget.child ?? const SizedBox.shrink();
    final offline = _api != null && !_api!.connected.value;
    final theme = Theme.of(context);
    final top = MediaQuery.of(context).padding.top;
    // Stable tree shape: the navigator below must never be remounted.
    return Column(
      children: [
        if (offline)
          Material(
            color: theme.colorScheme.secondaryContainer,
            child: Padding(
              padding: EdgeInsets.fromLTRB(16, top + 6, 16, 6),
              child: Semantics(
                liveRegion: true,
                child: ValueListenableBuilder<bool>(
                  valueListenable: BitPosConnection.thai,
                  builder: (_, thai, _) => Row(
                    key: const ValueKey('bitpos-connection-banner'),
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: 10),
                      Flexible(
                        child: Text(
                          thai ? 'กำลังเชื่อมต่อใหม่...' : 'Reconnecting...',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSecondaryContainer,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          )
        else
          const SizedBox.shrink(key: ValueKey('bitpos-connection-none')),
        Expanded(
          key: const ValueKey('bitpos-connection-body'),
          child: MediaQuery.removePadding(
            context: context,
            removeTop: offline,
            child: child,
          ),
        ),
      ],
    );
  }
}
