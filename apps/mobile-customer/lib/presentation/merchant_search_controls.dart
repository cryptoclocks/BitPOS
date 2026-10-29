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

  Future<void> _openFilters(BuildContext context) async {
    if (busy) return;
    var draft = serving;
    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setDraft) => SafeArea(
          child: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          t('ตัวกรองร้าน', 'Merchant filters'),
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                      ),
                      IconButton(
                        tooltip: t('ปิดตัวกรอง', 'Close filters'),
                        onPressed: () => Navigator.pop(sheetContext),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    t('รูปแบบรับอาหาร', 'Service options'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 12),
                  for (final mode in ['all', 'pickup', 'delivery'])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: OutlinedButton.icon(
                        key: ValueKey('branch-filter-draft-$mode'),
                        onPressed: () => setDraft(() => draft = mode),
                        icon: Icon(
                          draft == mode
                              ? Icons.radio_button_checked
                              : Icons.radio_button_off,
                        ),
                        label: Text(
                          mode == 'all'
                              ? t('ทั้งหมด', 'All')
                              : mode == 'pickup'
                              ? t('รับที่ร้าน', 'Pickup')
                              : t('จัดส่ง', 'Delivery'),
                        ),
                      ),
                    ),
                  Text(
                    t(
                      'เป็นการตั้งค่าบริการของสาขา กรุณาตรวจพื้นที่ส่งและยอดก่อนสั่ง',
                      'These are branch service settings. Confirm delivery coverage and your quote before ordering.',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    key: const ValueKey('branch-filter-apply'),
                    onPressed: () => Navigator.pop(sheetContext, draft),
                    child: Text(t('ใช้ตัวกรอง', 'Apply filters')),
                  ),
                  TextButton(
                    onPressed: () => setDraft(() => draft = 'all'),
                    child: Text(t('ล้างตัวกรอง', 'Reset filters')),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    if (result != null && context.mounted) {
      FocusScope.of(context).unfocus();
      onServing(result);
    }
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
            prefixIcon: IconButton(
              key: const ValueKey('branch-discovery-submit'),
              tooltip: t('ค้นหาร้าน', 'Search merchants'),
              onPressed: busy ? null : () => _submit(context),
              icon: Icon(
                Icons.search,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
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
          IconButton.outlined(
            key: const ValueKey('branch-discovery-filter'),
            tooltip: t('ตัวกรอง', 'Filters'),
            onPressed: busy ? null : () => _openFilters(context),
            icon: const Icon(Icons.tune),
          ),
          for (final mode in ['all', 'pickup', 'delivery'])
            ChoiceChip(
              key: ValueKey('branch-mode-$mode'),
              selected: serving == mode,
              onSelected: busy ? null : (_) => onServing(mode),
              backgroundColor: Theme.of(context).colorScheme.surface,
              selectedColor: Theme.of(context).colorScheme.secondaryContainer,
              side: BorderSide(
                color: serving == mode
                    ? const Color(0xFF64188A)
                    : const Color(0xFFE9E1F1),
              ),
              labelStyle: TextStyle(
                color: Theme.of(context).colorScheme.primary,
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
      const SizedBox(height: 12),
    ],
  );
}

/// Keep service-setting context available without burying discovered merchants.
class MerchantSearchInformation extends StatelessWidget {
  const MerchantSearchInformation({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) => Theme(
    data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
    child: ExpansionTile(
      key: const ValueKey('merchant-service-information'),
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: 16),
      leading: const Icon(Icons.info_outline, size: 20),
      title: Text(
        thai ? 'เกี่ยวกับรูปแบบรับอาหาร' : 'About service options',
        style: Theme.of(context).textTheme.bodySmall,
      ),
      children: [
        Text(
          thai
              ? 'รูปแบบรับอาหารเป็นการตั้งค่าของสาขา ไม่ใช่การยืนยันเวลาเปิดหรือพื้นที่ส่ง กรุณาตรวจราคาและที่อยู่ก่อนสั่ง'
              : 'Service filters show branch settings, not current opening hours or delivery coverage. Confirm your quote and address before ordering.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    ),
  );
}

class MerchantDiscoveryLoading extends StatelessWidget {
  const MerchantDiscoveryLoading({super.key, required this.thai});
  final bool thai;
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    label: thai ? 'กำลังค้นหาร้านอาหาร' : 'Loading merchants',
    child: ExcludeSemantics(
      child: Column(
        children: [
          for (var i = 0; i < 3; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Container(
                height: 82,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  border: Border.all(
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        color: Theme.of(context)
                            .colorScheme
                            .surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(13),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Container(
                            height: 12,
                            width: 140,
                            color: Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                          ),
                          const SizedBox(height: 10),
                          Container(
                            height: 10,
                            width: 90,
                            color: Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
  );
}
