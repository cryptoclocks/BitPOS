import 'package:flutter/material.dart';

import 'bitpos_design_tokens.dart';

/// Canonical FigCraft tokens: semantic colors and responsive component geometry.
/// Design fixture prices/images never enter this theme or domain authority.
abstract final class BitPosTheme {
  static const primary = BitPosDesignTokens.primary;
  static const action = BitPosDesignTokens.action;
  static const orange = BitPosDesignTokens.orange;
  static const orangeInk = BitPosDesignTokens.orangeInk;
  static const ink = BitPosDesignTokens.ink;
  static const background = BitPosDesignTokens.background;
  static ThemeData light() => _theme(Brightness.light);
  static ThemeData dark() => _theme(Brightness.dark);
  static ThemeData _theme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final scheme =
        ColorScheme.fromSeed(
          seedColor: primary,
          brightness: brightness,
        ).copyWith(
          primary: dark ? const Color(0xffd9b7ff) : primary,
          onPrimary: dark ? const Color(0xff351044) : Colors.white,
          secondary: dark ? const Color(0xffffbb77) : orangeInk,
          surface: dark ? const Color(0xff21152d) : background,
          onSurface: dark ? const Color(0xfff3e8fa) : ink,
          onSurfaceVariant: dark
              ? const Color(0xffc8b9d4)
              : BitPosDesignTokens.muted,
          outline: dark ? const Color(0xff877591) : BitPosDesignTokens.line,
          outlineVariant: dark
              ? const Color(0xff51405e)
              : BitPosDesignTokens.line,
          primaryContainer: dark
              ? const Color(0xff452355)
              : BitPosDesignTokens.tint,
          onPrimaryContainer: dark ? const Color(0xffebd9f7) : primary,
          secondaryContainer: dark
              ? const Color(0xff452355)
              : BitPosDesignTokens.tint,
          onSecondaryContainer: dark ? const Color(0xffebd9f7) : primary,
          error: dark ? const Color(0xffffb2bf) : BitPosDesignTokens.red,
          errorContainer: dark
              ? const Color(0xff542632)
              : BitPosDesignTokens.redbg,
          onErrorContainer: dark
              ? const Color(0xffffd9df)
              : BitPosDesignTokens.red,
        );
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: BitPosDesignTokens.fontThai,
      fontFamilyFallback: const [BitPosDesignTokens.fontLatin],
      scaffoldBackgroundColor: scheme.surface,
    );
    TextStyle text(double size, FontWeight weight, double height) => TextStyle(
      fontFamily: BitPosDesignTokens.fontThai,
      fontFamilyFallback: const [BitPosDesignTokens.fontLatin],
      fontSize: size,
      fontWeight: weight,
      height: height,
      letterSpacing: 0,
      color: scheme.onSurface,
    );
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
    );
    return base.copyWith(
      textTheme: base.textTheme.copyWith(
        headlineMedium: text(27, FontWeight.w600, 1.35),
        headlineSmall: text(24, FontWeight.w600, 1.35),
        titleLarge: text(20, FontWeight.w600, 1.4),
        titleMedium: text(16, FontWeight.w600, 1.5),
        titleSmall: text(14, FontWeight.w600, 1.5),
        bodyLarge: text(15, FontWeight.w400, 1.6),
        bodyMedium: text(14, FontWeight.w400, 1.5),
        bodySmall: text(12, FontWeight.w400, 1.5),
        labelLarge: text(15, FontWeight.w600, 1.4),
        labelMedium: text(12, FontWeight.w600, 1.5),
        labelSmall: text(11, FontWeight.w500, 1.45),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        scrolledUnderElevation: 0,
        elevation: 0,
        centerTitle: false,
        titleSpacing: 24,
        toolbarHeight: 64,
        titleTextStyle: text(20, FontWeight.w600, 1.4),
      ),
      // Enabled colors stay with the Material variant: tonal must not become primary.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(BitPosDesignTokens.touchMin, 52),
          shape: shape,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          disabledBackgroundColor: dark
              ? const Color(0xff45354f)
              : Color.alphaBlend(const Color(0x99ffffff), BitPosDesignTokens.primary),
          disabledForegroundColor: dark
              ? const Color(0xffb7a6c1)
              : Colors.white,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(BitPosDesignTokens.touchMin, 52),
          shape: shape,
          foregroundColor: scheme.primary,
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 48),
          shape: shape,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: dark ? const Color(0xff31233e) : Colors.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
        constraints: const BoxConstraints(minHeight: 52),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
          borderSide: BorderSide(color: scheme.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
          borderSide: BorderSide(color: scheme.error, width: 2),
        ),
        errorStyle: text(
          12,
          FontWeight.w400,
          1.5,
        ).copyWith(color: scheme.error),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: dark ? const Color(0xff31233e) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusCard),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        elevation: 0,
        backgroundColor: dark ? const Color(0xff31233e) : BitPosDesignTokens.white,
        surfaceTintColor: Colors.transparent,
        indicatorColor: Colors.transparent,
        labelTextStyle: WidgetStateProperty.resolveWith((states) => text(13, states.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w400, 1.4).copyWith(color: states.contains(WidgetState.selected) ? scheme.primary : scheme.onSurfaceVariant)),
        iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(size: 24, color: states.contains(WidgetState.selected) ? scheme.primary : scheme.onSurfaceVariant)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(BitPosDesignTokens.radiusSheet),
          ),
        ),
      ),
    );
  }
}

/// Exact integer formatting; no double conversion, fixed2 or THB inference.
String formatMinorUnits(String amountMinor,int decimals,String currency) {
 final amount=BigInt.parse(amountMinor);
 final digits=amount.abs().toString().padLeft(decimals+1,'0');
 final formatted=decimals==0?digits:'${digits.substring(0,digits.length-decimals)}.${digits.substring(digits.length-decimals)}';
 return '${amount.isNegative?'-':''}$formatted $currency';
}
