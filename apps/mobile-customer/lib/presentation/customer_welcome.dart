import 'package:flutter/material.dart';

/// Artwork extracted unchanged from approved U01, not a live merchant listing.
class CustomerWelcome extends StatelessWidget {
  const CustomerWelcome({
    super.key,
    required this.thai,
    required this.onStart,
    required this.onLanguage,
  });
  final bool thai;
  final VoidCallback onStart, onLanguage;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return Scaffold(
      backgroundColor: const Color(0xFFF8F5FC),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                Row(
                  children: [
                    Image.asset(
                      'assets/design/bitpos-logo.png',
                      width: 104,
                      height: 35,
                      semanticLabel: 'BitPOS',
                    ),
                    const Spacer(),
                    TextButton(
                      onPressed: onLanguage,
                      child: Text(thai ? 'English' : 'ไทย'),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                ClipRRect(
                  borderRadius: BorderRadius.circular(24),
                  child: AspectRatio(
                    aspectRatio: 342 / 304,
                    child: Image.asset(
                      'assets/design/welcome-coffee.jpg',
                      fit: BoxFit.cover,
                      excludeFromSemantics: true,
                    ),
                  ),
                ),
                const SizedBox(height: 30),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Image.asset(
                    'assets/design/bitpos-logo.png',
                    width: 148,
                    height: 50,
                    excludeFromSemantics: true,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  t('มื้ออร่อย ในจังหวะของคุณ', 'Good food, at your pace'),
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF29183F),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  t(
                    'เลือกร้านและเมนู พร้อมติดตามสถานะออเดอร์ของคุณ',
                    'Explore merchants and menus, and follow your order status.',
                  ),
                  style: const TextStyle(
                    fontSize: 15,
                    height: 1.65,
                    color: Color(0xFF7B7088),
                  ),
                ),
                const SizedBox(height: 48),
                FilledButton(
                  key: const ValueKey('customer-welcome-start'),
                  onPressed: onStart,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(48, 52),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: Text(t('เริ่มต้นใช้งาน', 'Get started')),
                ),
                const SizedBox(height: 24),
                Text(
                  t(
                    'อาหารดี ๆ และร้านที่คุณเลือก',
                    'Good food from the merchants you choose',
                  ),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF7B7088),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
