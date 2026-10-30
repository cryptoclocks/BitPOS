import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';

class DriverWelcome extends StatelessWidget {
  const DriverWelcome({
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
    return Scaffold(
      backgroundColor: colors.surface,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: CustomScrollView(
              slivers: [
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(
                      BitPosDesignTokens.mobileMargin,
                      8,
                      BitPosDesignTokens.mobileMargin,
                      24,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
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
                              style: TextButton.styleFrom(
                                padding: EdgeInsets.zero,
                                minimumSize: const Size(48, 48),
                                alignment: Alignment.centerRight,
                              ),
                              child: Text(thai ? 'English' : 'ไทย'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(24),
                          child: AspectRatio(
                            aspectRatio: 342 / 293,
                            child: Stack(
                              children: [
                                const Positioned.fill(
                                  child: CustomPaint(
                                    painter: _WelcomeMapArtwork(),
                                  ),
                                ),
                                Positioned(
                                  left: 0,
                                  bottom: 0,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 6,
                                    ),
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      borderRadius: BorderRadius.circular(14),
                                    ),
                                    child: Text(
                                      t('แผนที่ตัวอย่าง', 'Map illustration'),
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: Color(0xFF64188A),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 32),
                        Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 16,
                          runSpacing: 8,
                          children: [
                            Image.asset(
                              'assets/design/bitpos-logo.png',
                              width: 150,
                              height: 50,
                              excludeFromSemantics: true,
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 6,
                              ),
                              decoration: BoxDecoration(
                                color: colors.secondaryContainer,
                                borderRadius: BorderRadius.circular(14),
                              ),
                              child: Text(
                                'RIDER',
                                style: TextStyle(
                                  color: colors.onSecondaryContainer,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 20),
                        Text(
                          t(
                            'ทุกเส้นทาง มีคุณอยู่ด้วย',
                            'Every journey starts with you',
                          ),
                          style: TextStyle(
                            fontSize: 24,
                            height: 1.35,
                            fontWeight: FontWeight.w600,
                            color: colors.onSurface,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          t(
                            'รับงานส่งอาหาร ดูสถานะรายได้\nพร้อมความช่วยเหลือระหว่างทาง',
                            'Manage food deliveries and view your earning status, with support along the way.',
                          ),
                          style: TextStyle(
                            fontSize: 15,
                            height: 1.65,
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 32),
                        const Spacer(),
                        FilledButton(
                          key: const ValueKey('driver-welcome-start'),
                          onPressed: onStart,
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(48, 52),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                          child: Text(
                            t(
                              'เริ่มเป็น BitPOS Rider',
                              'Get started with BitPOS Rider',
                            ),
                          ),
                        ),
                      ],
                    ),
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

/// Approved R01 decorative geometry, never a navigation/location provider.
class _WelcomeMapArtwork extends CustomPainter {
  const _WelcomeMapArtwork();
  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 342, size.height / 293);
    canvas.drawRect(
      const Rect.fromLTWH(0, 0, 342, 293),
      Paint()..color = const Color(0xFFF0ECE4),
    );
    for (final rect in [
      const Rect.fromLTWH(15, 20, 72, 55),
      const Rect.fromLTWH(105, 20, 92, 42),
      const Rect.fromLTWH(230, 18, 78, 62),
      const Rect.fromLTWH(20, 110, 110, 52),
      const Rect.fromLTWH(166, 102, 67, 72),
      const Rect.fromLTWH(263, 120, 67, 64),
      const Rect.fromLTWH(150, 220, 83, 70),
    ]) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect, const Radius.circular(9)),
        Paint()..color = const Color(0xFFE4E7D8),
      );
    }
    final roads = Paint()
      ..color = Colors.white
      ..strokeWidth = 18;
    for (final y in [80.0, 176.0, 272.0]) {
      canvas.drawLine(Offset(0, y), Offset(342, y), roads);
    }
    roads.strokeWidth = 15;
    canvas.drawLine(const Offset(95, 0), const Offset(70, 293), roads);
    canvas.drawLine(const Offset(248, 0), const Offset(223, 293), roads);
    canvas.drawPath(
      Path()
        ..moveTo(307.8, 0)
        ..quadraticBezierTo(205.2, 131.85, 328.32, 293),
      Paint()
        ..color = const Color(0xFFC5DCD9)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 32,
    );
    canvas.drawPath(
      Path()
        ..moveTo(60, 238)
        ..lineTo(60, 146.5)
        ..quadraticBezierTo(60, 117.2, 90, 117.2)
        ..lineTo(198.36, 117.2)
        ..lineTo(198.36, 65),
      Paint()
        ..color = const Color(0xFF64188A)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(const Offset(60, 236), 17, Paint()..color = Colors.white);
    canvas.drawCircle(
      const Offset(60, 236),
      6,
      Paint()..color = const Color(0xFF64188A),
    );
    canvas.drawCircle(
      const Offset(198.36, 60),
      15,
      Paint()..color = const Color(0xFFFF8500),
    );
    canvas.drawCircle(
      const Offset(198.36, 60),
      5,
      Paint()..color = Colors.white,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _WelcomeMapArtwork oldDelegate) => false;
}
