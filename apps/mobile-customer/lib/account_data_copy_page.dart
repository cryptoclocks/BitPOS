import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/owned_route.dart';

/// Read-only copy of the caller's own data. Opening the page only reads; nothing
/// is deleted, submitted or marked as a fulfilled privacy request.
class AccountDataCopyPage extends StatefulWidget {
  const AccountDataCopyPage({
    super.key,
    required this.api,
    required this.owner,
    required this.thai,
    required this.onAuthenticationRequired,
  });
  final MobileApi api;
  final ValueListenable<bool> owner;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  @override
  State<AccountDataCopyPage> createState() => _AccountDataCopyPageState();
}

class _AccountDataCopyPageState extends State<AccountDataCopyPage> {
  ModalRoute<dynamic>? route;
  MobileAccountExport? copy;
  String? error;
  bool loading = true;
  bool copied = false;
  String t(String th, String en) => widget.thai ? th : en;
  bool get _current => mounted && widget.owner.value;

  @override
  void initState() {
    super.initState();
    widget.owner.addListener(_ownerChanged);
    unawaited(_load());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    route = ModalRoute.of(context);
    if (!widget.owner.value) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _ownerChanged());
    }
  }

  void _ownerChanged() {
    if (!widget.owner.value) removeOwnedRoute(route);
  }

  @override
  void dispose() {
    widget.owner.removeListener(_ownerChanged);
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
      copied = false;
    });
    try {
      final next = await widget.api.accountExport();
      if (_current) setState(() => copy = next);
    } catch (e) {
      if (!_current) return;
      if (e is MobileApiException && e.code == 'AUTH_REQUIRED') {
        widget.onAuthenticationRequired();
        return;
      }
      setState(
        () => error = t(
          'โหลดสำเนาข้อมูลไม่สำเร็จ ลองอีกครั้ง',
          'Could not load your data copy. Try again.',
        ),
      );
    } finally {
      if (_current) setState(() => loading = false);
    }
  }

  Future<void> _copyJson(MobileAccountExport value) async {
    await Clipboard.setData(
      ClipboardData(
        text: const JsonEncoder.withIndent('  ').convert(value.toJson()),
      ),
    );
    if (_current) setState(() => copied = true);
  }

  Widget _row(IconData icon, String title, String body) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xffe9e1f1)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: const Color(0xffefe6f8),
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(icon, color: const Color(0xff64188a)),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: Color(0xff29183f),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    body,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xff7b7088),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final value = copy;
    return Scaffold(
      backgroundColor: const Color(0xfff8f5fc),
      appBar: AppBar(
        backgroundColor: const Color(0xfff8f5fc),
        toolbarHeight: 72,
        leadingWidth: 76,
        titleSpacing: 0,
        leading: Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 14, 14),
          child: IconButton.filledTonal(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.of(context).maybePop(),
            style: IconButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: const Color(0xff64188a),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: Color(0xffe9e1f1)),
              ),
            ),
            icon: const Icon(Icons.chevron_left, size: 22),
          ),
        ),
        title: Text(
          t('สำเนาข้อมูลของฉัน', 'My data copy'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            t(
              'นี่คือสำเนาข้อมูลของบัญชีคุณ การดูหรือคัดลอกไม่ลบหรือเปลี่ยนข้อมูลใดๆ และไม่ใช่การส่งคำขอลบข้อมูล',
              'This is a copy of your account data. Viewing or copying it does not delete or change anything and is not a deletion request.',
            ),
          ),
          const SizedBox(height: 16),
          if (loading) const LinearProgressIndicator(),
          if (error != null) ...[
            Semantics(liveRegion: true, child: Text(error!)),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: loading ? null : _load,
              child: Text(t('ลองอีกครั้ง', 'Try again')),
            ),
          ],
          if (value != null) ...[
            const SizedBox(height: 8),
            _row(
              Icons.person_outline,
              t('โปรไฟล์', 'Profile'),
              '${value.profile.displayName.isEmpty ? '—' : value.profile.displayName} · ${value.profile.locale}',
            ),
            _row(
              Icons.location_on_outlined,
              t('ที่อยู่', 'Addresses'),
              '${value.addresses.length}',
            ),
            _row(
              Icons.favorite_border,
              t('ร้านโปรด', 'Favourites'),
              '${value.favourites.length}',
            ),
            _row(
              Icons.receipt_long_outlined,
              t('ออเดอร์ล่าสุด', 'Recent orders'),
              '${value.orders.length}',
            ),
            _row(
              Icons.support_agent,
              t('เรื่องที่แจ้งไว้', 'Support cases'),
              '${value.supportCases.length}',
            ),
            if (value.truncated)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Text(
                  t(
                    'สำเนานี้ตัดรายการที่เก่ากว่า บางรายการไม่ได้อยู่ในนี้',
                    'This copy is limited to recent items; older items are not included.',
                  ),
                  key: const ValueKey('data-copy-truncated'),
                ),
              ),
            FilledButton.icon(
              onPressed: () => unawaited(_copyJson(value)),
              icon: const Icon(Icons.copy_outlined),
              label: Text(t('คัดลอกเป็นข้อความ JSON', 'Copy as JSON text')),
            ),
            if (copied)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Semantics(
                  liveRegion: true,
                  child: Text(t('คัดลอกแล้ว', 'Copied')),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
