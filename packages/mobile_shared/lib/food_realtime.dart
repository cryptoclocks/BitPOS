part of 'mobile_api.dart';

/// Disconnected/connecting states intentionally carry no private snapshot.
sealed class FoodRealtimeState<T> {
 const FoodRealtimeState();
 T? get snapshot=>null;
 Object? get error=>null;
}
final class FoodRealtimeConnecting<T> extends FoodRealtimeState<T> {const FoodRealtimeConnecting();}
final class FoodRealtimeLive<T> extends FoodRealtimeState<T> {
 const FoodRealtimeLive(this.snapshot);
 @override final T snapshot;
}
final class FoodRealtimeDisconnected<T> extends FoodRealtimeState<T> {
 const FoodRealtimeDisconnected(this.error);
 @override final Object error;
}

Stream<FoodRealtimeState<T>> _watchFood<T>(MobileApi api,String path,T Function(Map<String,dynamic>) decode){
 late StreamController<FoodRealtimeState<T>> controller;
 final stopped=Completer<void>();
 Completer<void>? abort;
 StreamSubscription<void>? sessionChanges;
 bool cancelled=false;
 String? cursor;
 void stop(){if(cancelled)return;cancelled=true;if(!stopped.isCompleted)stopped.complete();if(!(abort?.isCompleted??true))abort!.complete();}
 void emit(FoodRealtimeState<T> state){if(!cancelled&&!controller.isClosed)controller.add(state);}
 Future<void> run() async {
  var retry=0;
  final logicalOwner=api._session;
  var ownershipLost=false;
  bool sameOwner()=>logicalOwner!=null&&api._session?.accountId==logicalOwner.accountId&&api._session?.sessionId==logicalOwner.sessionId;
  MobileApiException ownerError()=>MobileApiException(api._session==null?'AUTH_REQUIRED':'SESSION_CHANGED',api._session==null?401:409);
  sessionChanges=api._sessionChanges.stream.listen((_){
   if(!sameOwner()){ownershipLost=true;if(!stopped.isCompleted)stopped.complete();}
   if(!(abort?.isCompleted??true))abort!.complete();
  },onDone:stop);
  try{
   while(!cancelled){
    if(ownershipLost||!sameOwner())throw ownerError();
    emit(FoodRealtimeConnecting<T>());
    if(api._session==null)throw const MobileApiException('AUTH_REQUIRED',401);
    if(!DateTime.parse(api._session!.accessExpiresAt).isAfter(DateTime.now().add(const Duration(seconds:30)))){
     await (api._refreshing??=api._refresh().whenComplete(()=>api._refreshing=null));
    }
    if(cancelled)break;
    if(ownershipLost||!sameOwner())throw ownerError();
    final owner=api._session;
    abort=Completer<void>();
    final request=http.AbortableRequest('GET',api.base.resolve(path),abortTrigger:abort!.future);
    request.headers.addAll({'Authorization':'Bearer ${owner!.accessToken}','Accept':'text/event-stream',if(cursor!=null)'Last-Event-ID':cursor!});
    try{
     final response=await api._client.send(request).timeout(const Duration(seconds:10),onTimeout:(){if(!abort!.isCompleted)abort!.complete();throw TimeoutException('Realtime admission deadline');});
     if(cancelled||!identical(api._session,owner)){await response.stream.listen((_){}).cancel();throw const MobileApiException('SESSION_CHANGED',409);}
     if(response.statusCode!=200){await response.stream.listen((_){}).cancel();if(response.statusCode==401&&identical(api._session,owner))await api._writeSession(owner,null);throw MobileApiException(response.statusCode==401?'AUTH_REQUIRED':'REALTIME_UNAVAILABLE',response.statusCode);}
     if(response.headers['content-type']?.split(';').first.trim()!='text/event-stream'){await response.stream.listen((_){}).cancel();throw const FormatException('Invalid realtime content type');}
     await for(final frame in _foodFrames(response.stream.timeout(const Duration(seconds:12)))){
      if(cancelled||!identical(api._session,owner))throw const MobileApiException('SESSION_CHANGED',409);
      if(frame.event=='clear')throw const MobileApiException('REALTIME_REAUTHORIZE',409);
      if(frame.event!='snapshot')throw const FormatException('Unknown realtime frame');
      final value=jsonDecode(frame.data);
      if(value is! Map<String,dynamic>||value['cursor']!=frame.id||!RegExp(r'^f1_[A-Za-z0-9_-]{43}$').hasMatch(frame.id))throw const FormatException('Invalid realtime cursor');
      final snapshot=decode(value);
      cursor=frame.id;retry=0;emit(FoodRealtimeLive<T>(snapshot));
     }
     throw const MobileApiException('REALTIME_DISCONNECTED',503);
    }catch(error){
     if(cancelled)break;
     if(ownershipLost||!sameOwner()){emit(FoodRealtimeDisconnected<T>(ownerError()));break;}
     emit(FoodRealtimeDisconnected<T>(error));
     if(error is MobileApiException&&[401,403,404].contains(error.status))break;
    }finally{
     if(!abort!.isCompleted)abort!.complete();abort=null;
    }
    retry=(retry+1).clamp(1,5);
    await Future.any([Future<void>.delayed(Duration(seconds:retry)),stopped.future]);
   }
  }catch(error){emit(FoodRealtimeDisconnected<T>(error));}
  finally{await sessionChanges?.cancel();if(!controller.isClosed)await controller.close();}
 }
 controller=StreamController<FoodRealtimeState<T>>(onListen:()=>unawaited(run()),onCancel:stop,onPause:stop);
 return controller.stream;
}

/// Parse bounded UTF-8 SSE frames before JSON allocation. No unbounded LineSplitter.
Stream<({String event,String id,String data})> _foodFrames(Stream<List<int>> source) async* {
 final line=BytesBuilder(copy:false);
 var bytes=0,event='',id='',data='';
 await for(final chunk in source){
  var start=0;
  for(var index=0;index<chunk.length;index++){
   if(chunk[index]!=10)continue;
   final length=index-start;
   bytes+=line.length+length+1;if(bytes>65536)throw const FormatException('Realtime frame too large');
   line.add(chunk.sublist(start,index));start=index+1;
   var text=utf8.decode(line.takeBytes());if(text.endsWith('\r'))text=text.substring(0,text.length-1);
   if(text.isEmpty){
    if(event.isNotEmpty){yield (event:event,id:id,data:data);}
    bytes=0;event='';id='';data='';
   }else if(text.startsWith('event: ')){event=text.substring(7);}
   else if(text.startsWith('id: ')){id=text.substring(4);}
   else if(text.startsWith('data: ')){if(data.isNotEmpty)throw const FormatException('Duplicate realtime data');data=text.substring(6);}
   else if(!text.startsWith(':')){throw const FormatException('Invalid realtime field');}
  }
  if(start<chunk.length){final rest=chunk.sublist(start);if(bytes+line.length+rest.length>65536)throw const FormatException('Realtime line too large');line.add(rest);}
 }
 if(line.isNotEmpty||event.isNotEmpty||data.isNotEmpty)throw const FormatException('Truncated realtime frame');
}
