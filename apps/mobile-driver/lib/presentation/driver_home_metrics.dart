import 'package:flutter/material.dart';

/// R06: two 164px cards with a 14px gap at the 390px reference width.
/// Larger text or narrow viewports stack without scaling down private facts.
class DriverHomeMetrics extends StatelessWidget {
  const DriverHomeMetrics({
    super.key,
    required this.earnings,
    required this.rating,
  });
  final Widget earnings, rating;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final scaled = MediaQuery.textScalerOf(context).scale(14) / 14;
      final columns = constraints.maxWidth >= 328 && scaled <= 1.2;
      if (columns) {
        // Equal-height cards so the two top and bottom edges align.
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: earnings),
              const SizedBox(width: 14),
              Expanded(child: rating),
            ],
          ),
        );
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [earnings, const SizedBox(height: 14), rating],
      );
    },
  );
}
