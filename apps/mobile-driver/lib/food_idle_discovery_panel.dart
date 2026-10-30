import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/presentation/bitpos_info.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'food_idle_location_controller.dart';
class FoodIdleDiscoveryPanel extends StatefulWidget{
 const FoodIdleDiscoveryPanel({super.key,required this.api,required this.thai,required this.location,required this.canCapture});final MobileApi api;final bool thai,canCapture;final FoodIdleLocationController location;
 @override State<FoodIdleDiscoveryPanel> createState()=>_FoodIdleDiscoveryPanelState();
}
class _FoodIdleDiscoveryPanelState extends State<FoodIdleDiscoveryPanel> with AutomaticKeepAliveClientMixin{
 FoodIdleLocationController get _location=>widget.location;FoodDiscoverySnapshot? _snapshot;FoodDiscoveryConsentCommand? _pending;final _selected=<(String,String)>{};bool _busy=false,_withdrawalRequested=false;Object? _error;Timer? _retryTimer;int _retryAttempt=0;
 String t(String th,String en)=>widget.thai?th:en;
 void _changed(){
  if(!mounted)return;
  if(SchedulerBinding.instance.schedulerPhase==SchedulerPhase.persistentCallbacks){
   WidgetsBinding.instance.addPostFrameCallback((_){if(mounted)setState((){});});
  }else{setState((){});}
 }
 @override void initState(){super.initState();_location.addListener(_changed);widget.api.reconnects.addListener(_onReconnect);unawaited(_run(_load));}
 @override bool get wantKeepAlive=>true;
 @override void deactivate(){_location.removeListener(_changed);super.deactivate();}
 @override void activate(){super.activate();_location.addListener(_changed);}
 @override void didUpdateWidget(covariant FoodIdleDiscoveryPanel old){super.didUpdateWidget(old);if(!widget.canCapture)unawaited(_location.stop());}
 Future<void> _load()async{final snapshot=await widget.api.foodDiscovery();final pending=await widget.api.pendingFoodDiscoveryConsent();if(!mounted)return;setState((){_snapshot=snapshot;_pending=pending;_selected.clear();for(final service in snapshot.services){if(service.selected&&service.eligible)_selected.add((service.merchantId,service.branchId));}});}
 Future<void> _run(Future<void> Function() action)async{if(_busy)return;setState((){_busy=true;_error=null;});try{await action();_retryAttempt=0;}catch(error){if(mounted){setState(()=>_error=error);if(isConnectivityError(error))_scheduleRetry();}}finally{if(mounted)setState(()=>_busy=false);}}
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
 String _when(String iso){
  final d=DateTime.tryParse(iso)?.toLocal();if(d==null)return '';
  String two(int n)=>n.toString().padLeft(2,'0');
  return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
 }
 String _errorText(Object error){
  if(isConnectivityError(error))return t('กำลังเชื่อมต่อใหม่...','Reconnecting...');
  return t('ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง','That did not work. Please try again.');
 }
 void _scheduleRetry(){
  _retryTimer?.cancel();
  final seconds=const [2,4,8,15][_retryAttempt<3?_retryAttempt:3];_retryAttempt++;
  _retryTimer=Timer(Duration(seconds:seconds),(){if(mounted&&!_busy&&isConnectivityError(_error))unawaited(_run(_load));});
 }
 void _onReconnect(){if(mounted&&!_busy&&(_error!=null||_snapshot==null)){_retryTimer?.cancel();unawaited(_run(_load));}}
 @override Widget build(BuildContext context){super.build(context);
  final eligible=_snapshot?.services.where((s)=>s.eligible).toList()??const <FoodDiscoveryService>[];
  return Card(child:Padding(padding:const EdgeInsets.all(20),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
  Row(children:[
   Expanded(child:Text(t('แชร์ตำแหน่งเพื่อรับงานใกล้คุณ','Share location to get nearby jobs'),style:Theme.of(context).textTheme.titleMedium)),
   BitPosInfoButton(thai:widget.thai,title:t('ตำแหน่งส่วนตัวสำหรับจับคู่งานอาหาร','Private location for food matching'),paragraphs:[
    t('สมัครใจแยกจากออนไลน์และ GPS ของงาน แชร์เฉพาะระบบจับคู่ ไม่มีแผนที่คนขับว่างสาธารณะ ปิดหน้านี้จะหยุดจับพิกัด','Separate opt-in from online status and assignment GPS. Matching service only; no public idle-driver map. Leaving this surface stops capture.'),
    if(_snapshot?.consent case final consent?)'${t('ความยินยอม','Consent')}: ${consent.enabled?t('เปิด','on'):t('ปิด','off')} · ${consent.ownedBySession?t('เซสชันนี้','this session'):t('เซสชันอื่น','another session')} · v${consent.revision}',
    if(_location.lastReceivedAt!=null)'${t('เซิร์ฟเวอร์รับพิกัดล่าสุด','Last server location receipt')}: ${_location.lastReceivedAt!.toLocal()}',
   ]),
  ]),
  if(_busy)const LinearProgressIndicator(),
  if(_error!=null)Text(_errorText(_error!),style:TextStyle(color:isConnectivityError(_error)?Theme.of(context).colorScheme.onSurfaceVariant:Theme.of(context).colorScheme.error)),
  if(_location.error!=null)Text(_location.error!),
  if(_snapshot!=null)...[
   if(eligible.isEmpty)Text(t('ยังไม่มีพื้นที่บริการอาหารที่เจ้าหน้าที่อนุมัติ','No currently approved food service area. Contact operations.')),
   for(var i=0;i<eligible.length;i++)CheckboxListTile(contentPadding:EdgeInsets.zero,title:Text('${t('พื้นที่บริการ','Service area')} ${i+1}'),subtitle:Text('${t('อนุมัติถึง','Approved until')} ${_when(eligible[i].validUntil)}'),value:_selected.contains((eligible[i].merchantId,eligible[i].branchId)),onChanged:_busy||_pending!=null?null:(value)=>setState((){final id=(eligible[i].merchantId,eligible[i].branchId);if(value==true){_selected.add(id);}else{_selected.remove(id);}})),
   Text(_location.sharing?t('กำลังแชร์ตำแหน่งเพื่อจับคู่งาน','Sharing location for job matching'):t('ยังไม่ได้แชร์ตำแหน่ง','Location not shared')),
   const SizedBox(height:12),
   if(_pending!=null)FilledButton(onPressed:_busy?null:()=>_run(()=>_submit(!_withdrawalRequested&&_pending!.enabled)),child:Text(_withdrawalRequested?t('ลองถอนความยินยอมอีกครั้ง','Retry withdrawal safely'):t('ลองคำสั่งเดิมอีกครั้ง','Retry exact unresolved consent')))
   else FilledButton(onPressed:_busy||_selected.isEmpty?null:()=>_run(()=>_submit(true)),child:Text(t('ยินยอมและเริ่ม GPS ส่วนตัว','Consent and start private GPS'))),
   const SizedBox(height:12),
   OutlinedButton(onPressed:_busy?null:()=>_run(()=>_submit(false)),child:Text(t('หยุดและถอนความยินยอม','Stop and revoke consent'))),
  ],
  if(_snapshot==null&&!_busy&&_error!=null&&!isConnectivityError(_error))TextButton(onPressed:()=>_run(_load),child:Text(t('ลองอีกครั้ง','Try again'))),
 ])));}
 @override void dispose(){_retryTimer?.cancel();widget.api.reconnects.removeListener(_onReconnect);_location.removeListener(_changed);unawaited(_location.stop());super.dispose();}
}
