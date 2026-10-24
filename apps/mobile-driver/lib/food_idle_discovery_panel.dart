import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'food_idle_location_controller.dart';
class FoodIdleDiscoveryPanel extends StatefulWidget{
 const FoodIdleDiscoveryPanel({super.key,required this.api,required this.thai,required this.location,required this.canCapture});final MobileApi api;final bool thai,canCapture;final FoodIdleLocationController location;
 @override State<FoodIdleDiscoveryPanel> createState()=>_FoodIdleDiscoveryPanelState();
}
class _FoodIdleDiscoveryPanelState extends State<FoodIdleDiscoveryPanel> with AutomaticKeepAliveClientMixin{
 FoodIdleLocationController get _location=>widget.location;FoodDiscoverySnapshot? _snapshot;FoodDiscoveryConsentCommand? _pending;final _selected=<(String,String)>{};bool _busy=false,_withdrawalRequested=false;Object? _error;
 String t(String th,String en)=>widget.thai?th:en;
 void _changed(){
  if(!mounted)return;
  if(SchedulerBinding.instance.schedulerPhase==SchedulerPhase.persistentCallbacks){
   WidgetsBinding.instance.addPostFrameCallback((_){if(mounted)setState((){});});
  }else{setState((){});}
 }
 @override void initState(){super.initState();_location.addListener(_changed);unawaited(_run(_load));}
 @override bool get wantKeepAlive=>true;
 @override void deactivate(){_location.removeListener(_changed);super.deactivate();}
 @override void activate(){super.activate();_location.addListener(_changed);}
 @override void didUpdateWidget(covariant FoodIdleDiscoveryPanel old){super.didUpdateWidget(old);if(!widget.canCapture)unawaited(_location.stop());}
 Future<void> _load()async{final snapshot=await widget.api.foodDiscovery();final pending=await widget.api.pendingFoodDiscoveryConsent();if(!mounted)return;setState((){_snapshot=snapshot;_pending=pending;_selected.clear();for(final service in snapshot.services){if(service.selected&&service.eligible)_selected.add((service.merchantId,service.branchId));}});}
 Future<void> _run(Future<void> Function() action)async{if(_busy)return;setState((){_busy=true;_error=null;});try{await action();}catch(error){if(mounted)setState(()=>_error=error);}finally{if(mounted)setState(()=>_busy=false);}}
 Future<void> _submit(bool enabled)async{
  if(enabled&&_pending==null)_withdrawalRequested=false;
  if(!enabled)_withdrawalRequested=true;
  await _location.stop();if(!mounted||_snapshot==null)return;
  final capture=enabled&&!_withdrawalRequested;
  try{
   // Resolve an ambiguous enable exactly before a new revoke, never restarting GPS.
   if(!capture&&_pending?.enabled==true){await widget.api.foodDiscoveryConsent(_pending!);if(!mounted)return;_pending=null;await _load();if(!mounted)return;}
   final command=_pending??widget.api.foodDiscoveryCommand(_snapshot!,capture,capture?_selected.map((id)=>FoodDiscoveryZone(merchantId:id.$1,branchId:id.$2)).toList():[]);
   _pending=command;final receipt=await widget.api.foodDiscoveryConsent(command);if(!mounted)return;_pending=null;await _load();if(!mounted)return;
   if(capture&&command.enabled&&widget.canCapture)await _location.start(receipt.revision);
   if(!capture)_withdrawalRequested=false;
  }
  on MobileApiException catch(error){if(['INVALID_REQUEST','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','ROLE_REQUIRED','DRIVER_UNAVAILABLE','RESOURCE_NOT_FOUND'].contains(error.code)){_pending=null;await _load();}rethrow;}
 }
 @override Widget build(BuildContext context){super.build(context);return Card(child:Padding(padding:const EdgeInsets.all(20),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
  Text(t('ตำแหน่งส่วนตัวสำหรับจับคู่งานอาหาร','Private location for food matching'),style:Theme.of(context).textTheme.titleMedium),
  const SizedBox(height:8),
  Text(t('สมัครใจแยกจากออนไลน์และ GPS ของงาน แชร์เฉพาะระบบจับคู่ ไม่มีแผนที่คนขับว่างสาธารณะ ปิดหน้านี้จะหยุดจับพิกัด','Separate opt-in from online status and assignment GPS. Matching service only; no public idle-driver map. Leaving this surface stops capture.')),
  const SizedBox(height:16),
  if(_busy)const LinearProgressIndicator(),if(_error!=null)Text(_error.toString(),style:TextStyle(color:Theme.of(context).colorScheme.error)),
  if(_location.error!=null)Text(_location.error!),
  if(_snapshot case final snapshot?)...[
   if(snapshot.services.where((s)=>s.eligible).isEmpty)Text(t('ยังไม่มีพื้นที่บริการอาหารที่เจ้าหน้าที่อนุมัติ','No currently approved food service area. Contact operations.')),
   for(final service in snapshot.services.where((s)=>s.eligible))CheckboxListTile(contentPadding:EdgeInsets.zero,title:Text('${service.merchantId} / ${service.branchId}'),subtitle:Text('${t('อนุมัติถึง','Approved until')}: ${service.validUntil}'),value:_selected.contains((service.merchantId,service.branchId)),onChanged:_busy||_pending!=null?null:(value)=>setState((){if(value==true){_selected.add((service.merchantId,service.branchId));}else{_selected.remove((service.merchantId,service.branchId));}})),
   if(snapshot.consent case final consent?)Text('${t('ความยินยอมบนเซิร์ฟเวอร์','Server consent')}: ${consent.enabled} · v${consent.revision} · ${consent.ownedBySession?t('เซสชันนี้','this session'):t('เซสชันอื่น','another session')}'),
   if(_location.lastReceivedAt!=null)Text('${t('เซิร์ฟเวอร์รับพิกัดล่าสุด','Last server location receipt')}: ${_location.lastReceivedAt!.toLocal()}'),
   Text(_location.sharing?t('กำลังจับพิกัดเพื่อจับคู่งาน','Capturing private matching location'):t('ไม่ได้จับพิกัด','Not capturing location')),
   const SizedBox(height:16),
   if(_pending!=null)FilledButton(onPressed:_busy?null:()=>_run(()=>_submit(!_withdrawalRequested&&_pending!.enabled)),child:Text(_withdrawalRequested?t('ลองถอนความยินยอมอย่างปลอดภัย','Retry withdrawal safely'):t('ลองคำสั่งเดิมที่ยังไม่ทราบผล','Retry exact unresolved consent')))
   else FilledButton(onPressed:_busy||_selected.isEmpty?null:()=>_run(()=>_submit(true)),child:Text(t('ยินยอมและเริ่ม GPS ส่วนตัว','Consent and start private GPS'))),
   const SizedBox(height:12),
   OutlinedButton(onPressed:_busy?null:()=>_run(()=>_submit(false)),child:Text(t('หยุดและถอนความยินยอม','Stop and revoke consent'))),
  ],
  TextButton(onPressed:_busy?null:()=>_run(_load),child:Text(t('โหลดสถานะล่าสุด','Refresh status'))),
 ])));}
 @override void dispose(){_location.removeListener(_changed);unawaited(_location.stop());super.dispose();}
}
