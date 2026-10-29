import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Six visual cells, one accessible editable value for paste and OS autofill.
/// Validation and verification remain with the existing parent Form/API.
class DriverOtpField extends StatefulWidget {
  const DriverOtpField({
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
  State<DriverOtpField> createState() => _DriverOtpFieldState();
}

class _DriverOtpFieldState extends State<DriverOtpField> {
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
        Text(widget.label, style: theme.textTheme.bodySmall),
        const SizedBox(height: 8),
        Stack(
          children: [
            Positioned.fill(
              child: Semantics(
                label: widget.label,
                child: TextFormField(
                  key: const ValueKey('driver-otp-input'),
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
                            constraints: const BoxConstraints(minHeight: 64),
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: theme.inputDecorationTheme.fillColor,
                              borderRadius: BorderRadius.circular(14),
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
