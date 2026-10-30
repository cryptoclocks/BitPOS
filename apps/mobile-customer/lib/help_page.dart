import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/owned_route.dart';
import 'support_page.dart';
// U30:24px margins,82px cards,24px gaps and44px icons; grows for text scaling.
class HelpPage extends StatefulWidget{
 const HelpPage({super.key,required this.api,required this.owner,required this.thai,required this.onAuthenticationRequired});
 final MobileApi api;final ValueListenable<bool> owner;final bool thai;final VoidCallback onAuthenticationRequired;
 @override State<HelpPage> createState()=>_HelpPageState();
}
class _HelpPageState extends State<HelpPage>{
 ModalRoute<dynamic>? route;
 String t(String th,String en)=>widget.thai?th:en;
 @override void initState(){super.initState();widget.owner.addListener(ownerChanged);}
 @override void didChangeDependencies(){super.didChangeDependencies();route=ModalRoute.of(context);if(!widget.owner.value)WidgetsBinding.instance.addPostFrameCallback((_)=>ownerChanged());}
 void ownerChanged(){if(!widget.owner.value)removeOwnedRoute(route);}
 @override void dispose(){widget.owner.removeListener(ownerChanged);super.dispose();}
 void open(String subject){if(!widget.owner.value)return;Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>SupportPage(api:widget.api,owner:widget.owner,thai:widget.thai,onAuthenticationRequired:widget.onAuthenticationRequired,initialSubject:subject)));}
 @override Widget build(BuildContext context){
  final dark=Theme.of(context).brightness==Brightness.dark,ink=dark?const Color(0xffe9ddff):const Color(0xff64188a),border=dark?const Color(0xff514361):const Color(0xffe9e1f1),tile=dark?const Color(0xff33263f):Colors.white;
  final entries=[(Icons.receipt_long_outlined,t('ออเดอร์และการจัดส่ง','Orders and delivery'),t('อาหารล่าช้า / รายการไม่ครบ','Late delivery / missing items')),(Icons.account_balance_wallet_outlined,t('การชำระเงิน','Payments'),t('ยอดชำระ / คืนเงิน / ใบเสร็จ','Charges / refunds / receipts')),(Icons.verified_user_outlined,t('บัญชีและความปลอดภัย','Account and security'),t('การเข้าถึงบัญชีและข้อมูลของคุณ','Account access and your information')),(Icons.chat_bubble_outline,t('ติดต่อเจ้าหน้าที่','Contact support'),t('ติดตามเรื่องที่แจ้งไว้','Track your existing requests'))];
  return Scaffold(appBar:AppBar(centerTitle:false,toolbarHeight:72,titleSpacing:0,leadingWidth: 84,leading:Padding(padding:const EdgeInsets.fromLTRB(24, 12, 12, 12),child:IconButton.filledTonal(style:IconButton.styleFrom(backgroundColor:tile,foregroundColor:ink,shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(14),side:BorderSide(color:border))),tooltip:MaterialLocalizations.of(context).backButtonTooltip,onPressed:()=>Navigator.maybePop(context),icon:const Icon(Icons.chevron_left,size:22))),title:Text(t('ให้เราช่วยคุณ','Let us help'),style:const TextStyle(fontSize:20,fontWeight:FontWeight.w600))),body:ListView(padding:const EdgeInsets.fromLTRB(24,32,24,24),children:[
   Text(t('เราช่วยเรื่องไหนได้บ้าง?','How can we help?'),style:const TextStyle(fontSize:23,fontWeight:FontWeight.w600)),const SizedBox(height:24),
   for(var i=0;i<entries.length;i++)...[
    Material(color:tile,shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(18),side:BorderSide(color:border)),clipBehavior:Clip.antiAlias,child:InkWell(onTap:()=>open(i==3?'':entries[i].$2),child:ConstrainedBox(constraints:const BoxConstraints(minHeight:82),child:Padding(padding:const EdgeInsets.symmetric(horizontal:14,vertical:14),child:Row(children:[Container(width:44,height:44,decoration:BoxDecoration(color:dark?const Color(0xff4b3266):const Color(0xffefe6f8),borderRadius:BorderRadius.circular(13)),child:Icon(entries[i].$1,color:ink,size:22)),const SizedBox(width:14),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(entries[i].$2,style:const TextStyle(fontSize:14,fontWeight:FontWeight.w600)),const SizedBox(height:4),Text(entries[i].$3,style:TextStyle(fontSize:12,color:Theme.of(context).colorScheme.onSurfaceVariant))])),const SizedBox(width:8),Icon(Icons.chevron_right,size:18,color:Theme.of(context).colorScheme.onSurfaceVariant)]))))),if(i<entries.length-1)const SizedBox(height:24),
   ],
  ]));
 }
}
