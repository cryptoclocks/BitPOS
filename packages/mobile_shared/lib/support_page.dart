import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/support_mutation.dart';
import 'package:mobile_shared/owned_route.dart';
import 'package:mobile_shared/presentation/bitpos_layout.dart';
class SupportPage extends StatefulWidget{
 const SupportPage({super.key,required this.api,required this.owner,required this.thai,required this.onAuthenticationRequired,this.initialSubject='',this.order});
 final MobileSupportOrder? order;final String initialSubject;final MobileApi api;final ValueListenable<bool>? owner;final bool thai;final VoidCallback onAuthenticationRequired;
 @override State<SupportPage> createState()=>_SupportPageState();
}
class _SupportPageState extends State<SupportPage>{
 final subject=TextEditingController(),message=TextEditingController();
 MobileSupportCases? cases;MobileSupportMessages? messages;MobileSupportCase? selected;SupportMutation? pending;
 bool busy=true;String? error;ModalRoute<dynamic>? route;
 bool get current=>mounted&&(widget.owner?.value??true);
 String t(String th,String en)=>widget.thai?th:en;
 @override void initState(){super.initState();subject.text=widget.initialSubject;widget.owner?.addListener(ownerChanged);if(widget.owner?.value??true)loadInitial();}
 @override void didChangeDependencies(){super.didChangeDependencies();route=ModalRoute.of(context);if(widget.owner?.value==false)WidgetsBinding.instance.addPostFrameCallback((_)=>ownerChanged());}
 void ownerChanged(){if(widget.owner?.value==false)removeOwnedRoute(route);}
 @override void dispose(){widget.owner?.removeListener(ownerChanged);subject.dispose();message.dispose();super.dispose();}
 Future<void> loadInitial()async{await run(()async{final saved=await widget.api.pendingSupportMutation();if(!current)return;pending=saved;final page=await widget.api.supportCases();if(current)setState(()=>cases=page);},initial:true);}
 Future<void> run(Future<void> Function() action,{bool initial=false})async{
  if(!current||busy&&!initial)return;setState((){busy=true;error=null;});
  try{await action();}catch(e){if(current){if(e is MobileApiException&&e.code=='AUTH_REQUIRED'&&!widget.api.signedIn){widget.onAuthenticationRequired();}else{setState(()=>error=t('ดำเนินการไม่สำเร็จ โหลดใหม่หรือกู้คืนคำขอที่บันทึกไว้','Could not complete. Refresh or recover your saved request.'));}}}
  finally{if(current)setState(()=>busy=false);}
 }
 Future<void> refresh({String? cursor})async{
  if(selected==null){final page=await widget.api.supportCases(cursor:cursor);if(current)setState(()=>cases=page);}
  else{final id=selected!.id;final latest=await widget.api.supportCase(id);if(!current||selected?.id!=id)return;final page=await widget.api.supportMessages(id,cursor:cursor);if(current&&selected?.id==id)setState((){selected=latest;messages=page;});}
 }
 Future<void> submit(SupportMutation command)async{
  setState(()=>pending=command);
  try{await widget.api.submitSupportMutation(command);}finally{if(current){final saved=await widget.api.pendingSupportMutation();if(current)setState(()=>pending=saved);}}
  if(!current)return;subject.clear();message.clear();await refresh();
 }
 String stamp(String value){final d=DateTime.parse(value).toLocal();String two(int n)=>n.toString().padLeft(2,'0');return '${two(d.day)}/${two(d.month)}/${d.year} · ${two(d.hour)}:${two(d.minute)}';}
 String stateLabel(String state)=>switch(state){'RESOLVED'=>t('ปิดคำร้องแล้ว','Resolved'),'WAITING_CUSTOMER'=>t('รอข้อมูลจากคุณ','Waiting for you'),_=>t('เปิดคำร้อง','Open')};
 @override Widget build(BuildContext context){
  final locked=busy||pending!=null;
  return Scaffold(appBar:bitPosAppBar(context,title:Text(t('ศูนย์ช่วยเหลือ','Help centre'))),body:ListView(padding:const EdgeInsets.all(24),children:[
   Text(t('ติดตามคำร้องของคุณและโหลดข้อความล่าสุดได้ที่นี่','Track your requests and refresh for the latest messages.')),
   if(widget.order!=null)Padding(padding:const EdgeInsets.only(top:12),child:Text('${t('เกี่ยวกับออเดอร์','Regarding order')} #${widget.order!.orderId.substring(0,8)}')),
   const SizedBox(height:16),if(busy)const LinearProgressIndicator(),if(error!=null)Text(error!,style:TextStyle(color:Theme.of(context).colorScheme.error)),
   if(pending!=null)Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(children:[Text(t('มีคำขอที่บันทึกไว้ กรุณากู้คืนก่อนส่งข้อความใหม่','A saved request needs recovery before sending another.')),FilledButton(onPressed:busy?null:()=>run(()=>submit(pending!)),child:Text(t('กู้คืนคำขอเดิม','Recover saved request')))]))),
   if(selected!=null)TextButton.icon(onPressed:busy?null:()=>setState((){selected=null;messages=null;message.clear();}),icon:const Icon(Icons.arrow_back),label:Text(t('คำร้องทั้งหมด','All requests'))),
   if(selected==null)...[
    Text(t('คำร้องของคุณ','Your requests'),style:Theme.of(context).textTheme.titleLarge),const SizedBox(height:12),
    if(cases!=null&&cases!.items.isEmpty)Text(t('ยังไม่มีคำร้อง','No requests yet.')),
    for(final ticket in cases?.items??<MobileSupportCase>[])Card(margin:const EdgeInsets.only(bottom:12),child:ListTile(title:Text(ticket.subject),subtitle:Text('${stateLabel(ticket.state)} · ${stamp(ticket.createdAt)}'),trailing:const Icon(Icons.chevron_right),onTap:busy?null:()=>run(()async{final page=await widget.api.supportMessages(ticket.id);if(current)setState((){selected=ticket;messages=page;message.clear();});}))),
    const SizedBox(height:24),Text(t('สร้างคำร้อง','New request'),style:Theme.of(context).textTheme.titleLarge),const SizedBox(height:16),
    TextField(controller:subject,enabled:!locked,maxLength:160,decoration:InputDecoration(labelText:t('หัวข้อ','Subject'))),
   ]else...[
    Text(selected!.subject,style:Theme.of(context).textTheme.titleLarge),Text(stateLabel(selected!.state)),const SizedBox(height:16),
    for(final entry in [...?messages?.items]..sort((a,b)=>a.createdAt.compareTo(b.createdAt)))Card(margin:const EdgeInsets.only(bottom:12),child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[SelectableText(entry.body),const SizedBox(height:8),Text('${entry.authorKind=='STAFF'?t('ทีมช่วยเหลือ','Support team'):t('คุณ','You')} · ${stamp(entry.createdAt)}',style:Theme.of(context).textTheme.bodySmall)]))),
   ],
   if(selected?.state!='RESOLVED')...[
    TextField(controller:message,enabled:!locked,maxLength:4000,minLines:3,maxLines:8,decoration:InputDecoration(labelText:t('ข้อความ','Message'))),
    const SizedBox(height:8),FilledButton(onPressed:locked?null:()=>run(()async{if(message.text.trim().isEmpty||selected==null&&subject.text.trim().isEmpty){setState(()=>error=t('กรุณากรอกหัวข้อและข้อความ','Enter a subject and message.'));return;}await submit(selected==null?widget.api.newSupportCase(subject.text,message.text,order:widget.order):widget.api.newSupportMessage(selected!.id,message.text));}),child:Text(t('ส่งคำร้อง / ข้อความ','Send request / message'))),
   ],
   const SizedBox(height:16),Wrap(spacing:12,children:[OutlinedButton(onPressed:busy?null:()=>run(()=>refresh()),child:Text(t('โหลดใหม่','Refresh'))),if((selected==null?cases?.nextCursor:messages?.nextCursor)!=null)OutlinedButton(onPressed:busy?null:()=>run(()=>refresh(cursor:selected==null?cases!.nextCursor:messages!.nextCursor)),child:Text(t('หน้าถัดไป','Next page')))]),
  ]));
 }
}
