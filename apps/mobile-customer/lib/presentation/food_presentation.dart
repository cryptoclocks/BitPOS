import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';

/// Screen-local geometry from U06/U09/U10/U11/U15. The OS owns system bars.
class FoodPresentation extends StatelessWidget {
  const FoodPresentation({super.key, required this.child});
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
    final button = ButtonStyle(
      minimumSize: const WidgetStatePropertyAll(Size(48, 52)),
      visualDensity: VisualDensity.standard,
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      ),
      textStyle: WidgetStatePropertyAll(
        run(base.textTheme.labelLarge, 15, FontWeight.w600),
      ),
      shape: WidgetStatePropertyAll(
        RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
        ),
      ),
    );
    return Theme(
      data: base.copyWith(
        visualDensity: VisualDensity.standard,
        textTheme: base.textTheme.copyWith(
          headlineSmall: run(base.textTheme.headlineSmall, 20, FontWeight.w600),
          titleLarge: run(base.textTheme.titleLarge, 24, FontWeight.w600),
          titleMedium: run(base.textTheme.titleMedium, 15, FontWeight.w600),
          bodyMedium: run(base.textTheme.bodyMedium, 14, FontWeight.w400),
          bodySmall: run(base.textTheme.bodySmall, 12, FontWeight.w400),
          labelLarge: run(base.textTheme.labelLarge, 15, FontWeight.w600),
        ),
        // The food rows are radius18 in the SVG, not the generic radius20 card.
        cardTheme: base.cardTheme.copyWith(
          margin: const EdgeInsets.only(bottom: 12),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: base.colorScheme.outlineVariant),
          ),
        ),
        iconButtonTheme: IconButtonThemeData(
          style: IconButton.styleFrom(
            minimumSize: const Size(48, 48),
            padding: const EdgeInsets.all(12),
            iconSize: 24,
            visualDensity: VisualDensity.standard,
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: base.filledButtonTheme.style?.merge(button) ?? button,
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: base.outlinedButtonTheme.style?.merge(button) ?? button,
        ),
        inputDecorationTheme: base.inputDecorationTheme.copyWith(
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 12,
          ),
          constraints: const BoxConstraints(minHeight: 52),
        ),
        listTileTheme: base.listTileTheme.copyWith(
          minVerticalPadding: 11,
          minLeadingWidth: 60,
          horizontalTitleGap: 14,
          contentPadding: const EdgeInsets.symmetric(horizontal: 12),
          titleTextStyle: run(base.textTheme.titleMedium, 15, FontWeight.w600),
          subtitleTextStyle: run(base.textTheme.bodySmall, 12, FontWeight.w400),
        ),
      ),
      child: Builder(
        builder: (context) => DefaultTextStyle(
          style: Theme.of(context).textTheme.bodyMedium!,
          child: child,
        ),
      ),
    );
  }
}

/// One native header row, with a48px minimum for its operative action.
class FoodHeader extends StatelessWidget {
  const FoodHeader({super.key, required this.title, this.trailing});
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => ConstrainedBox(
    constraints: const BoxConstraints(minHeight: 48),
    child: Row(
      children: [
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.headlineSmall),
        ),
        ?trailing,
      ],
    ),
  );
}

/// Menu media (photos, loop videos) come from the API as site paths such as /images/menu/x.jpg; they live on the same
/// origin as the mobile API, so resolve a path against it. Absolute http(s) URLs pass through unchanged.
String resolveMediaUrl(String url) {
  if (!url.startsWith('/')) return url;
  const base = String.fromEnvironment('BITPOS_MOBILE_API');
  final origin = Uri.tryParse(base);
  if (origin == null || !origin.hasAuthority) return url;
  return origin.replace(path: url, query: null).toString();
}

/// Real product imagery only. A missing image is an explicit neutral fallback.
class FoodImage extends StatelessWidget {
  const FoodImage({
    super.key,
    this.url = '',
    this.size = 60,
    this.hero = false,
    this.emoji,
  });
  final String url;
  final double size;
  final bool hero;

  /// Shown instead of the generic cutlery icon while the item has no photo; see [foodEmoji].
  final String? emoji;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    Widget unavailable() => ColoredBox(
      color: colors.surfaceContainerHighest,
      child: Center(
        child: emoji != null
            ? Text(emoji!, style: TextStyle(fontSize: hero ? 72 : size * 0.5))
            : Icon(
                Icons.restaurant_outlined,
                size: hero ? 48 : 28,
                color: colors.onSurfaceVariant,
              ),
      ),
    );
    final uri = Uri.tryParse(resolveMediaUrl(url));
    final canLoad =
        uri != null && (uri.scheme == 'https' || uri.scheme == 'http');
    return ExcludeSemantics(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(hero ? 0 : 13),
        child: SizedBox(
          width: hero ? double.infinity : size,
          height: hero ? 238 : size,
          child: canLoad
              ? Image.network(
                  uri.toString(),
                  fit: BoxFit.cover,
                  errorBuilder: (_, error, stack) => unavailable(),
                )
              : unavailable(),
        ),
      ),
    );
  }
}

/// A minimum, never a fixed height: actual option text and large fonts can grow.
class FoodRowCard extends StatelessWidget {
  const FoodRowCard({super.key, required this.child, this.onTap});
  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 82),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          child: child,
        ),
      ),
    ),
  );
}

class FoodAmountRow extends StatelessWidget {
  const FoodAmountRow({
    super.key,
    required this.label,
    required this.amount,
    this.total = false,
  });
  final String label;
  final String amount;
  final bool total;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.symmetric(vertical: total ? 12 : 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: total ? 17 : 14,
              fontWeight: total ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            amount,
            textAlign: TextAlign.end,
            style: TextStyle(
              fontSize: total ? 24 : 14,
              fontWeight: total ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ],
    ),
  );
}


/// One emoji for a menu item so categories read at a glance. Specific dishes first, then the category;
/// items that cannot be told apart share their category's emoji, and anything unknown keeps the plain icon (null).
String? foodEmoji({String name = '', String nameEn = '', String category = ''}) {
  final text = '$name $nameEn'.toLowerCase();
  bool has(List<String> words) => words.any(text.contains);
  if (has(['iced', 'เย็น', 'frappe', 'ปั่น'])) return '🧊';
  if (has(['matcha', 'ชาเขียว', 'ชาไทย', 'ชานม']) || RegExp(r'\btea\b').hasMatch(text)) {
    return '🍵';
  }
  if (has(['croissant', 'ครัวซอง'])) return '🥐';
  if (has(['muffin', 'มัฟฟิน', 'cupcake'])) return '🧁';
  if (has(['brownie', 'บราวนี'])) return '🍫';
  if (has(['cheesecake', 'cake', 'เค้ก'])) return '🍰';
  if (has(['sandwich', 'แซนด์วิช', 'toast', 'ขนมปัง'])) return '🥪';
  switch (category.trim().toLowerCase()) {
    case 'coffee':
    case 'tea & chocolate':
      return '☕';
    case 'bakery':
      return '🥐';
    case 'desserts':
      return '🍰';
    case 'savory':
      return '🥪';
  }
  return null;
}
