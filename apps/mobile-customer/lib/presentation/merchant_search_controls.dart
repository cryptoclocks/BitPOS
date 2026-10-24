import 'package:flutter/material.dart';

/// U07 controls for supported server-side merchant/address and serving filters.
class MerchantSearchControls extends StatelessWidget {
  const MerchantSearchControls({
    super.key,
    required this.controller,
    required this.thai,
    required this.busy,
    required this.serving,
    required this.onSearch,
    required this.onServing,
  });
  final TextEditingController controller;
  final bool thai, busy;
  final String serving;
  final VoidCallback onSearch;
  final ValueChanged<String> onServing;
  String t(String th, String en) => thai ? th : en;
  void _submit(BuildContext context) {
    FocusScope.of(context).unfocus();
    onSearch();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      ValueListenableBuilder<TextEditingValue>(
        valueListenable: controller,
        builder: (context, value, _) => TextField(
          key: const ValueKey('branch-discovery-search'),
          controller: controller,
          enabled: !busy,
          maxLength: 100,
          textInputAction: TextInputAction.search,
          onSubmitted: busy ? null : (_) => _submit(context),
          decoration: InputDecoration(
            hintText: t(
              'ชื่อร้าน สาขา หรือที่อยู่',
              'Merchant, branch or address',
            ),
            counterText: '',
            prefixIcon: const Icon(Icons.search, color: Color(0xFF64188A)),
            suffixIcon: value.text.isEmpty
                ? null
                : IconButton(
                    tooltip: t('ล้างคำค้น', 'Clear search text'),
                    onPressed: busy ? null : controller.clear,
                    icon: const Icon(Icons.close),
                  ),
            filled: true,
            fillColor: Theme.of(context).inputDecorationTheme.fillColor,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 14,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Color(0xFFE9E1F1)),
            ),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Color(0xFF64188A), width: 2),
            ),
          ),
        ),
      ),
      const SizedBox(height: 14),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final mode in ['all', 'pickup', 'delivery'])
            ChoiceChip(
              key: ValueKey('branch-mode-$mode'),
              selected: serving == mode,
              onSelected: busy ? null : (_) => onServing(mode),
              backgroundColor: Colors.white,
              selectedColor: const Color(0xFFEFE6F8),
              side: BorderSide(
                color: serving == mode
                    ? const Color(0xFF64188A)
                    : const Color(0xFFE9E1F1),
              ),
              labelStyle: const TextStyle(
                color: Color(0xFF64188A),
                fontSize: 13,
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              label: Text(
                mode == 'all'
                    ? t('ทั้งหมด', 'All')
                    : mode == 'pickup'
                    ? t('รับที่ร้าน', 'Pickup')
                    : t('จัดส่ง', 'Delivery'),
              ),
            ),
        ],
      ),
      const SizedBox(height: 14),
      FilledButton(
        key: const ValueKey('branch-discovery-submit'),
        onPressed: busy ? null : () => _submit(context),
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
        child: Text(t('ค้นหาร้าน', 'Search merchants')),
      ),
      const SizedBox(height: 12),
    ],
  );
}
