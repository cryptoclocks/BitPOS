import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// R06 geometry only. No offer, assignment, location, rating or income fixtures.
class DriverPresentation extends StatelessWidget {
  const DriverPresentation({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context);
    TextStyle run(TextStyle? style, double size, FontWeight weight) =>
        (style ?? const TextStyle()).copyWith(
          fontSize: size,
          height: 1.65,
          fontWeight: weight,
          letterSpacing: 0,
        );
    final controls = ButtonStyle(
      minimumSize: const WidgetStatePropertyAll(Size(48, 52)),
      visualDensity: VisualDensity.standard,
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
      textStyle: WidgetStatePropertyAll(
        run(base.textTheme.labelLarge, 15, FontWeight.w600),
      ),
      shape: WidgetStatePropertyAll(
        RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: base.brightness == Brightness.dark
          ? SystemUiOverlayStyle.light
          : SystemUiOverlayStyle.dark,
      child: Theme(
        data: base.copyWith(
          visualDensity: VisualDensity.standard,
          textTheme: base.textTheme.copyWith(
            headlineSmall: run(
              base.textTheme.headlineSmall,
              20,
              FontWeight.w600,
            ),
            titleLarge: run(base.textTheme.titleLarge, 22, FontWeight.w600),
            titleMedium: run(base.textTheme.titleMedium, 15, FontWeight.w600),
            bodyMedium: run(base.textTheme.bodyMedium, 14, FontWeight.w400),
            bodySmall: run(base.textTheme.bodySmall, 12, FontWeight.w400),
          ),
          cardTheme: base.cardTheme.copyWith(
            margin: EdgeInsets.zero,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
            ),
          ),
          filledButtonTheme: FilledButtonThemeData(
            style: base.filledButtonTheme.style?.merge(controls) ?? controls,
          ),
          outlinedButtonTheme: OutlinedButtonThemeData(
            style: base.outlinedButtonTheme.style?.merge(controls) ?? controls,
          ),
          inputDecorationTheme: base.inputDecorationTheme.copyWith(
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 12,
            ),
            constraints: const BoxConstraints(minHeight: 52),
          ),
        ),
        child: child,
      ),
    );
  }
}

/// Server state, not an optimistic toggle. A stale snapshot has no toggle action.
class DriverAvailabilityCard extends StatelessWidget {
  const DriverAvailabilityCard({
    super.key,
    required this.label,
    required this.online,
    required this.stale,
    this.onToggle,
  });
  final String label;
  final bool online;
  final bool stale;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final confirmedOnline = !stale && online;
    final foreground = confirmedOnline
        ? const Color(0xFF217657)
        : colors.onSurfaceVariant;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: confirmedOnline
            ? const Color(0xFFE8F5ED)
            : colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(18),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 60),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 6, 18, 6),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 17,
                    height: 1.65,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Semantics(
                label: label,
                toggled: stale ? null : online,
                enabled: onToggle != null,
                button: true,
                child: InkWell(
                  onTap: onToggle,
                  borderRadius: BorderRadius.circular(14),
                  child: SizedBox(
                    width: 48,
                    height: 48,
                    child: Center(
                      child: Container(
                        width: 44,
                        height: 27,
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: confirmedOnline
                              ? const Color(0xFF217657)
                              : colors.outline,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        alignment: !stale && online
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        child: Container(
                          width: 19,
                          height: 19,
                          decoration: BoxDecoration(
                            color: colors.surface,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
