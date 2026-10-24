import 'package:flutter/material.dart';
import 'bitpos_design_tokens.dart';

/// FigCraft master9970fbd4: semantic colors and responsive component geometry.
/// Design fixture prices/images never enter this theme or domain authority.
abstract final class BitPosTheme {
 static const primary=BitPosDesignTokens.primary;
 static const action=BitPosDesignTokens.action;
 static const orange=BitPosDesignTokens.orange;
 static const orangeInk=BitPosDesignTokens.orangeInk;
 static const ink=BitPosDesignTokens.ink;
 static const background=BitPosDesignTokens.background;
 static ThemeData light()=>_theme(Brightness.light);
 static ThemeData dark()=>_theme(Brightness.dark);
 static ThemeData _theme(Brightness brightness) {
  final dark=brightness==Brightness.dark;
  final scheme=ColorScheme.fromSeed(seedColor:primary,brightness:brightness).copyWith(
   primary:dark?const Color(0xffd9b7ff):primary,
   onPrimary:dark?const Color(0xff351044):Colors.white,
   secondary:dark?const Color(0xffffbb77):orangeInk,
   surface:dark?const Color(0xff21152d):background,
   onSurface:dark?const Color(0xfff3e8fa):ink,
  );
  final base=ThemeData(useMaterial3:true,colorScheme:scheme,fontFamily:BitPosDesignTokens.fontThai,fontFamilyFallback:const [BitPosDesignTokens.fontLatin],scaffoldBackgroundColor:scheme.surface);
  TextStyle text(double size,FontWeight weight,double height)=>TextStyle(fontFamily:BitPosDesignTokens.fontThai,fontFamilyFallback:const [BitPosDesignTokens.fontLatin],fontSize:size,fontWeight:weight,height:height,letterSpacing:0,color:scheme.onSurface);
  final shape=RoundedRectangleBorder(borderRadius:BorderRadius.circular(14));
  return base.copyWith(
   textTheme:base.textTheme.copyWith(
    headlineMedium:text(27,FontWeight.w600,1.35),headlineSmall:text(24,FontWeight.w600,1.35),
    titleLarge:text(20,FontWeight.w600,1.4),titleMedium:text(16,FontWeight.w600,1.5),titleSmall:text(14,FontWeight.w600,1.5),
    bodyLarge:text(15,FontWeight.w400,1.6),bodyMedium:text(14,FontWeight.w400,1.5),bodySmall:text(12,FontWeight.w400,1.5),
    labelLarge:text(15,FontWeight.w600,1.4),labelMedium:text(12,FontWeight.w600,1.5),labelSmall:text(11,FontWeight.w500,1.45)),
   appBarTheme:AppBarTheme(backgroundColor:scheme.surface,foregroundColor:scheme.onSurface,scrolledUnderElevation:0,elevation:0,centerTitle:false,titleSpacing:24,toolbarHeight:64,titleTextStyle:text(20,FontWeight.w600,1.4)),
   filledButtonTheme:FilledButtonThemeData(style:FilledButton.styleFrom(
    backgroundColor:primary,foregroundColor:Colors.white,minimumSize:const Size(48,52),shape:shape,padding:const EdgeInsets.symmetric(horizontal:24,vertical:12))),
   outlinedButtonTheme:OutlinedButtonThemeData(style:OutlinedButton.styleFrom(minimumSize:const Size(48,52),shape:shape)),
   textButtonTheme:TextButtonThemeData(style:TextButton.styleFrom(minimumSize:const Size(48,48),shape:shape)),
   inputDecorationTheme:InputDecorationTheme(filled:true,fillColor:dark?const Color(0xff31233e):Colors.white,
    contentPadding:const EdgeInsets.symmetric(horizontal:16,vertical:16),
    border:OutlineInputBorder(borderRadius:BorderRadius.circular(14),borderSide:BorderSide(color:scheme.outlineVariant))),
   cardTheme:CardThemeData(elevation:0,color:dark?const Color(0xff31233e):Colors.white,
    shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(20))),
   bottomSheetTheme:BottomSheetThemeData(backgroundColor:scheme.surface,shape:const RoundedRectangleBorder(borderRadius:BorderRadius.vertical(top:Radius.circular(28)))),
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
