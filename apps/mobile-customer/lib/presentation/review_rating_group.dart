import 'package:flutter/material.dart';

class ReviewRatingGroup extends StatelessWidget {
  const ReviewRatingGroup({
    super.key,
    required this.title,
    required this.value,
    required this.thai,
    this.onChanged,
    this.onClear,
  });
  final String title;
  final int value;
  final bool thai;
  final ValueChanged<int>? onChanged;
  final VoidCallback? onClear;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? colors.surface
            : Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 2,
            runSpacing: 4,
            children: [
              for (var n = 1; n <= 5; n++)
                IconButton(
                  tooltip: '$n / 5',
                  onPressed: onChanged == null ? null : () => onChanged!(n),
                  isSelected: n <= value,
                  icon: Icon(
                    n <= value ? Icons.star : Icons.star_border,
                    color: const Color(0xFFDD6900),
                    size: 30,
                  ),
                  constraints: const BoxConstraints(
                    minWidth: 48,
                    minHeight: 48,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value == 0
                ? (thai ? 'ยังไม่ได้เลือกคะแนน' : 'No rating selected')
                : '$value / 5',
            textAlign: TextAlign.center,
          ),
          if (onClear != null)
            TextButton(
              onPressed: onClear,
              child: Text(thai ? 'ไม่ให้คะแนนไรเดอร์' : 'Skip rider rating'),
            ),
        ],
      ),
    );
  }
}
