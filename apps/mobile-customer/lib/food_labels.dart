import 'package:mobile_shared/mobile_api.dart';

String foodStateLabel(String state, bool thai) {
  final labels = switch (state) {
    'AWAITING_WALLET' => ('รอเลือกวิธีชำระเงิน', 'Awaiting payment method'),
    'AWAITING_PAYMENT' => ('รอชำระเงิน', 'Awaiting payment'),
    'CONFIRMING' => ('กำลังตรวจสอบการชำระเงิน', 'Verifying payment'),
    'PAID' => ('ยืนยันการชำระเงินแล้ว', 'Payment verified'),
    'EXPIRED' => ('ออเดอร์หมดอายุ', 'Order expired'),
    'RECOVERY' => ('ต้องตรวจสอบการชำระเงิน', 'Payment needs review'),
    'PENDING' => ('รอร้านรับออเดอร์', 'Awaiting merchant acceptance'),
    'ACCEPTED' => ('ร้านรับออเดอร์แล้ว', 'Accepted by merchant'),
    'REJECTED' => ('ร้านปฏิเสธออเดอร์', 'Rejected by merchant'),
    'TIMED_OUT' => ('หมดเวลาร้านรับออเดอร์', 'Merchant acceptance timed out'),
    'RECEIVED' => ('ร้านได้รับออเดอร์', 'Received by store'),
    'PREPARING' => ('ร้านกำลังเตรียมอาหาร', 'Preparing food'),
    'READY' => ('อาหารพร้อมรับที่ร้าน', 'Ready for store pickup'),
    'COLLECTED' => ('รับอาหารจากร้านแล้ว', 'Collected at store'),
    'CREATED' => ('สร้างออเดอร์', 'Order created'),
    'SNAPSHOT_BASELINE' => ('สถานะออเดอร์ที่บันทึกไว้', 'Saved order state'),
    'PAYMENT' => ('อัปเดตการชำระเงิน', 'Payment update'),
    'ACCEPTANCE' => (
      'อัปเดตการรับออเดอร์ของร้าน',
      'Merchant acceptance update',
    ),
    'KITCHEN' => ('อัปเดตการเตรียมอาหาร', 'Kitchen update'),
    'REFUND' => (
      'บันทึกภาระคืนเงิน ยังไม่ยืนยันการโอนคืน',
      'Refund obligation recorded; transfer not confirmed',
    ),
    _ => (
      'ไม่ทราบสถานะ กรุณาอัปเดตจากเซิร์ฟเวอร์',
      'Status unavailable. Refresh server status.',
    ),
  };
  return thai ? labels.$1 : labels.$2;
}

/// Compact but truthful status text for one-line Activity cards.
String foodActivityStateLabel(String state, bool thai) {
  final labels = switch (state) {
    'AWAITING_WALLET' || 'AWAITING_PAYMENT' => ('รอชำระเงิน', 'Payment due'),
    'CONFIRMING' => ('กำลังตรวจสอบ', 'Verifying payment'),
    'PAID' => ('ชำระแล้ว', 'Paid'),
    'EXPIRED' => ('หมดอายุ', 'Expired'),
    'RECOVERY' => ('ตรวจสอบสถานะ', 'Review needed'),
    'PENDING' => ('รอร้านยืนยัน', 'Awaiting store'),
    'ACCEPTED' => ('ร้านยืนยันแล้ว', 'Accepted'),
    'REJECTED' => ('ร้านปฏิเสธ', 'Rejected'),
    'TIMED_OUT' => ('ร้านไม่ตอบรับ', 'Timed out'),
    'RECEIVED' => ('ร้านได้รับแล้ว', 'Received'),
    'PREPARING' => ('กำลังเตรียม', 'Preparing'),
    'READY' => ('พร้อมรับ', 'Ready'),
    'COLLECTED' => ('รับแล้ว', 'Collected'),
    _ => null,
  };
  return labels == null
      ? foodStateLabel(state, thai)
      : thai
      ? labels.$1
      : labels.$2;
}

String foodErrorMessage(Object error, bool thai) {
  final code = error is MobileApiException ? error.code : 'NETWORK';
  final labels = switch (code) {
    'STOCK_UNAVAILABLE' => (
      'สินค้าคงเหลือเปลี่ยน กรุณาตรวจตะกร้าใหม่',
      'Stock changed. Review your cart.',
    ),
    'QUOTE_EXPIRED' || 'PRICE_VERSION_CHANGED' || 'QUOTE_CHANGED' => (
      'ราคาเดิมหมดอายุ กรุณาขอราคาใหม่',
      'Quote expired or changed. Request a fresh quote.',
    ),
    'AUTH_REQUIRED' => ('กรุณาเข้าสู่ระบบใหม่', 'Please sign in again.'),
    'PAYMENT_CONFIGURATION_REQUIRED' => (
      'ยังไม่ตั้งค่าช่องทางชำระเงิน กรุณาติดต่อผู้ดูแล',
      'Payment unavailable: checkout configuration required.',
    ),
    'PAYMENT_DESTINATION_INVALID' => (
      'ไม่สามารถเปิดปลายทางชำระเงินนี้ได้ กรุณาอัปเดตสถานะออเดอร์',
      'Checkout destination rejected. Refresh the original order.',
    ),
    'PAYMENT_APP_UNAVAILABLE' => (
      'เปิดแอปชำระเงินไม่ได้ กรุณาตรวจสอบเบราว์เซอร์แล้วลองออเดอร์เดิม',
      'Could not open checkout. Check your browser and retry the original order.',
    ),
    'PENDING_ORDER_RECOVERY_REQUIRED' => (
      'กู้คืนคำขอเดิมก่อนสร้างออเดอร์ใหม่',
      'Recover the saved request before creating another order.',
    ),
    'SERVING_UNAVAILABLE' => (
      'ร้านยังไม่เปิดรับออเดอร์ประเภทนี้ กรุณาเลือกร้านอื่น',
      'This service is unavailable. Choose another merchant.',
    ),
    'RESOURCE_NOT_FOUND' => (
      'ไม่พบรายการ กรุณาอัปเดตจากเซิร์ฟเวอร์',
      'Item unavailable. Refresh server data.',
    ),
    'PROVIDER_RATE_LIMITED' => (
      'ส่งคำขอบ่อยเกินไป กรุณารอก่อนลองใหม่',
      'Too many requests. Wait before retrying.',
    ),
    'DISCOVERY_FAILED' => (
      'โหลดร้านไม่สำเร็จ กรุณาลองใหม่',
      'Could not load merchants. Retry.',
    ),
    'NETWORK' => (
      'เชื่อมต่อไม่ได้ หากส่งออเดอร์แล้วให้ลองคำขอเดิมเท่านั้น',
      'Connection unavailable. If submitted, retry only the saved request.',
    ),
    _ => (
      'ทำรายการไม่สำเร็จ กรุณาอัปเดตสถานะก่อนลองคำขอเดิม',
      'Request failed. Refresh status before retrying the saved request.',
    ),
  };
  return thai ? labels.$1 : labels.$2;
}

/// Prefer the selected language, then an existing source name, never a blank card.
String merchantBranchLabel({
  required bool thai,
  required String name,
  required String nameEn,
  required String merchantName,
}) {
  for (final candidate in [
    if (thai) name else nameEn,
    if (thai) nameEn else name,
    merchantName,
  ]) {
    if (candidate.trim().isNotEmpty) return candidate.trim();
  }
  return thai ? 'สาขายังไม่มีชื่อ' : 'Unnamed branch';
}
