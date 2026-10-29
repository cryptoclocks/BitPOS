import 'mobile_api.dart';
import 'mobile_v1.generated.dart';
import 'food_chat_upload_draft.dart';

/// Recovers the original upload first; transport failures never create a new ID.
/// Draft bytes remain until the caller receives its canonical message receipt.
class FoodChatUploadRecovery {
  FoodChatUploadRecovery({
    required this.api,
    required this.store,
    required this.assignmentId,
  }) : owner = api.sessionScope;
  final MobileApi api;
  final FoodChatUploadDraftStore store;
  final String assignmentId;
  final ({String accountId, String sessionId})? owner;
  Future<FoodChatUpload?>? _running;

  void _check() {
    if (owner == null || !api.signedIn || api.sessionScope != owner) {
      throw const MobileApiException('SESSION_CHANGED', 409);
    }
  }

  Future<FoodChatUpload?> recover() =>
      _running ??= _recover().whenComplete(() => _running = null);

  Future<FoodChatUpload?> _recover() async {
    _check();
    final saved = await store.recover(
      account: owner!.accountId,
      session: owner!.sessionId,
      assignment: assignmentId,
    );
    _check();
    if (saved == null) return null;
    FoodChatUpload receipt;
    try {
      receipt = await api.recoverFoodChatUpload(
        assignmentId,
        saved.draft.commandId,
      );
    } on MobileApiException catch (error) {
      _check();
      // A positive command-not-found response alone permits an upload. Timeouts,
      // auth errors, expiry and malformed responses leave the original draft.
      if (error.status != 404 || error.code != 'RESOURCE_NOT_FOUND') rethrow;
      receipt = await api.uploadFoodChatImage(
        assignmentId,
        saved.draft.commandId,
        saved.bytes,
        saved.draft.mime,
      );
    }
    _check();
    if (receipt.assignmentId != assignmentId ||
        receipt.state != 'READY' ||
        !DateTime.parse(receipt.expiresAt).isAfter(DateTime.now())) {
      throw const MobileApiException('CHAT_IMAGE_EXPIRED', 410);
    }
    return receipt;
  }
}
