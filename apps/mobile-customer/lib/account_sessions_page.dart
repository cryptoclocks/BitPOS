import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/owned_route.dart';

class AccountSessionsPage extends StatefulWidget {
  const AccountSessionsPage({
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
  State<AccountSessionsPage> createState() => _AccountSessionsPageState();
}

class _AccountSessionsPageState extends State<AccountSessionsPage> {
  MobileAccountSessions? page;
  bool busy = true;
  String? error;
  ModalRoute<dynamic>? route;
  bool get current => mounted && widget.owner.value;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    widget.owner.addListener(retire);
    if (widget.owner.value) load();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    route = ModalRoute.of(context);
    if (!widget.owner.value) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) retire();
      });
    }
  }

  void retire() {
    if (!widget.owner.value) removeOwnedRoute(route);
  }

  @override
  void dispose() {
    widget.owner.removeListener(retire);
    super.dispose();
  }

  Future<void> load({String? cursor, String? revoke}) async {
    if (!current) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      if (revoke != null) await widget.api.revokeAccountSession(revoke);
      if (!current) return;
      final result = await widget.api.accountSessions(cursor: cursor);
      if (current) setState(() => page = result);
    } catch (e) {
      if (current) {
        if (e is MobileApiException && e.code == 'AUTH_REQUIRED') {
          widget.onAuthenticationRequired();
          return;
        }
        setState(
          () => error = t(
            'ทำรายการไม่สำเร็จ โหลดสถานะล่าสุดก่อนลองอีกครั้ง',
            'Request did not complete. Refresh server state before retrying.',
          ),
        );
      }
    } finally {
      if (current) setState(() => busy = false);
    }
  }

  String date(String raw) {
    final d = DateTime.parse(raw).toLocal();
    return '${d.day}/${d.month}/${d.year} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xfff8f5fc),
    appBar: AppBar(
      backgroundColor: const Color(0xfff8f5fc),
      leadingWidth: 76,
      leading: Padding(
        padding: const EdgeInsets.only(left: 18, right: 10),
        child: Center(
          child: IconButton.filledTonal(
            tooltip: t('กลับไปตั้งค่าบัญชี', 'Back to account settings'),
            onPressed: () => Navigator.of(context).maybePop(),
            style: IconButton.styleFrom(
              minimumSize: const Size(48, 48),
              backgroundColor: Theme.of(context).cardTheme.color,
              foregroundColor: Theme.of(context).colorScheme.primary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            icon: const Icon(Icons.chevron_left, size: 22),
          ),
        ),
      ),
      titleSpacing: 0,
      title: Text(
        t('อุปกรณ์ที่เข้าสู่ระบบ', 'Signed-in sessions'),
        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
      ),
    ),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          t(
            'รายการเข้าสู่ระบบที่ยังใช้ได้ อุปกรณ์เดียวอาจมีหลายรายการ เลือกยกเลิกรายการที่ไม่รู้จัก',
            'Active sign-ins. A device may have multiple sessions. Revoke any session you do not recognize.',
          ),
        ),
        const SizedBox(height: 16),
        if (busy) const LinearProgressIndicator(),
        if (error != null) Semantics(liveRegion: true, child: Text(error!)),
        for (final session in page?.sessions ?? <MobileAccountSession>[])
          Card(
            margin: const EdgeInsets.only(top: 14),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.current
                        ? t('รายการที่กำลังใช้อยู่', 'Current session')
                        : t('รายการเข้าสู่ระบบอื่น', 'Other session'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Text(
                    t(
                      'เข้าสู่ระบบเมื่อ ${date(session.createdAt)}',
                      'Signed in ${date(session.createdAt)}',
                    ),
                  ),
                  Text(
                    t(
                      'ใช้ได้ถึง ${date(session.expiresAt)}',
                      'Expires ${date(session.expiresAt)}',
                    ),
                  ),
                  if (!session.current) ...[
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: busy ? null : () => load(revoke: session.id),
                      child: Text(t('ยกเลิกรายการนี้', 'Revoke session')),
                    ),
                  ],
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 12,
          children: [
            OutlinedButton(
              onPressed: busy ? null : () => load(),
              child: Text(t('โหลดใหม่', 'Refresh')),
            ),
            if (page?.nextCursor != null)
              OutlinedButton(
                onPressed: busy ? null : () => load(cursor: page!.nextCursor),
                child: Text(t('รายการเก่ากว่านี้', 'Older sessions')),
              ),
          ],
        ),
      ],
    ),
  );
}
