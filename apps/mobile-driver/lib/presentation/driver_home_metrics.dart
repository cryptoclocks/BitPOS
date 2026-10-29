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
      final width = columns
          ? (constraints.maxWidth - 14) / 2
          : constraints.maxWidth;
      return Wrap(
        spacing: 14,
        runSpacing: 14,
        children: [
          SizedBox(width: width, child: earnings),
          SizedBox(width: width, child: rating),
        ],
      );
    },
  );
}
