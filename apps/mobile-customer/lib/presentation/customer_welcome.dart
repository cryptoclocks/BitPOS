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
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
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
                const SizedBox(height: 8),
                ClipRRect(
                  key: const ValueKey('customer-welcome-artwork'),
                  borderRadius: BorderRadius.circular(24),
                  child: AspectRatio(
                    aspectRatio: 342 / 304,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Image.asset(
                          'assets/design/welcome-coffee.jpg',
                          fit: BoxFit.cover,
                          excludeFromSemantics: true,
                        ),
                        Positioned(
                          top: 22,
                          left: 20,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 20,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEFE6F8),
                              borderRadius: BorderRadius.circular(15),
                            ),
                            child: Text(
                              t('อร่อยใกล้คุณ', 'Good food nearby'),
                              style: const TextStyle(
                                fontSize: 12,
                                height: 1.5,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF64188A),
                              ),
                            ),
                          ),
                        ),
                      ],
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
                Semantics(
                  header: true,
                  child: Text(
                    t('มื้ออร่อย ในจังหวะของคุณ', 'Good food, at your pace'),
                    style: TextStyle(
                      fontSize: 25,
                      height: 1.35,
                      fontWeight: FontWeight.w600,
                      color: dark ? colors.onSurface : const Color(0xFF29183F),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  t(
                    'สั่งจากร้านโปรด แล้วให้ BitPOS ดูแลทุกขั้นตอนจนถึงมือคุณ',
                    'Order from the places you love and let BitPOS guide every step to your door.',
                  ),
                  style: TextStyle(
                    fontSize: 16,
                    height: 1.65,
                    color: dark
                        ? colors.onSurfaceVariant
                        : const Color(0xFF7B7088),
                  ),
                ),
                const SizedBox(height: 84),
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
                    'อาหารดี ๆ และร้านใกล้บ้านคุณ',
                    'Good food from the merchants you choose',
                  ),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    color: dark
                        ? colors.onSurfaceVariant
                        : const Color(0xFF7B7088),
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
