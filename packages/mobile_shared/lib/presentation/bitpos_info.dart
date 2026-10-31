import 'package:flutter/material.dart';

import '../bitpos_design_tokens.dart';

/// Opens the shared "details" bottom sheet. Long explanations, disclaimers and
/// step lists live here so the screen itself can stay short. The sheet shows
/// every paragraph in full: nothing legal, privacy or amount related is dropped.
Future<void> showBitPosInfoSheet(
  BuildContext context, {
  required bool thai,
  required String title,
  required List<String> paragraphs,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
        child: SingleChildScrollView(
          child: Column(
            key: const ValueKey('bitpos-info-sheet'),
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                header: true,
                child: Text(
                  title,
                  style: Theme.of(sheetContext).textTheme.titleLarge,
                ),
              ),
              for (final paragraph in paragraphs) ...[
                const SizedBox(height: 14),
                Text(paragraph, style: Theme.of(sheetContext).textTheme.bodyMedium),
              ],
              const SizedBox(height: 20),
              FilledButton(
                key: const ValueKey('bitpos-info-close'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(BitPosDesignTokens.touchMin, 48),
                ),
                onPressed: () => Navigator.of(sheetContext).pop(),
                child: Text(thai ? 'ปิด' : 'Close'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/// Single reusable info "ⓘ" button (>= 48 px target, TH/EN accessible label)
/// that opens [showBitPosInfoSheet].
class BitPosInfoButton extends StatelessWidget {
  const BitPosInfoButton({
    super.key,
    required this.thai,
    required this.title,
    required this.paragraphs,
  });

  final bool thai;
  final String title;
  final List<String> paragraphs;

  @override
  Widget build(BuildContext context) {
    final label = thai ? 'รายละเอียด: $title' : 'Details: $title';
    return IconButton(
      tooltip: label,
      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
      icon: const Icon(Icons.info_outline),
      color: Theme.of(context).colorScheme.primary,
      onPressed: () => showBitPosInfoSheet(
        context,
        thai: thai,
        title: title,
        paragraphs: paragraphs,
      ),
    );
  }
}

/// One short line of copy with the info button at its end.
class BitPosInfoLine extends StatelessWidget {
  const BitPosInfoLine({
    super.key,
    required this.thai,
    required this.summary,
    required this.title,
    required this.paragraphs,
    this.style,
  });

  final bool thai;
  final String summary;
  final String title;
  final List<String> paragraphs;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Text(summary, style: style)),
        BitPosInfoButton(thai: thai, title: title, paragraphs: paragraphs),
      ],
    );
  }
}
