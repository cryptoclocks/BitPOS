import 'dart:async';import 'package:flutter/material.dart';import 'package:flutter/services.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/mobile_v1.generated.dart';import 'package:mobile_shared/settlement_beneficiary_mutation.dart';
class PayoutBeneficiaryPage extends StatefulWidget{
 const PayoutBeneficiaryPage({super.key,required this.api,required this.thai});final MobileApi api;final bool thai;
 @override State<PayoutBeneficiaryPage> createState()=>_PayoutBeneficiaryPageState();
}
class _PayoutBeneficiaryPageState extends State<PayoutBeneficiaryPage> with WidgetsBindingObserver{
 final merchant=TextEditingController(),destination=TextEditingController(),signature=TextEditingController();
 late final owner=widget.api.sessionScope;StreamSubscription<({String accountId,String sessionId})?>? owners;
 SettlementDriverPage? page;SettlementBeneficiaryMutation? pending;String? selected,error,notice;bool busy=false,retired=false;int generation=0;
 String t(String th,String en)=>widget.thai?th:en;
 @override void initState(){super.initState();WidgetsBinding.instance.addObserver(this);owners=widget.api.sessionScopes.listen((next){if(next!=owner&&mounted){generation++;setState((){retired=true;hide();});}});unawaited(load());}
 void hide(){busy=false;page=null;pending=null;selected=null;signature.clear();destination.clear();merchant.clear();error=null;notice=null;}
 @override void didChangeAppLifecycleState(AppLifecycleState state){if(state!=AppLifecycleState.resumed){generation++;setState(hide);}else if(!retired){unawaited(load());}}
 Future<void> run(Future<void> Function(int current) action)async{
  if(busy||retired)return;final current=++generation;setState((){busy=true;error=null;notice=null;});
  try{await action(current);}catch(error){if(mounted&&current==generation)setState(()=>this.error=error is MobileApiException&&error.code=='BENEFICIARY_AUTHORITY_STILL_LIVE'?t('เซสชันเดิมยังมีสิทธิ์ กรุณาเพิกถอนเซสชันเดิมก่อนกู้คืน ไม่ส่งคำสั่งด้วยเซสชันใหม่','Original session is still live. Revoke it before recovery; this session will not replay its command.'):error is MobileApiException&&error.code=='RESOURCE_NOT_FOUND'&&pending==null?t('ไม่พบร้านที่คุณมีสิทธิ์ลงทะเบียน ตรวจรหัสร้านแล้วลองใหม่','No eligible merchant found. Correct the merchant UUID and try again.'):t('ผลอาจยังไม่ทราบ โหลดคำสั่งเดิมและลองซ้ำ ห้ามเปลี่ยนข้อมูลเพื่อส่งแทน','Outcome may be unknown. Reload and retry the exact saved command; do not replace it.'));}
  finally{if(mounted&&current==generation)setState(()=>busy=false);}
 }
 bool get validOwner=>mounted&&!retired&&widget.api.sessionScope==owner;
 Future<void> load()async=>run((current)async{
  final saved=await widget.api.pendingSettlementBeneficiary(),facts=await widget.api.driverEarnings();if(!validOwner||current!=generation)return;
  setState((){pending=saved;page=facts;});
 });
 Future<void> submit(SettlementBeneficiaryMutation command)async=>run((current)async{
  final receipt=await widget.api.submitSettlementBeneficiary(command);if(!validOwner||current!=generation)return;
  final facts=await widget.api.driverEarnings();if(!validOwner||current!=generation)return;
  setState((){page=facts;pending=null;signature.clear();if(receipt is SettlementBeneficiaryPendingReceipt)selected=receipt.beneficiaryId;notice=t('บันทึกสิทธิ์เจ้าของแล้ว ไม่ใช่การอนุมัติหรือยืนยันโอนเงิน','Ownership command recorded; not payout approval or transfer confirmation.');});
 });
 Future<void> copyChallenge(SettlementOwnershipChallenge challenge)async{
  final current=generation;
  try{
   await Clipboard.setData(ClipboardData(text:settlementOwnershipMessage(challenge)));
   if(!validOwner||current!=generation)return;
   setState((){error=null;notice=t('คัดลอกข้อความตามไบต์แล้ว ให้กระเป๋าที่ตรงปลายทางลงนามข้อความ ไม่ใช่ธุรกรรม','Exact message copied. Use the matching destination wallet to sign this message, not a transaction.');});
  }catch(_){
   if(!validOwner||current!=generation)return;
   setState((){notice=null;error=t('คัดลอกไม่สำเร็จ เลือกข้อความด้านบนเพื่อคัดลอกเอง ไม่มีการส่งคำสั่งหรือโอนเงิน','Could not copy. Select the message above to copy manually. No command or transfer was submitted.');});
  }
 }
 @override Widget build(BuildContext context){
  SettlementBeneficiarySummary? beneficiary;for(final row in page?.beneficiaries??<SettlementBeneficiarySummary>[]){if(row.beneficiaryId==selected)beneficiary=row;}
  final challenge=beneficiary?.challenge;
  final eligibleMerchants=(page?.items??<SettlementEarningItem>[]).map((item)=>item.merchantId).toSet().toList()..sort();
  return Scaffold(appBar:AppBar(title:Text(t('กระเป๋ารับเงินของคุณ','Your payout destination'))),body:SafeArea(child:ListView(padding:const EdgeInsets.all(24),children:[
   Text(t('ลงทะเบียนกุญแจสาธารณะของคุณสำหรับร้านที่เคยส่งงาน ระบบตรวจสอบความเป็นเจ้าของบัญชีและอุปกรณ์ ห้ามป้อน private key หรือ seed phrase','Enroll your public key for a merchant you have served. Account/device ownership is server-enforced. Never enter private keys or seed phrases.')),
   Text(t('ใช้การลงนามข้อความในกระเป๋าภายนอกเท่านั้น ไม่มีการลงนามธุรกรรมหรือส่งเงินในหน้านี้','External wallet sign-message handoff only. This page never signs a transaction or sends funds.')),
   if(widget.api.fixture)Text(t('ข้อมูลทดสอบในเครื่อง / AVD ไม่ใช่การโอนจริง','LOCAL / AVD FIXTURE — no real transfer')),
   if(busy)const LinearProgressIndicator(),if(retired)Text(t('เซสชันเปลี่ยนแล้ว ข้อมูลถูกซ่อน','Session changed; private facts hidden.')),
   if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),if(notice!=null)Text(notice!),
   if(!retired)...[
    OutlinedButton(onPressed:busy?null:load,child:Text(t('โหลดข้อเท็จจริงและคำสั่งเดิม','Reload facts and saved command'))),
    if(pending!=null)...[Text(t('มีคำสั่งเดิมที่ยังไม่ทราบผล ห้ามสร้างรายการทดแทน','Original command unresolved; replacement prohibited.')),Text(pending!.kind),FilledButton(onPressed:busy?null:()=>submit(pending!),child:Text(t('ส่งซ้ำคำสั่งเดิมทุกไบต์','Retry exact saved command')))],
    if(page!=null)...[
     Text(t('แสดงประวัติผู้รับล่าสุดไม่เกิน 50 รายการ ไม่ใช่ยอดเงินหรือผู้รับของบัญชีอื่น','Up to 50 latest owned beneficiary records; not a balance or another account’s beneficiaries.')),
     for(final row in page!.beneficiaries)ListTile(selected:selected==row.beneficiaryId,onTap:busy?null:()=>setState((){selected=row.beneficiaryId;signature.clear();}),leading:Icon(selected==row.beneficiaryId?Icons.radio_button_checked:Icons.radio_button_unchecked),title:Text('${row.state} · ${row.beneficiaryId}'),subtitle:Text('${t('ร้าน','Merchant')}: ${row.merchantId} · v${row.version}')),
     if(eligibleMerchants.isNotEmpty)Padding(padding:const EdgeInsets.only(bottom:16),child:DropdownButtonFormField<String>(
      initialValue:eligibleMerchants.contains(merchant.text.trim())?merchant.text.trim():null,
      isExpanded:true,decoration:InputDecoration(labelText:t('เลือกร้านจากประวัติรายได้ที่โหลด','Choose a merchant from loaded earnings')),
      items:eligibleMerchants.map((id)=>DropdownMenuItem(value:id,child:Text(id,overflow:TextOverflow.ellipsis))).toList(),
      onChanged:busy||pending!=null?null:(id){if(id!=null)setState(()=>merchant.text=id);},
     )),
     Text(t('รายการร้านมาจากประวัติที่โหลด หากไม่พบร้าน ใช้รหัสด้านล่าง เซิร์ฟเวอร์ตรวจสิทธิ์อีกครั้ง','Choices come from loaded earnings only. If absent, enter the merchant ID below; the server checks eligibility again.')),
     TextField(controller:merchant,enabled:!busy&&pending==null,decoration:InputDecoration(labelText:t('รหัสร้าน UUID','Merchant UUID'))),TextField(controller:destination,enabled:!busy&&pending==null,autocorrect:false,decoration:InputDecoration(labelText:t('กุญแจสาธารณะผู้รับ Solana devnet','Solana devnet recipient public key'))),
     FilledButton(onPressed:busy||pending!=null?null:(){try{unawaited(submit(widget.api.enrollSettlementBeneficiary(merchant.text.trim(),destination.text.trim())));}catch(_){setState(()=>error=t('ตรวจ UUID และกุญแจสาธารณะ ห้ามป้อนกุญแจส่วนตัว','Check merchant UUID and public key; never enter a private key.'));}},child:Text(t('สร้างคำขอพิสูจน์เจ้าของ','Create ownership challenge'))),
     if(beneficiary!=null)...[Text('${t('สถานะจากเซิร์ฟเวอร์','Server state')}: ${beneficiary.state}'),if(challenge==null&&beneficiary.state=='PENDING')Text(t('คำขอหมดอายุหรือไม่ได้สร้างในเซสชัน/อุปกรณ์นี้ สร้างคำขอใหม่หลังแก้ไขคำสั่งค้าง','Challenge expired or belongs to another session/device. Resolve saved commands before a fresh enrollment.'))],
     if(challenge!=null)...[
      Text('${t('ปลายทาง','Destination')}: ${challenge.destinationOwner}'),Text('${t('หมดอายุ','Expires')}: ${challenge.expiresAt}'),SelectableText(settlementOwnershipMessage(challenge)),
      OutlinedButton(onPressed:busy?null:()=>copyChallenge(challenge),child:Text(t('คัดลอกข้อความสำหรับลงนาม','Copy exact signing message'))),
      TextField(controller:signature,enabled:!busy&&pending==null,autocorrect:false,enableSuggestions:false,decoration:InputDecoration(labelText:t('ลายเซ็นข้อความ Base58 จากกระเป๋าภายนอก','Base58 message signature from external wallet'))),
      FilledButton(onPressed:busy||pending!=null?null:(){try{unawaited(submit(widget.api.verifySettlementBeneficiary(beneficiary!.beneficiaryId,beneficiary.version,signature.text.trim())));}catch(_){setState(()=>error=t('ลายเซ็นต้องเป็น Base58 ของข้อความนี้เท่านั้น','A Base58 signature for this exact message is required.'));}},child:Text(t('ส่งลายเซ็นให้เซิร์ฟเวอร์ตรวจสอบ','Submit signature for server verification'))),
     ],
    ],
   ],
  ])));
 }
 @override void dispose(){generation++;unawaited(owners?.cancel());WidgetsBinding.instance.removeObserver(this);merchant.dispose();destination.dispose();signature.dispose();super.dispose();}
}
