import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'mobile_api.dart';
import 'mobile_v1.generated.dart';
import 'owned_route.dart';

/// Authenticated image bytes only. No public URL or shared network-image cache key.
class FoodChatPhoto extends StatefulWidget {
  const FoodChatPhoto({
    super.key,
    required this.api,
    required this.assignmentId,
    required this.image,
    required this.thai,
    required this.onRendered,
  });
  final MobileApi api;
  final String assignmentId;
  final FoodChatAttachment image;
  final bool thai;
  final VoidCallback onRendered;
  @override
  State<FoodChatPhoto> createState() => _FoodChatPhotoState();
}

class _FoodChatPhotoState extends State<FoodChatPhoto>
    with WidgetsBindingObserver {
  late final owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? changes;
  MemoryImage? provider;
  Uint8List? data;
  DialogRoute<void>? preview;
  int epoch = 0;
  bool foreground = true,
      retired = false,
      busy = false,
      failed = false,
      notified = false;
  String t(String th, String en) => widget.thai ? th : en;
  bool get current =>
      mounted &&
      !retired &&
      foreground &&
      widget.api.signedIn &&
      widget.api.sessionScope == owner;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    changes = widget.api.sessionScopes.listen((next) {
      if (mounted && next != owner) {
        clear();
        setState(() => retired = true);
      }
    });
    unawaited(load());
  }

  void clear() {
    epoch++;
    final old = provider;
    provider = null;
    data = null;
    notified = false;
    busy = false;
    final route = preview;
    preview = null;
    removeOwnedRoute(route);
    if (old != null) unawaited(old.evict());
  }

  @override
  void didUpdateWidget(FoodChatPhoto old) {
    super.didUpdateWidget(old);
    if (old.assignmentId != widget.assignmentId ||
        old.image.id != widget.image.id ||
        !identical(old.api, widget.api) ||
        old.image.sha256 != widget.image.sha256 ||
        old.image.state != widget.image.state) {
      clear();
      unawaited(load());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    if (!mounted) return;
    clear();
    setState(() {});
    if (current) unawaited(load());
  }

  Future<void> load() async {
    if (!current || busy || widget.image.state != 'READY') return;
    final run = ++epoch;
    setState(() {
      busy = true;
      failed = false;
    });
    try {
      final bytes = await widget.api.foodChatImage(
        widget.assignmentId,
        widget.image,
      );
      if (!current || run != epoch) return;
      setState(() {
        data = bytes;
        provider = MemoryImage(bytes);
      });
    } catch (_) {
      if (current && run == epoch) setState(() => failed = true);
    } finally {
      if (current && run == epoch) setState(() => busy = false);
    }
  }

  void rendered() {
    if (notified) return;
    notified = true;
    final run = epoch;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (current && run == epoch) widget.onRendered();
    });
  }

  Future<void> open() async {
    final image = provider;
    if (!current || image == null || preview != null) return;
    final route = DialogRoute<void>(
      context: context,
      builder: (context) => Dialog.fullscreen(
        child: Scaffold(
          appBar: AppBar(
            title: Text(t('รูปภาพ', 'Photo')),
            leading: IconButton(
              tooltip: t('ปิด', 'Close'),
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.close),
            ),
          ),
          body: Center(
            child: InteractiveViewer(
              minScale: 1,
              maxScale: 4,
              child: Image(image: image, fit: BoxFit.contain),
            ),
          ),
        ),
      ),
    );
    preview = route;
    try {
      await Navigator.of(context).push(route);
    } finally {
      if (identical(preview, route)) preview = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (retired || !foreground) return const SizedBox.shrink();
    final image = provider;
    return Semantics(
      label: t('รูปแนบในแชต', 'Chat photo attachment'),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 240),
        child: AspectRatio(
          aspectRatio: widget.image.width / widget.image.height,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: ColoredBox(
              color: const Color(0xFFEFE6F8),
              child: widget.image.state != 'READY'
                  ? Center(
                      child: Text(
                        t('รูปภาพไม่พร้อมใช้งาน', 'Photo unavailable'),
                      ),
                    )
                  : image == null
                  ? Center(
                      child: failed
                          ? TextButton.icon(
                              onPressed: busy ? null : load,
                              icon: const Icon(Icons.refresh),
                              label: Text(t('โหลดรูปใหม่', 'Retry photo')),
                            )
                          : const CircularProgressIndicator(),
                    )
                  : InkWell(
                      onTap: open,
                      child: Image(
                        image: image,
                        fit: BoxFit.contain,
                        gaplessPlayback: false,
                        frameBuilder: (context, child, frame, synchronous) {
                          if (frame != null || synchronous) {
                            rendered();
                            return child;
                          }
                          return const Center(
                            child: CircularProgressIndicator(),
                          );
                        },
                        errorBuilder: (_, error, stack) => Center(
                          child: Text(
                            t('เปิดรูปภาพไม่ได้', 'Photo could not be opened'),
                          ),
                        ),
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    clear();
    unawaited(changes?.cancel());
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
