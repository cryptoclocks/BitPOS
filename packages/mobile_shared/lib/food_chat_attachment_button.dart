import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

import 'food_chat_upload_draft.dart';
import 'food_chat_upload_recovery.dart';
import 'mobile_api.dart';
import 'mobile_v1.generated.dart';

/// Explicit picker/recovery action. Original gallery files are never deleted.
class FoodChatAttachmentButton extends StatefulWidget {
  const FoodChatAttachmentButton({
    super.key,
    required this.api,
    required this.assignmentId,
    required this.thai,
    required this.enabled,
    required this.onChanged,
    required this.onBusy,
    this.embedded = false,
    this.slotIndex = 0,
    this.pickImage,
    this.draftStore,
    this.draftStoreForSlot,
    this.onSlotChanged,
  }) : assert(slotIndex >= 0 && slotIndex < 4);
  final MobileApi api;
  final String assignmentId;
  final bool thai, enabled, embedded;
  final int slotIndex;
  final ValueChanged<FoodChatUpload?> onChanged;
  final ValueChanged<bool> onBusy;
  final Future<XFile?> Function()? pickImage;
  final Future<FoodChatUploadDraftStore> Function()? draftStore;
  final Future<FoodChatUploadDraftStore> Function(int)? draftStoreForSlot;
  final void Function(int, FoodChatUpload?)? onSlotChanged;
  @override
  State<FoodChatAttachmentButton> createState() =>
      FoodChatAttachmentButtonState();
}

class FoodChatAttachmentButtonState extends State<FoodChatAttachmentButton> {
  late final owner = widget.api.sessionScope;
  final stores = <int, FoodChatUploadDraftStore>{};
  static bool picking = false;
  StreamSubscription<({String accountId, String sessionId})?>? owners;
  bool busy = false;
  String? error;
  String get intentKey => 'bitpos.chatPicker.active';
  String intentFor(int slot) => jsonEncode({
    'account': owner?.accountId,
    'session': owner?.sessionId,
    'assignment': widget.assignmentId,
    if (slot > 0) 'slot': slot,
  });
  @override
  void initState() {
    super.initState();
    owners = widget.api.sessionScopes.listen((next) {
      if (next != owner) unawaited(discardAll().catchError((Object _) {}));
    });
  }

  @override
  void dispose() {
    unawaited(owners?.cancel());
    super.dispose();
  }

  bool get owned =>
      mounted &&
      owner != null &&
      widget.api.signedIn &&
      widget.api.sessionScope == owner;
  String t(String th, String en) => widget.thai ? th : en;
  Future<FoodChatUploadDraftStore> storage({int? slot}) async {
    final index = slot ?? widget.slotIndex;
    if (stores[index] != null) return stores[index]!;
    if (widget.draftStoreForSlot != null) {
      return stores[index] = await widget.draftStoreForSlot!(index);
    }
    if (widget.draftStore != null) {
      return stores[index] = await widget.draftStore!();
    }
    final base = await getApplicationSupportDirectory();
    final root = Directory(
      Platform.isAndroid
          ? '${base.parent.path}/no_backup/bitpos-chat'
          : '${base.path}/bitpos-chat',
    );
    return stores[index] = FoodChatUploadDraftStore(
      index == 0 ? root : Directory('${root.path}/slot-$index'),
    );
  }

  void publish(int slot, FoodChatUpload? value) {
    if (widget.onSlotChanged != null) {
      widget.onSlotChanged!(slot, value);
    } else {
      widget.onChanged(value);
    }
  }

  Future<FoodChatUpload?> recoverSaved(int slot) async {
    if (!owned) return null;
    final saved = await storage(slot: slot);
    if (!owned) return null;
    return FoodChatUploadRecovery(
      api: widget.api,
      store: saved,
      assignmentId: widget.assignmentId,
    ).recover();
  }

  Future<void> discardAll() async {
    for (var slot = 0; slot < 4; slot++) {
      await discard(slot: slot);
    }
  }

  Future<void> discard({int? slot}) async {
    if (owner == null) {
      return;
    }
    final index = slot ?? widget.slotIndex, saved = await storage(slot: index);
    await saved.discard(
      account: owner!.accountId,
      session: owner!.sessionId,
      assignment: widget.assignmentId,
    );
    if (await widget.api.storage.read(key: intentKey) == intentFor(index)) {
      await widget.api.storage.delete(key: intentKey);
    }
    if (owned) {
      setState(() => error = null);
      publish(index, null);
    }
  }

  Future<void> choose() async {
    if (!owned || busy || picking || !widget.enabled) return;
    final slot = widget.slotIndex, intentValue = intentFor(widget.slotIndex);
    picking = true;
    setState(() {
      busy = true;
      error = null;
    });
    widget.onBusy(true);
    try {
      final saved = await storage(slot: slot);
      if (!owned) return;
      var draft = await saved.recover(
        account: owner!.accountId,
        session: owner!.sessionId,
        assignment: widget.assignmentId,
      );
      if (!owned) return;
      if (draft == null) {
        final picker = ImagePicker();
        XFile? selected;
        final intent = await widget.api.storage.read(key: intentKey);
        if (!owned) return;
        if (intent != null && Platform.isAndroid) {
          final lost = await picker.retrieveLostData();
          if (!owned) return;
          if (lost.exception != null) throw lost.exception!;
          if (intent == intentValue && lost.files?.isNotEmpty == true) {
            selected = lost.files!.first;
          }
        }
        if (selected == null) {
          await widget.api.storage.write(key: intentKey, value: intentValue);
          if (!owned) return;
          selected = widget.pickImage != null
              ? await widget.pickImage!()
              : await picker.pickImage(
                  source: ImageSource.gallery,
                  maxWidth: 1280,
                  maxHeight: 1280,
                  imageQuality: 85,
                  requestFullMetadata: false,
                );
        }
        if (!owned) return;
        if (selected == null) {
          await widget.api.storage.delete(key: intentKey);
          return;
        }
        if (await selected.length() > 4 * 1024 * 1024) {
          throw const FormatException('Image too large');
        }
        final bytes = await selected.readAsBytes();
        if (!owned) return;
        final mime =
            bytes.length >= 3 &&
                bytes[0] == 255 &&
                bytes[1] == 216 &&
                bytes[2] == 255
            ? 'image/jpeg'
            : bytes.length >= 8 &&
                  bytes[0] == 137 &&
                  bytes[1] == 80 &&
                  bytes[2] == 78 &&
                  bytes[3] == 71
            ? 'image/png'
            : null;
        if (mime == null) throw const FormatException('JPEG or PNG required');
        await saved.save(
          account: owner!.accountId,
          session: owner!.sessionId,
          assignment: widget.assignmentId,
          bytes: bytes,
          mime: mime,
        );
        await widget.api.storage.delete(key: intentKey);
        if (!owned) {
          await saved.discard(
            account: owner!.accountId,
            session: owner!.sessionId,
            assignment: widget.assignmentId,
          );
          return;
        }
      }
      final upload = await FoodChatUploadRecovery(
        api: widget.api,
        store: saved,
        assignmentId: widget.assignmentId,
      ).recover();
      if (owned) publish(slot, upload);
    } catch (_) {
      if (owned) {
        setState(
          () => error = t(
            'แนบรูปไม่ได้ แตะเพื่อลองกู้คืน',
            'Photo unavailable. Tap to recover.',
          ),
        );
      }
    } finally {
      picking = false;
      if (mounted) {
        setState(() => busy = false);
        widget.onBusy(false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return SizedBox(
        width: 48,
        height: 52,
        child: PopupMenuButton<bool>(
          tooltip: error,
          enabled: widget.enabled && !busy,
          icon: const Icon(Icons.refresh),
          onSelected: (retry) async {
            if (!owned || !widget.enabled || busy) return;
            if (retry) {
              await choose();
            } else {
              try {
                await discard();
              } catch (_) {
                if (owned) {
                  setState(
                    () => error = t(
                      'ล้างรูปค้างไม่ได้ ลองใหม่',
                      'Could not clear photo. Try again.',
                    ),
                  );
                }
              }
            }
          },
          itemBuilder: (_) => [
            PopupMenuItem(
              value: true,
              child: Text(t('กู้คืนรูปเดิม', 'Recover saved photo')),
            ),
            PopupMenuItem(
              value: false,
              child: Text(t('ล้างรูปที่ยังไม่ส่ง', 'Discard unsent photo')),
            ),
          ],
        ),
      );
    }
    return IconButton(
      tooltip: error ?? t('แนบหรือกู้คืนรูป', 'Attach or recover photo'),
      onPressed: widget.enabled && !busy ? choose : null,
      style: IconButton.styleFrom(
        minimumSize: const Size(48, 52),
        foregroundColor: const Color(0xFF64188A),
        side: widget.embedded
            ? BorderSide.none
            : const BorderSide(color: Color(0xFFE9E1F1)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      icon: busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(
              error == null
                  ? Icons.add_photo_alternate_outlined
                  : Icons.refresh,
            ),
    );
  }
}
