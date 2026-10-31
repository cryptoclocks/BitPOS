import 'package:flutter/material.dart';

import '../bitpos_design_tokens.dart';

/// Shared page-chrome metrics so every screen aligns to the same 24 dp gutter.
abstract final class BitPosLayout {
  static const double gutter = BitPosDesignTokens.mobileMargin;
  static const double toolbarHeight = 72;
  static const double backButtonSize = BitPosDesignTokens.touchMin;
  // gutter + 48 dp tile + 12 dp breathing room before the title.
  static const double leadingWidth = gutter + backButtonSize + 12;
  static const EdgeInsets leadingPadding = EdgeInsets.fromLTRB(
    gutter,
    12,
    12,
    12,
  );
  static const EdgeInsets page = EdgeInsets.fromLTRB(gutter, 16, gutter, 24);
}

/// The bare 48 dp bordered back tile with no outer padding, for in-body title
/// rows that already sit inside the 24 dp gutter.
class BitPosBackTile extends StatelessWidget {
  const BitPosBackTile({super.key, this.onPressed, this.tooltip});
  final VoidCallback? onPressed;
  final String? tooltip;

  @override
  Widget build(BuildContext context) => IconButton.filledTonal(
    tooltip: tooltip ?? MaterialLocalizations.of(context).backButtonTooltip,
    onPressed: onPressed ?? () => Navigator.of(context).maybePop(),
    style: IconButton.styleFrom(
      minimumSize: const Size(
        BitPosLayout.backButtonSize,
        BitPosLayout.backButtonSize,
      ),
      padding: EdgeInsets.zero,
      backgroundColor: Colors.white,
      foregroundColor: BitPosDesignTokens.primary,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
        side: const BorderSide(color: BitPosDesignTokens.line),
      ),
    ),
    icon: const Icon(Icons.chevron_left, size: 24),
  );
}

/// 48 dp tonal back tile shared by every page header (AppBar leading).
class BitPosBackButton extends StatelessWidget {
  const BitPosBackButton({
    super.key,
    this.onPressed,
    this.tooltip,
    this.verticalPadding = 12,
  });
  final VoidCallback? onPressed;
  final String? tooltip;

  /// Use 0 inside toolbars shorter than 72 dp so the tile stays 48 dp tall.
  final double verticalPadding;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.fromLTRB(
      BitPosLayout.gutter,
      verticalPadding,
      12,
      verticalPadding,
    ),
    child: Center(
      child: BitPosBackTile(onPressed: onPressed, tooltip: tooltip),
    ),
  );
}

/// AppBar with the shared back tile and title metrics.
AppBar bitPosAppBar(
  BuildContext context, {
  required Widget title,
  VoidCallback? onBack,
  List<Widget>? actions,
}) => AppBar(
  backgroundColor: BitPosDesignTokens.background,
  centerTitle: false,
  toolbarHeight: BitPosLayout.toolbarHeight,
  leadingWidth: BitPosLayout.leadingWidth,
  titleSpacing: 0,
  leading: BitPosBackButton(onPressed: onBack),
  title: DefaultTextStyle.merge(
    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
    child: title,
  ),
  actions: actions,
);
