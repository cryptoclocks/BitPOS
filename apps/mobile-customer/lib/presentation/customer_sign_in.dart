import 'package:flutter/material.dart';

/// U02/U03: one native OTP field preserves paste and platform autofill.
class CustomerSignInHeading extends StatelessWidget {
  const CustomerSignInHeading({
    super.key,
    required this.thai,
    required this.sent,
    required this.phone,
  });
  final bool thai, sent;
  final String phone;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    final colors=Theme.of(context).colorScheme;
    final dark=Theme.of(context).brightness==Brightness.dark;
    final value = phone.trim();
    final masked = value.length > 6
        ? '${value.substring(0, 3)} ••• ${value.substring(value.length - 4)}'
        : value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        Text(
          sent
              ? t('ใส่รหัส 6 หลัก', 'Enter the six-digit code')
              : t('ยินดีต้อนรับกลับมา', 'Welcome back'),
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w600,
            color: dark?colors.onSurface:const Color(0xFF29183F),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          sent
              ? t('ส่งรหัสไปที่ $masked', 'Code sent to $masked')
              : t(
                  'ใช้เบอร์โทรศัพท์เพื่อสั่งอาหารและติดตามออเดอร์ของคุณ',
                  'Use your phone number to order food and track your orders.',
                ),
          style: TextStyle(
            fontSize: 15,
            height: 1.65,
            color: dark?colors.onSurfaceVariant:const Color(0xFF7B7088),
          ),
        ),
        const SizedBox(height: 32),
      ],
    );
  }
}

class CustomerSignInControls extends StatelessWidget {
  const CustomerSignInControls({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context);
    final dark=base.brightness==Brightness.dark;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
    );
    return Theme(
      data: base.copyWith(
        inputDecorationTheme: base.inputDecorationTheme.copyWith(
          filled: true,
          fillColor: dark?base.colorScheme.surface:Colors.white,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide(color: dark?base.colorScheme.outline:const Color(0xFFE9E1F1)),
          ),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            minimumSize: const Size(48, 52),
            shape: shape,
          ),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
            minimumSize: const Size(48, 48),
            shape: shape,
          ),
        ),
      ),
      child: child,
    );
  }
}
