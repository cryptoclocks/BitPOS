import 'dart:async';

import 'package:image_picker/image_picker.dart';

import 'food_chat_upload_draft.dart';

import 'package:flutter/material.dart';

import 'mobile_api.dart';
import 'food_chat_photo.dart';
import 'food_chat_attachment_button.dart';
import 'mobile_v1.generated.dart';

/// U29/R19 text conversation; no invented presence, ETA, read receipt or call state.
class FoodChatPageView extends StatefulWidget {
  const FoodChatPageView({
    super.key,
    required this.api,
    required this.assignmentId,
    required this.thai,
    required this.rider,
    this.pickImage,
    this.attachmentDraftStore,
    this.bottomNavigationBar,
  });
  final MobileApi api;
  final String assignmentId;
  final bool thai, rider;
  final Future<XFile?> Function()? pickImage;
  final Future<FoodChatUploadDraftStore> Function(int slot)?
  attachmentDraftStore;
  final Widget? bottomNavigationBar;
  @override
  State<FoodChatPageView> createState() => _FoodChatPageViewState();
}

class _FoodChatPageViewState extends State<FoodChatPageView>
    with WidgetsBindingObserver {
  final composer = TextEditingController();
  final chatScroll = ScrollController();
  final attachmentButton = GlobalKey<FoodChatAttachmentButtonState>();
  final selectedUploads = <int, FoodChatUpload>{};
  bool attachmentBusy = false,
      recoveringUploads = false,
      attachmentRecoveryFailed = false;
  final readViewport = GlobalKey();
  final messageKeys = <String, GlobalKey>{};
  final renderedPhotos = <String>{};
  BigInt ownReadSequence = BigInt.zero, peerReadSequence = BigInt.zero;
  bool readScheduled = false, readPosting = false;
  bool holdReadUntilInitialPosition = false;

  final messages = <String, FoodChatMessage>{};
  FoodChatPage? page;
  FoodChatSendCommand? pending;
  bool busy = false, retired = false, unavailable = false;
  int epoch = 0, watchEpoch = 0;
  bool foreground = true, syncRequested = false;
  BigInt seenSequence = BigInt.zero, wantedSequence = BigInt.zero;
  StreamSubscription<FoodRealtimeState<FoodChatRealtimeSnapshot>>? updates;
  late final owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? changes;
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
        stopWatch();
        epoch++;
        composer.clear();
        setState(() {
          selectedUploads.clear();
          attachmentBusy = false;
          retired = true;
          messages.clear();
          messageKeys.clear();
          renderedPhotos.clear();
          peerReadSequence = BigInt.zero;
          page = null;
          pending = null;
          busy = false;
        });
      }
    });
    unawaited(load());
    startWatch();
  }

  void stopWatch() {
    watchEpoch++;
    unawaited(updates?.cancel());
    updates = null;
  }

  void startWatch() {
    stopWatch();
    if (!current) return;
    final watching = watchEpoch;
    updates = widget.api.watchFoodChat(widget.assignmentId).listen((state) {
      if (!current || watching != watchEpoch) return;
      final signal = state.snapshot;
      if (signal == null) {
        epoch++;
        final failure = state.error;
        // A reconnect is not an owner change. Keep the foreground unsent draft;
        // the history still retires until authority is reconciled. Definitive
        // denial, background and account loss clear private input separately.
        if (failure is MobileApiException &&
            [401, 403, 404, 410].contains(failure.status)) {
          composer.clear();
          selectedUploads.clear();
        }
        setState(() {
          messages.clear();
          messageKeys.clear();
          renderedPhotos.clear();
          peerReadSequence = BigInt.zero;
          page = null;
          busy = false;
          unavailable = state.error != null;
        });
        return;
      }
      if (signal.assignmentId != widget.assignmentId) return;
      setState(() => peerReadSequence = BigInt.parse(signal.peerReadSequence));
      wantedSequence = BigInt.parse(signal.latestSequence);
      if (busy) {
        syncRequested = true;
        return;
      }
      if (page == null) {
        unawaited(load());
      } else {
        unawaited(sync());
      }
    });
  }

  void drainSignal() {
    if (!syncRequested || !current || busy) return;
    syncRequested = false;
    if (page != null) unawaited(sync());
  }

  bool get isNearLatest =>
      !chatScroll.hasClients ||
      chatScroll.position.maxScrollExtent - chatScroll.position.pixels <= 72;

  void revealLatest({required bool wasNearLatest}) {
    if (!wasNearLatest) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!current) return;
      if (chatScroll.hasClients) {
        chatScroll.jumpTo(chatScroll.position.maxScrollExtent);
      }
      if (holdReadUntilInitialPosition) {
        holdReadUntilInitialPosition = false;
        scheduleRead();
      }
    });
  }

  Future<void> sync() async {
    if (!current || busy || page == null || seenSequence >= wantedSequence) {
      return;
    }
    final run = ++epoch;
    setState(() {
      busy = true;
      unavailable = false;
    });
    try {
      // Bound each reconciliation pass. Further stream heartbeats resume the cursor.
      for (var batch = 0; batch < 4 && seenSequence < wantedSequence; batch++) {
        final result = await widget.api.foodChat(
          widget.assignmentId,
          afterSequence: seenSequence.toString(),
        );
        if (!current || run != epoch) return;
        if (result.assignmentId != widget.assignmentId) {
          throw const FormatException('Chat scope mismatch');
        }
        final wasNearLatest = isNearLatest;
        setState(() {
          for (final message in result.items) {
            messages[message.id] = message;
          }
          seenSequence = BigInt.parse(
            result.nextAfterSequence ?? result.latestSequence,
          );
        });
        revealLatest(wasNearLatest: wasNearLatest);
      }
    } catch (_) {
      if (current && run == epoch) {
        setState(() {
          messages.clear();
          messageKeys.clear();
          renderedPhotos.clear();
          peerReadSequence = BigInt.zero;
          page = null;
          unavailable = true;
        });
      }
    } finally {
      if (current && run == epoch) {
        setState(() => busy = false);
        drainSignal();
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    foreground = state == AppLifecycleState.resumed;
    stopWatch();
    epoch++;
    composer.clear();
    selectedUploads.clear();
    setState(() {
      messages.clear();
      messageKeys.clear();
      renderedPhotos.clear();
      peerReadSequence = BigInt.zero;
      page = null;
      pending = null;
      busy = false;
    });
    if (state == AppLifecycleState.resumed && current) {
      unawaited(load());
      startWatch();
    }
  }

  Future<void> load({bool more = false}) async {
    if (!current || busy) return;
    final shouldRevealLatest = !more;
    if (!more) holdReadUntilInitialPosition = true;
    final run = ++epoch;
    setState(() {
      busy = true;
      unavailable = false;
      if (!more) {
        messages.clear();
        page = null;
      }
    });
    try {
      final saved = await widget.api.pendingFoodChatMessage(
        widget.assignmentId,
      );
      if (!current || run != epoch) return;
      final result = await widget.api.foodChat(
        widget.assignmentId,
        beforeSequence: more ? page?.nextBeforeSequence ?? '0' : '0',
      );
      if (!current || run != epoch) return;
      if (result.assignmentId != widget.assignmentId) {
        throw const FormatException('Chat scope mismatch');
      }
      setState(() {
        pending = saved;
        page = result;
        if (!more) seenSequence = BigInt.parse(result.latestSequence);
        for (final m in result.items) {
          messages[m.id] = m;
        }
      });
      revealLatest(wasNearLatest: shouldRevealLatest);
    } catch (_) {
      if (current && run == epoch) {
        if (!more) holdReadUntilInitialPosition = false;
        setState(() {
          unavailable = true;
          messages.clear();
          messageKeys.clear();
          renderedPhotos.clear();
          peerReadSequence = BigInt.zero;
          page = null;
        });
      }
    } finally {
      if (current && run == epoch) {
        setState(() => busy = false);
        drainSignal();
      }
    }
  }

  Future<void> adoptUpload(int slot, FoodChatUpload? image) async {
    if (!current) return;
    if (image == null) {
      setState(() => selectedUploads.remove(slot));
      return;
    }
    final run = epoch;
    setState(() {
      recoveringUploads = true;
      attachmentBusy = true;
    });
    try {
      final restored = <int, FoodChatUpload>{};
      for (var index = 0; index < 4; index++) {
        final value = index == slot
            ? image
            : await attachmentButton.currentState?.recoverSaved(index);
        if (!current || run != epoch) return;
        if (value != null) restored[index] = value;
      }
      if (current && run == epoch) {
        setState(() {
          selectedUploads
            ..clear()
            ..addAll(restored);
          attachmentRecoveryFailed = false;
        });
      }
    } catch (_) {
      if (current && run == epoch) {
        setState(() {
          selectedUploads[slot] = image;
          unavailable = true;
          attachmentRecoveryFailed = true;
        });
      }
    } finally {
      recoveringUploads = false;
      if (mounted) setState(() => attachmentBusy = false);
    }
  }

  Future<void> send(FoodChatSendCommand command) async {
    if (!current || busy) return;
    final wasNearLatest = isNearLatest;
    final run = ++epoch;
    setState(() {
      busy = true;
      pending = command;
      unavailable = false;
    });
    try {
      final receipt = await widget.api.sendFoodChat(
        widget.assignmentId,
        command,
      );
      if (!current || run != epoch) return;
      if (command.attachmentIds.isNotEmpty) {
        await attachmentButton.currentState?.discardAll();
        if (!current || run != epoch) return;
      }
      setState(() {
        selectedUploads.clear();
        messages[receipt.id] = receipt;
        pending = null;
        composer.clear();
      });
      revealLatest(wasNearLatest: wasNearLatest);
    } catch (error) {
      if (current && run == epoch) {
        setState(() {
          unavailable = true;
          if (error is MobileApiException &&
              error.status == 410 &&
              error.code == 'CHAT_IMAGE_EXPIRED') {
            pending = null;
            selectedUploads.clear();
          }
          if (error is MobileApiException &&
              [
                'CHAT_UNAVAILABLE',
                'RESOURCE_NOT_FOUND',
                'AUTH_REQUIRED',
              ].contains(error.code)) {
            messages.clear();
            messageKeys.clear();
            renderedPhotos.clear();
            peerReadSequence = BigInt.zero;
            page = null;
            composer.clear();
          }
        });
      }
    } finally {
      if (current && run == epoch) {
        setState(() => busy = false);
        drainSignal();
      }
    }
  }

  void scheduleRead() {
    if (!current || readScheduled) return;
    readScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      readScheduled = false;
      if (current) unawaited(acknowledgeVisible());
    });
    WidgetsBinding.instance.scheduleFrame();
  }

  Future<void> acknowledgeVisible() async {
    if (!current ||
        holdReadUntilInitialPosition ||
        readPosting ||
        page == null ||
        ModalRoute.of(context)?.isCurrent == false) {
      return;
    }
    final viewport = readViewport.currentContext?.findRenderObject();
    if (viewport is! RenderBox || !viewport.attached || !viewport.hasSize) {
      return;
    }
    final visible = viewport.localToGlobal(Offset.zero) & viewport.size;
    var sequence = ownReadSequence;
    for (final message in messages.values) {
      if (message.mine ||
          message.attachments.any(
            (photo) =>
                photo.state == 'READY' && !renderedPhotos.contains(photo.id),
          )) {
        continue;
      }
      final bubble = messageKeys[message.id]?.currentContext
          ?.findRenderObject();
      if (bubble is! RenderBox || !bubble.attached || !bubble.hasSize) continue;
      final rect = bubble.localToGlobal(Offset.zero) & bubble.size;
      // A received sequence is insufficient: require its end to be rendered in this foreground viewport.
      if (rect.overlaps(visible) &&
          rect.bottom <= visible.bottom &&
          rect.bottom > visible.top) {
        final candidate = BigInt.parse(message.sequence);
        if (candidate > sequence) sequence = candidate;
      }
    }
    if (sequence <= ownReadSequence) return;
    readPosting = true;
    var acknowledged = false;
    try {
      final receipt = await widget.api.markFoodChatRead(
        widget.assignmentId,
        sequence.toString(),
      );
      if (!current) return;
      final actual = BigInt.parse(receipt.lastReadSequence);
      if (actual > ownReadSequence) ownReadSequence = actual;
      acknowledged = true;
    } catch (error) {
      if (current &&
          error is MobileApiException &&
          ['CHAT_UNAVAILABLE', 'RESOURCE_NOT_FOUND'].contains(error.code)) {
        setState(() {
          messages.clear();
          messageKeys.clear();
          renderedPhotos.clear();
          page = null;
          peerReadSequence = BigInt.zero;
          unavailable = true;
        });
      }
      // A failed read acknowledgement never becomes a peer read badge or blocks sending.
    } finally {
      readPosting = false;
      if (acknowledged && current) scheduleRead();
    }
  }

  String time(String stamp) {
    final d = DateTime.parse(stamp).toLocal();
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  bool endsChatMinuteGroup(int index, List<FoodChatMessage> ordered) {
    if (index == ordered.length - 1) return true;
    final current = DateTime.parse(ordered[index].createdAt).toLocal();
    final next = DateTime.parse(ordered[index + 1].createdAt).toLocal();
    return current.year != next.year ||
        current.month != next.month ||
        current.day != next.day ||
        current.hour != next.hour ||
        current.minute != next.minute;
  }

  Widget messageRow(
    int index,
    FoodChatMessage message,
    List<FoodChatMessage> ordered,
  ) {
    final groupedTime = endsChatMinuteGroup(index, ordered);
    final isLast = index == ordered.length - 1;
    final bubbleWidth = (message.mine ? 288.0 : 277.0).clamp(
      0.0,
      MediaQuery.sizeOf(context).width - 48,
    );
    return Padding(
      padding: EdgeInsets.only(bottom: isLast ? 0 : 30),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Align(
            alignment: message.mine
                ? Alignment.centerRight
                : Alignment.centerLeft,
            child: Container(
              key: messageKeys.putIfAbsent(message.id, () => GlobalKey()),
              width: bubbleWidth,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: message.mine ? const Color(0xFFEFE6F8) : Colors.white,
                border: message.mine
                    ? null
                    : Border.all(color: const Color(0xFFE9E1F1)),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final photo in message.attachments) ...[
                    FoodChatPhoto(
                      key: ValueKey(photo.id),
                      api: widget.api,
                      assignmentId: widget.assignmentId,
                      image: photo,
                      thai: widget.thai,
                      onRendered: () {
                        if (current &&
                            messages.containsKey(message.id) &&
                            renderedPhotos.add(photo.id)) {
                          scheduleRead();
                        }
                      },
                    ),
                    const SizedBox(height: 8),
                  ],
                  if (message.body.isNotEmpty)
                    SelectableText(
                      message.body,
                      style: const TextStyle(
                        fontSize: 14,
                        height: 1.58,
                        color: Color(0xFF29183F),
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (groupedTime) ...[
            const SizedBox(height: 38),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '${time(message.createdAt)}${message.mine && BigInt.parse(message.sequence) <= peerReadSequence ? ' · ${t('อ่านแล้ว', 'Read')}' : ''}',
                style: const TextStyle(fontSize: 11, color: Color(0xFF7B7088)),
              ),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ordered = messages.values.toList()
      ..sort(
        (a, b) => BigInt.parse(a.sequence).compareTo(BigInt.parse(b.sequence)),
      );
    scheduleRead();
    return Scaffold(
      backgroundColor: const Color(0xFFF8F5FC),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        toolbarHeight: 44,
        titleSpacing: Navigator.of(context).canPop() ? 4 : 24,
        leadingWidth: 72,
        leading: Navigator.of(context).canPop()
            ? Padding(
                padding: const EdgeInsets.only(left: 18),
                child: SizedBox(
                  width: 44,
                  height: 44,
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    style: OutlinedButton.styleFrom(
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      padding: EdgeInsets.zero,
                      side: BorderSide.none,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Container(
                        key: const ValueKey('food-chat-back-visual'),
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          border: Border.all(color: const Color(0xFFE9E1F1)),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        alignment: Alignment.center,
                        child: const Icon(Icons.arrow_back, size: 20),
                      ),
                    ),
                  ),
                ),
              )
            : null,
        title: Text(
          widget.rider
              ? t('คุยกับลูกค้า', 'Chat with customer')
              : t('คุยกับไรเดอร์', 'Chat with rider'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (busy) const LinearProgressIndicator(),
            if (retired)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  t(
                    'เซสชันเปลี่ยนแล้ว กรุณากลับไปเข้าสู่ระบบ',
                    'Session changed. Return and sign in.',
                  ),
                ),
              ),
            if (!retired) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 36, 24, 0),
                child: Container(
                  key: const ValueKey('food-chat-assignment-header'),
                  constraints: const BoxConstraints(minHeight: 82),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: const Color(0xFFE9E1F1)),
                  ),
                  child: Row(
                    children: [
                      const CircleAvatar(
                        radius: 22,
                        backgroundColor: Color(0xFFEFE6F8),
                        child: Icon(
                          Icons.person_outline,
                          color: Color(0xFF64188A),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.rider
                                  ? t('ลูกค้า', 'Customer')
                                  : t('ไรเดอร์', 'Rider'),
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            Text(
                              '${t('งานส่งอาหาร', 'Delivery')} #${widget.assignmentId.substring(0, 8)}',
                              style: const TextStyle(
                                fontSize: 12,
                                color: Color(0xFF7B7088),
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: t('โหลดข้อความล่าสุด', 'Refresh messages'),
                        onPressed: busy ? null : load,
                        icon: const Icon(Icons.refresh),
                      ),
                    ],
                  ),
                ),
              ),
              if (unavailable)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Semantics(
                    liveRegion: true,
                    child: Text(
                      t(
                        'ยังยืนยันข้อความไม่ได้ โหลดใหม่หรือกู้ข้อความที่บันทึกไว้ งานที่สิ้นสุดแล้วอาจปิดแชต',
                        'Messages not confirmed. Refresh or recover your saved message. Ended assignments may close this chat.',
                      ),
                    ),
                  ),
                ),
              Expanded(
                child: NotificationListener<ScrollNotification>(
                  onNotification: (_) {
                    scheduleRead();
                    return false;
                  },
                  child: ListView(
                    key: readViewport,
                    controller: chatScroll,
                    padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
                    children: [
                      if (page?.nextBeforeSequence != null)
                        TextButton(
                          onPressed: busy ? null : () => load(more: true),
                          child: Text(
                            t('โหลดข้อความเพิ่ม', 'Load more messages'),
                          ),
                        ),
                      if (page != null && ordered.isEmpty)
                        Text(t('ยังไม่มีข้อความ', 'No messages yet.')),
                      for (var index = 0; index < ordered.length; index++)
                        messageRow(index, ordered[index], ordered),
                    ],
                  ),
                ),
              ),
              if (selectedUploads.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final entry in selectedUploads.entries)
                        InputChip(
                          key: ValueKey(entry.value.id),
                          avatar: const Icon(Icons.photo_outlined, size: 20),
                          label: Text(
                            selectedUploads.length == 1
                                ? t('แนบรูปแล้ว', 'Photo attached')
                                : t(
                                    'รูปที่ ${selectedUploads.keys.toList().indexOf(entry.key) + 1}',
                                    'Photo ${selectedUploads.keys.toList().indexOf(entry.key) + 1}',
                                  ),
                          ),
                          onDeleted: busy || attachmentBusy || pending != null
                              ? null
                              : () async {
                                  await attachmentButton.currentState?.discard(
                                    slot: entry.key,
                                  );
                                },
                          deleteButtonTooltipMessage: t(
                            'นำรูปออก',
                            'Remove photo',
                          ),
                        ),
                    ],
                  ),
                ),
              if (attachmentRecoveryFailed)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    children: [
                      Text(
                        t(
                          'กู้คืนรูปบางรายการไม่สำเร็จ กรุณากู้คืนหรือเอารูปทั้งหมดออกก่อนส่ง',
                          'Some photos could not be recovered. Recover them or remove all photos before sending.',
                        ),
                      ),
                      TextButton(
                        onPressed: busy || attachmentBusy || pending != null
                            ? null
                            : () async {
                                try {
                                  await attachmentButton.currentState
                                      ?.discardAll();
                                  if (current) {
                                    setState(() {
                                      selectedUploads.clear();
                                      attachmentRecoveryFailed = false;
                                    });
                                  }
                                } catch (_) {
                                  if (current) {
                                    setState(() => unavailable = true);
                                  }
                                }
                              },
                        child: Text(t('นำรูปทั้งหมดออก', 'Remove all photos')),
                      ),
                    ],
                  ),
                ),
              if (pending != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: FilledButton(
                    onPressed: busy ? null : () => send(pending!),
                    child: Text(t('กู้ข้อความเดิม', 'Recover saved message')),
                  ),
                ),
              Padding(
                key: const ValueKey('food-chat-composer'),
                padding: const EdgeInsets.fromLTRB(24, 12, 23, 55),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: composer,
                        enabled: !busy && pending == null && page != null,
                        maxLength: 4000,
                        minLines: 1,
                        maxLines: 5,
                        decoration: InputDecoration(
                          isDense: true,
                          prefixIconConstraints: const BoxConstraints.tightFor(
                            width: 46,
                            height: 52,
                          ),
                          prefixIcon: FoodChatAttachmentButton(
                            key: attachmentButton,
                            embedded: true,
                            slotIndex:
                                List.generate(4, (i) => i)
                                    .where(
                                      (i) => !selectedUploads.containsKey(i),
                                    )
                                    .firstOrNull ??
                                0,
                            pickImage: widget.pickImage,
                            draftStoreForSlot: widget.attachmentDraftStore,
                            api: widget.api,
                            assignmentId: widget.assignmentId,
                            thai: widget.thai,
                            enabled:
                                !busy &&
                                pending == null &&
                                page != null &&
                                selectedUploads.length < 4,
                            onChanged: (_) {},
                            onSlotChanged: (slot, image) =>
                                unawaited(adoptUpload(slot, image)),
                            onBusy: (value) {
                              if (mounted) {
                                setState(
                                  () => attachmentBusy =
                                      value || recoveringUploads,
                                );
                              }
                            },
                          ),
                          hintText: t('พิมพ์ข้อความ…', 'Type a message…'),
                          counterText: '',
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 2,
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: const BorderSide(
                              color: Color(0xFFE9E1F1),
                            ),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: const BorderSide(
                              color: Color(0xFF64188A),
                            ),
                          ),
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 13),
                    IconButton.filled(
                      style: IconButton.styleFrom(
                        fixedSize: const Size(46, 52),
                        padding: EdgeInsets.zero,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      tooltip: t('ส่งข้อความ', 'Send message'),
                      onPressed:
                          busy ||
                              attachmentBusy ||
                              attachmentRecoveryFailed ||
                              pending != null ||
                              page == null
                          ? null
                          : () {
                              if (composer.text.trim().isNotEmpty ||
                                  selectedUploads.isNotEmpty) {
                                unawaited(
                                  send(
                                    widget.api.newFoodChatMessage(
                                      composer.text,
                                      attachmentIds: selectedUploads.values
                                          .map((image) => image.id)
                                          .toList(),
                                    ),
                                  ),
                                );
                              }
                            },
                      icon: const Icon(Icons.arrow_upward),
                      constraints: const BoxConstraints(
                        minWidth: 46,
                        minHeight: 52,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
      bottomNavigationBar: widget.bottomNavigationBar,
    );
  }

  @override
  void dispose() {
    epoch++;
    stopWatch();
    unawaited(changes?.cancel());
    WidgetsBinding.instance.removeObserver(this);
    composer.dispose();
    chatScroll.dispose();
    super.dispose();
  }
}
