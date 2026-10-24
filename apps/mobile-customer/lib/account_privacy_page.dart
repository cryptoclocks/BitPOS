import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/owned_route.dart';

import 'support_page.dart';
import 'presentation/customer_navigation.dart';


class AccountPrivacyPage extends StatefulWidget {
  const AccountPrivacyPage({
    super.key,
    required this.api,
    required this.owner,
    required this.thai,
    required this.onAuthenticationRequired,
    this.notificationSettings,
    this.onNavigate,
  });
  final MobileApi api;
  final ValueListenable<bool> owner;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final Widget? notificationSettings;
  final ValueChanged<int>? onNavigate;
  @override
  State<AccountPrivacyPage> createState() => _AccountPrivacyPageState();
}

class _AccountPrivacyPageState extends State<AccountPrivacyPage> {
  ModalRoute<dynamic>? route;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    widget.owner.addListener(retire);
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

  void request(bool deletion) {
    if (!widget.owner.value) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SupportPage(
          api: widget.api,
          owner: widget.owner,
          thai: widget.thai,
          onAuthenticationRequired: widget.onAuthenticationRequired,
          initialSubject: deletion
              ? t('คำขอลบข้อมูลบัญชี', 'Account data deletion request')
              : t('คำขอสำเนาข้อมูลบัญชี', 'Account data copy request'),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final viewportWidth = MediaQuery.sizeOf(context).width;
    final contentInset = viewportWidth > 900 ? (viewportWidth - 852) / 2 : 24.0;
    final location = _card(
      Icons.location_on_outlined,
      t('ข้อมูลตำแหน่งและที่อยู่', 'Location and addresses'),
      t(
        'บันทึกที่อยู่ด้วยตนเองได้โดยไม่เปิด GPS ข้อมูลจัดส่งจะถูกใช้กับออเดอร์ที่คุณเลือก',
        'You can save addresses manually without GPS. Delivery details are used with the orders you select.',
      ),
    );
    final requests = _card(
      Icons.manage_accounts_outlined,
      t('สำเนาข้อมูลและการลบข้อมูล', 'Data copy and deletion'),
      t(
        'ส่งคำขอให้เจ้าหน้าที่ตรวจสอบและติดตามในศูนย์ช่วยเหลือ การส่งคำขอยังไม่ใช่การดาวน์โหลดหรือลบข้อมูลสำเร็จ หลักฐานออเดอร์ การชำระเงิน และประวัติตรวจสอบยังไม่ได้ถูกลบอัตโนมัติ',
        'Submit a request for review and track it in Help. Submitting does not download or erase your data. Order, payment and audit records are not automatically deleted.',
      ),
    );
    return Scaffold(
      backgroundColor: const Color(0xfff8f5fc),
      appBar: AppBar(
        backgroundColor: const Color(0xfff8f5fc),
        title: Text(
          t('ความเป็นส่วนตัว', 'Privacy'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        ),
      ),
      bottomNavigationBar: widget.onNavigate == null
          ? null
          : CustomerNavigation(
              thai: widget.thai,
              selectedIndex: 3,
              onSelected: (index) {
                Navigator.of(context).pop();
                widget.onNavigate!(index);
              },
            ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(contentInset, 24, contentInset, 24),
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth < 680) {
                return Column(
                  children: [
                    location,
                    const SizedBox(height: 22),
                    if (widget.notificationSettings != null) ...[
                      widget.notificationSettings!,
                      const SizedBox(height: 22),
                    ],
                    requests,
                  ],
                );
              }
              final half = (constraints.maxWidth - 20) / 2;
              return Wrap(
                spacing: 20,
                runSpacing: 20,
                children: [
                  SizedBox(width: half, child: location),
                  SizedBox(
                    width: half,
                    child: widget.notificationSettings ?? requests,
                  ),
                  if (widget.notificationSettings != null)
                    SizedBox(width: half, child: requests),
                ],
              );
            },
          ),
          const SizedBox(height: 28),
          Text(
            t('คำขอข้อมูล', 'Data requests'),
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: Color(0xff29183f),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => request(false),
            icon: const Icon(Icons.download_outlined),
            label: Text(t('ขอสำเนาข้อมูล', 'Request a data copy')),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => request(true),
            icon: const Icon(Icons.delete_outline),
            label: Text(t('ขอลบข้อมูล', 'Request data deletion')),
          ),
        ],
      ),
    );
  }

  Widget _card(IconData icon, String title, String body) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(20),
      side: const BorderSide(color: Color(0xffe9e1f1)),
    ),
    child: ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 82),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
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
                mainAxisSize: MainAxisSize.min,
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
                  const SizedBox(height: 6),
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
