import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/owned_route.dart';
import 'package:mobile_shared/support_page.dart';

class DriverHelpSafetyPage extends StatefulWidget {
  const DriverHelpSafetyPage({
    super.key,
    required this.api,
    required this.thai,
    this.onWork,
  });
  final MobileApi api;
  final bool thai;
  final VoidCallback? onWork;
  @override
  State<DriverHelpSafetyPage> createState() => _DriverHelpSafetyPageState();
}

class _DriverHelpSafetyPageState extends State<DriverHelpSafetyPage> {
  late final scope = widget.api.sessionScope;
  final owner = ValueNotifier(true);
  StreamSubscription<({String accountId, String sessionId})?>? changes;
  ModalRoute<dynamic>? route;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    changes = widget.api.sessionScopes.listen((next) {
      if (next != scope && mounted) retire();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    route = ModalRoute.of(context);
    if (!widget.api.signedIn || widget.api.sessionScope != scope) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) retire();
      });
    }
  }

  void retire() {
    owner.value = false;
    removeOwnedRoute(route);
  }

  @override
  void dispose() {
    owner.value = false;
    unawaited(changes?.cancel());
    owner.dispose();
    super.dispose();
  }

  void support(String subject) {
    if (!owner.value || widget.api.sessionScope != scope) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SupportPage(
          api: widget.api,
          owner: owner,
          thai: widget.thai,
          onAuthenticationRequired: retire,
          initialSubject: subject,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xfff8f5fc),
    appBar: AppBar(
      title: Text(t('ช่วยเหลือและความปลอดภัย', 'Help and safety')),
    ),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          t('ระหว่างงานส่งอาหาร', 'During a delivery'),
          style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 16),
        Text(
          t(
            'หากมีอันตรายเร่งด่วน ให้ติดต่อหน่วยฉุกเฉินในพื้นที่โดยตรง การส่งเคสในแอปไม่ใช่การติดต่อหน่วยฉุกเฉิน',
            'For immediate danger, contact local emergency services directly. An in-app support case does not contact emergency services.',
          ),
        ),
        const SizedBox(height: 16),
        if (widget.onWork != null)
          OutlinedButton.icon(
            onPressed: widget.onWork,
            icon: const Icon(Icons.health_and_safety_outlined),
            label: Text(
              t('เปิดงานเพื่อรายงานเหตุ', 'Open work to report an incident'),
            ),
          ),
        const SizedBox(height: 12),
        Text(
          t(
            'รายงานเหตุจากหน้างานเพื่อผูกงานที่ถูกต้อง การแจ้งเหตุไม่ปล่อยหน้าที่ดูแลอาหาร ไม่ยืนยันการยกเลิกหรือคืนเงิน',
            'Report an incident from the work screen to link the correct assignment. Reporting does not release food custody, cancel an order or confirm a refund.',
          ),
        ),
        const SizedBox(height: 24),
        for (final entry in [
          (
            Icons.manage_accounts_outlined,
            t('บัญชีและเอกสาร', 'Account and documents'),
          ),
          (
            Icons.account_balance_wallet_outlined,
            t('รายได้และการรับเงิน', 'Earnings and payouts'),
          ),
          (Icons.support_agent, t('ติดต่อเจ้าหน้าที่', 'Contact support')),
        ])
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Material(
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
                side: const BorderSide(color: Color(0xffe9e1f1)),
              ),
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                minVerticalPadding: 16,
                leading: Icon(entry.$1, color: const Color(0xff64188a)),
                title: Text(entry.$2),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => support(entry.$2),
              ),
            ),
          ),
      ],
    ),
  );
}
