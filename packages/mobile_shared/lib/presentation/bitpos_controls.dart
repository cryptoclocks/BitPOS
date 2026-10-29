import 'package:flutter/material.dart';

import '../bitpos_design_tokens.dart';

enum BitPosActionVariant { primary, secondary, outline, danger }

/// Shared D02–D06 control. The caller owns confirmation and business authority.
/// Heights are minimums, so translations and accessibility text can wrap.
class BitPosActionButton extends StatelessWidget {
  const BitPosActionButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = BitPosActionVariant.primary,
    this.icon,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final BitPosActionVariant variant;
  final IconData? icon;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final colors = theme.colorScheme;
    final (background, foreground) = switch (variant) {
      BitPosActionVariant.primary => (
        BitPosDesignTokens.primary,
        BitPosDesignTokens.white,
      ),
      BitPosActionVariant.secondary => (
        colors.secondaryContainer,
        colors.onSecondaryContainer,
      ),
      BitPosActionVariant.outline => (
        dark ? colors.surfaceContainer : BitPosDesignTokens.white,
        dark ? colors.primary : BitPosDesignTokens.primary,
      ),
      BitPosActionVariant.danger => (
        colors.errorContainer,
        colors.onErrorContainer,
      ),
    };
    final effectiveAction = busy ? null : onPressed;
    final style = FilledButton.styleFrom(
      backgroundColor: background,
      foregroundColor: foreground,
      disabledBackgroundColor: variant == BitPosActionVariant.primary
          ? (dark
                ? const Color(0xff45354f)
                : Color.alphaBlend(
                    const Color(0x99ffffff),
                    BitPosDesignTokens.primary,
                  ))
          : Color.alphaBlend(
              colors.onSurface.withValues(alpha: .06),
              background,
            ),
      disabledForegroundColor: variant == BitPosActionVariant.primary && !dark
          ? Colors.white
          : colors.onSurfaceVariant,
      minimumSize: const Size(BitPosDesignTokens.touchMin, 52),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
        side: variant == BitPosActionVariant.outline
            ? BorderSide(color: colors.outlineVariant)
            : BorderSide.none,
      ),
      textStyle: theme.textTheme.labelLarge,
    );
    return Semantics(
      liveRegion: busy,
      child: FilledButton(
        onPressed: effectiveAction,
        style: style,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (busy || icon != null) ...[
              if (busy)
                SizedBox.square(
                  dimension: 18,
                  child: ExcludeSemantics(
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: variant == BitPosActionVariant.primary && !dark
                          ? Colors.white
                          : colors.onSurfaceVariant,
                    ),
                  ),
                )
              else
                Icon(icon, size: 20),
              const SizedBox(width: 8),
            ],
            Flexible(child: Text(label, textAlign: TextAlign.center)),
          ],
        ),
      ),
    );
  }
}

enum BitPosStatusTone { neutral, warning, success, information, danger }

(Color, Color) _toneColors(ThemeData theme, BitPosStatusTone tone) {
  final dark = theme.brightness == Brightness.dark;
  return switch (tone) {
    BitPosStatusTone.neutral => (
      theme.colorScheme.secondaryContainer,
      theme.colorScheme.onSecondaryContainer,
    ),
    BitPosStatusTone.warning =>
      dark
          ? (const Color(0xff4a301f), const Color(0xffffc38c))
          : (BitPosDesignTokens.peach, BitPosDesignTokens.orangeInk),
    BitPosStatusTone.success =>
      dark
          ? (const Color(0xff183e32), const Color(0xff91dbb9))
          : (BitPosDesignTokens.greenbg, BitPosDesignTokens.green),
    BitPosStatusTone.information =>
      dark
          ? (const Color(0xff26364d), const Color(0xffb4cff5))
          : (BitPosDesignTokens.bluebg, BitPosDesignTokens.blue),
    BitPosStatusTone.danger => (
      theme.colorScheme.errorContainer,
      theme.colorScheme.onErrorContainer,
    ),
  };
}

/// A caller-supplied label only: presentation never infers payment/delivery state.
class BitPosStatusBadge extends StatelessWidget {
  const BitPosStatusBadge({
    super.key,
    required this.label,
    this.tone = BitPosStatusTone.neutral,
  });
  final String label;
  final BitPosStatusTone tone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (background, foreground) = _toneColors(theme, tone);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(15),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 30),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          child: Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(color: foreground),
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}

/// Caller-owned feedback with semantic colors; no fabricated success behavior.
class BitPosNotice extends StatelessWidget {
  const BitPosNotice({
    super.key,
    required this.title,
    this.description,
    this.tone = BitPosStatusTone.neutral,
  });
  final String title;
  final String? description;
  final BitPosStatusTone tone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (background, foreground) = _toneColors(theme, tone);
    return Semantics(
      liveRegion: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: theme.textTheme.titleMedium?.copyWith(color: foreground),
              ),
              if (description case final details?) ...[
                const SizedBox(height: 8),
                Text(
                  details,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: foreground,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
