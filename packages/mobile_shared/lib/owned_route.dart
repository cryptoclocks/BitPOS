import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

// Dispose runs while the tree is locked. Never pop an unrelated replacement route.
void removeOwnedRoute(Route<dynamic>? route) {
 if(route==null)return;
 void remove(){
  final navigator=route.navigator;
  if(navigator!=null&&navigator.mounted&&route.isActive)navigator.removeRoute(route);
 }
 if(WidgetsBinding.instance.schedulerPhase==SchedulerPhase.persistentCallbacks){
  WidgetsBinding.instance.addPostFrameCallback((_)=>remove());
 }else{
  remove();
 }
}
