import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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
    final colors = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final value = phone.trim();
    final masked = value.length > 6
        ? '${value.substring(0, 3)} ••• ${value.substring(value.length - 4)}'
        : value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 40),
        Semantics(
          header: true,
          child: Text(
            sent
                ? t('ใส่รหัส 6 หลัก', 'Enter the six-digit code')
                : t('ยินดีต้อนรับกลับมา', 'Welcome back'),
            style: TextStyle(
              fontSize: 27,
              fontWeight: FontWeight.w600,
              color: dark ? colors.onSurface : const Color(0xFF29183F),
            ),
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
            color: dark ? colors.onSurfaceVariant : const Color(0xFF7B7088),
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
    final dark = base.brightness == Brightness.dark;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
    );
    return Theme(
      data: base.copyWith(
        inputDecorationTheme: base.inputDecorationTheme.copyWith(
          filled: true,
          fillColor: dark ? base.colorScheme.surface : Colors.white,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide(
              color: dark ? base.colorScheme.outline : const Color(0xFFE9E1F1),
            ),
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

/// Six visual cells, one accessible editable value for paste and OS autofill.
/// Validation and verification remain with the existing parent Form/API.
class CustomerOtpField extends StatefulWidget {
  const CustomerOtpField({
    super.key,
    required this.controller,
    required this.enabled,
    required this.label,
    required this.invalidMessage,
  });
  final TextEditingController controller;
  final bool enabled;
  final String label, invalidMessage;
  @override
  State<CustomerOtpField> createState() => _CustomerOtpFieldState();
}

class _CustomerOtpFieldState extends State<CustomerOtpField> {
  final focus = FocusNode();
  @override
  void initState() {
    super.initState();
    focus.addListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    focus.removeListener(_changed);
    focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Stack(
          children: [
            Positioned.fill(
              child: Semantics(
                label: widget.label,
                child: TextFormField(
                  key: const ValueKey('customer-otp-input'),
                  controller: widget.controller,
                  focusNode: focus,
                  enabled: widget.enabled,
                  keyboardType: TextInputType.number,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  style: const TextStyle(color: Colors.transparent),
                  cursorColor: Colors.transparent,
                  decoration: InputDecoration(
                    hintText: null,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    errorBorder: InputBorder.none,
                    focusedErrorBorder: InputBorder.none,
                    disabledBorder: InputBorder.none,
                    fillColor: Colors.transparent,
                    contentPadding: EdgeInsets.zero,
                    errorStyle: const TextStyle(fontSize: 0, height: 0),
                  ),
                  validator: (value) =>
                      RegExp(r'^[0-9]{6}$').hasMatch(value?.trim() ?? '')
                      ? null
                      : widget.invalidMessage,
                ),
              ),
            ),
            IgnorePointer(
              child: ExcludeSemantics(
                child: ValueListenableBuilder<TextEditingValue>(
                  valueListenable: widget.controller,
                  builder: (context, value, _) => Row(
                    children: List.generate(
                      6,
                      (index) => Expanded(
                        child: Padding(
                          padding: EdgeInsets.only(right: index == 5 ? 0 : 8),
                          child: Container(
                            constraints: const BoxConstraints(minHeight: 62),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: theme.inputDecorationTheme.fillColor,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color:
                                    focus.hasFocus &&
                                        index == value.text.length.clamp(0, 5)
                                    ? colors.primary
                                    : colors.outlineVariant,
                              ),
                            ),
                            child: Text(
                              index < value.text.length
                                  ? value.text[index]
                                  : '',
                              style: theme.textTheme.headlineSmall,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: widget.controller,
          builder: (context, value, _) => Text(
            value.text.length == 6 ? '' : widget.invalidMessage,
            style: theme.textTheme.bodySmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ),
      ],
    );
  }
}

/// Factual onboarding information; does not imply acceptance of unpublished terms.
class CustomerSignInInformation extends StatelessWidget {
  const CustomerSignInInformation({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) {
    String t(String th, String en) => thai ? th : en;
    return TextButton.icon(
      key: const ValueKey('customer-sign-in-information'),
      icon: const Icon(Icons.info_outline, size: 16),
      label: Text(
        t('ข้อมูลบริการและความเป็นส่วนตัว', 'Service and privacy information'),
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.bodySmall,
      ),
      onPressed: () => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        builder: (context) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    t('ข้อมูลและสิทธิ์ของคุณ', 'Your data and permissions'),
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 20),
                  Text(
                    t(
                      'ใช้เบอร์โทรศัพท์และรหัสยืนยันเพื่อเข้าสู่บัญชี ที่อยู่จัดส่งจะใช้กับออเดอร์ที่คุณเลือกส่ง',
                      'Your phone number and verification code sign you in. A delivery address is used for the order you choose to place.',
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    t(
                      'ตำแหน่งและการแจ้งเตือนเป็นสิทธิ์แยกกัน คุณข้ามได้ การเปิดหน้าขอสิทธิ์ไม่เปิดสิทธิ์ให้อัตโนมัติ',
                      'Location and notifications are separate, optional permissions. You can skip them. Opening a permission screen does not grant consent.',
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    t(
                      'ข้อมูลนี้อธิบายการทำงานของแอป ไม่ใช่ข้อกำหนดบริการหรือนโยบายฉบับเผยแพร่ เอกสารฉบับเผยแพร่ยังไม่พร้อมในแอปนี้',
                      'This explains app behavior and is not the published terms or privacy policy. Published documents are not yet available in this app.',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(t('ปิด', 'Close')),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
