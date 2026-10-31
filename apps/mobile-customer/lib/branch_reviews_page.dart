import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_layout.dart';import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/mobile_v1.generated.dart';
class BranchReviewsPage extends StatefulWidget{
 const BranchReviewsPage({super.key,required this.api,required this.branchId,required this.thai});final MobileApi api;final String branchId;final bool thai;
 @override State<BranchReviewsPage>createState()=>_BranchReviewsPageState();
}
class _BranchReviewsPageState extends State<BranchReviewsPage>{
 MobileBranchReviews? page;bool busy=true;String? error;
 String t(String th,String en)=>widget.thai?th:en;
 @override void initState(){super.initState();load();}
 Future<void>load({String? cursor})async{setState((){busy=true;error=null;});try{final next=await widget.api.branchReviews(widget.branchId,cursor:cursor);if(mounted)setState(()=>page=next);}catch(e){if(mounted)setState(()=>error=t('โหลดรีวิวไม่สำเร็จ กรุณาโหลดใหม่','Could not load reviews. Please refresh.'));}finally{if(mounted)setState(()=>busy=false);}}
 String average(MobileBranchReviews data){final count=BigInt.parse(data.count);if(count==BigInt.zero)return t('ยังไม่มีคะแนน','No ratings yet');final tenths=(BigInt.parse(data.starTotal)*BigInt.from(10)+count~/BigInt.two)~/count;return '${tenths~/BigInt.from(10)}.${tenths%BigInt.from(10)} / 5';}
 @override Widget build(BuildContext context)=>Scaffold(appBar:bitPosAppBar(context,title:Text(t('รีวิวจากลูกค้า','Customer reviews'))),body:ListView(padding:const EdgeInsets.all(24),children:[
  if(busy)const LinearProgressIndicator(),if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
  if(page!=null)...[Text(average(page!),style:Theme.of(context).textTheme.headlineMedium),Text('${page!.count} ${t('รีวิวที่เผยแพร่','published reviews')}'),const SizedBox(height:24),if(page!.items.isEmpty)Text(t('ยังไม่มีรีวิวที่เผยแพร่ในหน้านี้','No published reviews on this page.')),
   for(final review in page!.items)Card(margin:const EdgeInsets.only(bottom:16),child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(t('ลูกค้าที่รับอาหารแล้ว','Verified meal customer')),const SizedBox(height:8),Text('${review.stars} / 5',style:Theme.of(context).textTheme.titleMedium),if(review.body.isNotEmpty)Padding(padding:const EdgeInsets.only(top:12),child:SelectableText(review.body))]))),
   if(page!.nextCursor!=null)OutlinedButton(onPressed:busy?null:()=>load(cursor:page!.nextCursor),child:Text(t('หน้าถัดไป','Next page'))),
  ],OutlinedButton(onPressed:busy?null:()=>load(),child:Text(t('โหลดใหม่','Refresh'))),
 ]));
}
