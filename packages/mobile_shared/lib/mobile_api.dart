import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';
import 'mobile_v1.generated.dart';
import 'account_mutation.dart';
import 'support_mutation.dart';
import 'review_mutation.dart';
import 'driver_mutation.dart';
import 'food_dispatch_mutation.dart';
import 'food_cancellation_review_mutation.dart';
import 'settlement_beneficiary_mutation.dart';
part 'food_realtime.dart';
const _configuredResponseBytes=24*1024*1024;

class MobileApiException implements Exception {
  final String code;
  final int status;
  /// Server refusal reason (for example COUPON_ACCOUNT_LIMIT) when the error carries one.
  final String? reason;
  const MobileApiException(this.code, this.status, [this.reason]);
  @override
  String toString() => code;
}

String? _refusalReason(Object? error) {
  if (error is! Map) return null;
  final details = error['details'];
  final reason = details is Map ? details['reasonCode'] : error['message'];
  return reason is String && RegExp(r'^(COUPON|SCHEDULE)_[A-Z_]+$').hasMatch(reason) ? reason : null;
}

enum MobilePushApp {customer,driver}

/// Owns device identity, secure tokens and single-flight rotation. Mutations are
/// never automatically retried: an ambiguous result must use domain idempotency.
/// Monotonic viewport read acknowledgements are separately repeatable presentation cursors.
class MobileApi {
  final Uri base;
  final bool fixture;
  final FlutterSecureStorage storage;
  final http.Client _client;
  MobileSession? _session;
  String? _deviceId;
  Future<void>? _refreshing;
  Future<void> _sessionWrites = Future<void>.value();
  final _sessionChanges=StreamController<void>.broadcast(sync:true);
  Future<void> _accountOperations=Future<void>.value();
  Future<T> _accountOperation<T>(Future<T> Function() action){
    final operation=_accountOperations.then((_)=>action());
    _accountOperations=operation.then<void>((_) {},onError:(Object error,StackTrace stack) {});
    return operation;
  }
  Future<void> _foodOperations = Future<void>.value();
  // One durable journal across surface lifetimes. Network completion and its
  // cleanup must finish before a remounted surface may claim another command.
  Future<T> _foodOperation<T>(Future<T> Function() action) {
    final operation=_foodOperations.then((_)=>action());
    _foodOperations=operation.then<void>((_) {},onError:(Object error,StackTrace stack) {});
    return operation;
  }
  Future<void> _writeSession(MobileSession? expected,MobileSession? next) {
    final operation=_sessionWrites.then((_) async {
      if(!identical(_session,expected))throw const MobileApiException('SESSION_CHANGED',409);
      if(next==null){await storage.delete(key:'bitpos.mobileSession');}
      else{await storage.write(key:'bitpos.mobileSession',value:jsonEncode(next.toJson()));}
      _session=next;
      _sessionChanges.add(null);
    });
    _sessionWrites=operation.then((_) {},onError:(Object error,StackTrace stack) {});
    return operation;
  }
  MobileApi({required this.base, this.fixture = false,
    this.storage = const FlutterSecureStorage(), http.Client? client})
      : _client = client ?? http.Client() {
    final local = ['127.0.0.1', 'localhost', '10.0.2.2'].contains(base.host);
    if ((base.scheme != 'https' && !(fixture && local && base.scheme == 'http')) ||
        base.userInfo.isNotEmpty || base.hasQuery || base.hasFragment ||
        base.path != '/api/mobile/v1/') {
      throw ArgumentError('HTTPS mobile API base required; loopback HTTP needs explicit fixture mode');
    }
  }
  bool get signedIn => _session != null;
  ({String accountId,String sessionId})? get sessionScope=>_session==null?null:(accountId:_session!.accountId,sessionId:_session!.sessionId);
  Stream<({String accountId,String sessionId})?> get sessionScopes=>_sessionChanges.stream.map((_)=>sessionScope);
  Future<void> restore() async {
    _deviceId = await storage.read(key: 'bitpos.deviceId');
    if (_deviceId == null) {
      _deviceId = const Uuid().v4();
      await storage.write(key: 'bitpos.deviceId', value: _deviceId);
    }
    final saved = await storage.read(key: 'bitpos.mobileSession');
    if (saved != null) {
      try {
        _session = MobileSession.fromJson(jsonDecode(saved) as Map<String,dynamic>);
      } on FormatException {
        await storage.delete(key: 'bitpos.mobileSession');
      } on TypeError {
        await storage.delete(key: 'bitpos.mobileSession');
      }
    }
  }
  Future<Uint8List> _readResponse(http.StreamedResponse response,int maximum,Duration remaining,MobileSession? owner,bool authenticated) async {
    final done=Completer<Uint8List>(),bytes=BytesBuilder(copy:false);
    void fail(Object error){if(!done.isCompleted)done.completeError(error);}
    final changed=_sessionChanges.stream.listen((_){if(authenticated&&!identical(_session,owner))fail(const MobileApiException('SESSION_CHANGED',409));});
    final deadline=Timer(remaining,()=>fail(TimeoutException('API request deadline exceeded')));
    final subscription=response.stream.listen((chunk){
      if(done.isCompleted)return;
      if(authenticated&&!identical(_session,owner)){fail(const MobileApiException('SESSION_CHANGED',409));return;}
      if(bytes.length+chunk.length>maximum){fail(const FormatException('API response too large'));return;}
      bytes.add(chunk);
    },onError:(Object error)=>fail(error),onDone:(){if(!done.isCompleted)done.complete(bytes.takeBytes());});
    try{return await done.future;}finally{deadline.cancel();await subscription.cancel();await changed.cancel();}
  }
  Future<Map<String,dynamic>> _request(String path, {String method = 'GET',
      Map<String,dynamic>? body, bool authenticated = false, int maxResponseBytes=1024*1024,Map<String,String> extraHeaders=const {}}) async {
    if (authenticated) {
      if (_session == null) throw const MobileApiException('AUTH_REQUIRED', 401);
      if (!DateTime.parse(_session!.accessExpiresAt).isAfter(DateTime.now().add(const Duration(seconds: 30)))) {
        await (_refreshing ??= _refresh().whenComplete(() => _refreshing = null));
      }
    }
    final requestSession = _session;
    http.Request makeRequest() {
      final request = http.Request(method, base.resolve(path));
      request.headers['Content-Type'] = 'application/json';
      request.headers.addAll(extraHeaders);
      if (authenticated) request.headers['Authorization'] = 'Bearer ${requestSession!.accessToken}';
      if (body != null) request.body = jsonEncode(body);
      return request;
    }
    final elapsed=Stopwatch()..start();
    http.StreamedResponse streamed;
    try {
      streamed = await _client.send(makeRequest()).timeout(const Duration(seconds: 15));
    } on http.ClientException catch (error) {
      // A server may close an idle keep-alive socket just as the client reuses it.
      // Repeat only a read whose response never began; mutation commands are single-send.
      if (method != 'GET' || body != null ||
          !error.message.startsWith('Connection closed before full header was received')) rethrow;
      if (authenticated && !identical(_session, requestSession))
        throw const MobileApiException('SESSION_CHANGED', 409);
      final retryBudget=const Duration(seconds:15)-elapsed.elapsed;
      if (retryBudget<=Duration.zero) rethrow;
      streamed=await _client.send(makeRequest()).timeout(retryBudget);
    }
    final remaining=const Duration(seconds:15)-elapsed.elapsed;
    if(remaining<=Duration.zero||authenticated&&!identical(_session,requestSession)){
      await streamed.stream.listen((_){}).cancel();
      if(authenticated&&!identical(_session,requestSession))throw const MobileApiException('SESSION_CHANGED',409);
      throw TimeoutException('API request deadline exceeded');
    }
    final bytes=await _readResponse(streamed,maxResponseBytes,remaining,requestSession,authenticated);
    if(authenticated&&!identical(_session,requestSession))throw const MobileApiException('SESSION_CHANGED',409);
    final decoded = jsonDecode(utf8.decode(bytes));
    if (decoded is! Map<String,dynamic>) throw const FormatException('Invalid API response');
    if (streamed.statusCode < 200 || streamed.statusCode >= 300) {
      if (authenticated && streamed.statusCode == 401) {
        await _writeSession(requestSession,null);
      }
      final error = decoded['error'];
      throw MobileApiException(error is Map && error['code'] is String ? error['code'] as String : 'REQUEST_FAILED', streamed.statusCode, _refusalReason(error));
    }
    return decoded;
  }
  Future<void> requestOtp(String phone) async {
    await _request('auth/otp', method: 'POST', body: OtpRequest(phone: phone).toJson());
  }
  Future<void> verifyOtp(String phone, String code) async {
    if (_deviceId == null) throw StateError('Restore device identity before login');
    final result = await _request('auth/verify', method: 'POST',
      body: OtpVerification(phone: phone, code: code, deviceId: _deviceId!).toJson());
    final session = MobileSession.fromJson(result);
    // Persist before exposing authenticated state; storage failure is not login.
    await _writeSession(null,session);
  }
  Future<void> _refresh() async {
    final current = _session;
    if (current == null || _deviceId == null) throw const MobileApiException('AUTH_REQUIRED', 401);
    try {
      final result = await _request('auth/refresh', method: 'POST',
        body: RefreshRequest(refreshToken: current.refreshToken, deviceId: _deviceId!).toJson());
      final rotated = MobileSession.fromJson(result);
      if(!identical(_session,current))throw const MobileApiException('SESSION_CHANGED',409);
      await _writeSession(current,rotated);
    } on MobileApiException catch (error) {
      if (error.status == 401 && identical(_session,current)) {
        await _writeSession(current,null);
      }
      rethrow;
    }
  }
  Future<FoodDriverHistory> driverFoodHistory({String? cursor})async=>FoodDriverHistory.fromJson(await _request('driver/food/history${cursor==null?'':'?cursor=${Uri.encodeQueryComponent(cursor)}'}',authenticated:true));
  Future<MobileAccount> account() async => MobileAccount.fromJson(await _request('account', authenticated: true));
  Stream<FoodRealtimeState<FoodCustomerRealtimeSnapshot>> watchFoodDelivery(String orderId)=>_watchFood(this,'food/orders/${Uri.encodeComponent(orderId)}/delivery/events',FoodCustomerRealtimeSnapshot.fromJson);
  Stream<FoodRealtimeState<FoodChatRealtimeSnapshot>> watchFoodChat(String assignmentId)=>_watchFood(this,'food/assignments/${Uri.encodeComponent(assignmentId)}/chat/events',(json){
    final signal=FoodChatRealtimeSnapshot.fromJson(json);
    if(signal.assignmentId!=assignmentId)throw const FormatException('Chat signal scope mismatch');
    return signal;
  });
  Stream<FoodRealtimeState<FoodDriverRealtimeSnapshot>> watchFoodWork()=>_watchFood(this,'driver/food/work/events',FoodDriverRealtimeSnapshot.fromJson);
  Future<MobileAccountSessions> accountSessions({String? cursor})async=>MobileAccountSessions.fromJson(await _request('account/sessions${cursor==null?'':'?cursor=${Uri.encodeQueryComponent(cursor)}'}',authenticated:true));
  Future<MobileSessionRevoked> revokeAccountSession(String sessionId)async=>MobileSessionRevoked.fromJson(await _request('account/sessions/${Uri.encodeComponent(sessionId)}',method:'PUT',body:MobileSessionRevoke(revoked:true).toJson(),authenticated:true));
  Future<MobileProfile> profile() async=>MobileProfile.fromJson(await _request('account/profile',authenticated:true));
  Future<MobileRewards> rewards() async=>MobileRewards.fromJson(await _request('account/rewards',authenticated:true));
  /// Rewards of shops where the caller has a paid order, with the server-computed per-shop balance.
  Future<MobileRewardCatalog> rewardCatalog() async=>MobileRewardCatalog.fromJson(await _request('account/rewards/catalog',authenticated:true));
  /// Debits points and issues one voucher; the same idempotency key replays the same voucher.
  Future<MobileRewardRedemption> redeemReward(MobileRewardRedeemRequest request) async=>MobileRewardRedemption.fromJson(await _request('account/rewards/redeem',method:'POST',body:request.toJson(),authenticated:true));
  Future<MobileVouchers> vouchers() async=>MobileVouchers.fromJson(await _request('account/vouchers',authenticated:true));
  Future<MobileAccountErased> eraseAccountData() async=>MobileAccountErased.fromJson(await _request('account/erase',method:'POST',body:MobileAccountErase(idempotencyKey:const Uuid().v4(),confirm:'ERASE').toJson(),authenticated:true));
  Future<MobileAccountExport> accountExport() async=>MobileAccountExport.fromJson(await _request('account/export',authenticated:true));
  Future<MobileRideQuote> quoteRide(MobileRideQuoteRequest request) async=>MobileRideQuote.fromJson(await _request('rides/quote',method:'POST',body:request.toJson(),authenticated:true));
  Future<MobileRideRequested> requestRide(MobileRideRequest request) async=>MobileRideRequested.fromJson(await _request('rides',method:'POST',body:request.toJson(),authenticated:true));
  Future<MobileRideTrip> ride(String tripId) async=>MobileRideTrip.fromJson(await _request('rides/${Uri.encodeComponent(tripId)}',authenticated:true));
  Future<MobileRideOpen> openRides() async=>MobileRideOpen.fromJson(await _request('rides/open',authenticated:true));
  Future<MobileRideTrip> _rideAction(String tripId,String action,[Map<String,Object?> body=const {}]) async=>MobileRideTrip.fromJson(await _request('rides/${Uri.encodeComponent(tripId)}/$action',method:'POST',body:body,authenticated:true));
  Future<MobileRideTrip> acceptRide(String tripId)=>_rideAction(tripId,'accept');
  Future<MobileRideTrip> arriveRide(String tripId)=>_rideAction(tripId,'arrive');
  Future<MobileRideTrip> startRide(String tripId,String pin)=>_rideAction(tripId,'start',MobileRideStart(pin:pin).toJson());
  Future<MobileRideTrip> completeRide(String tripId)=>_rideAction(tripId,'complete');
  Future<MobileRideTrip> cancelRide(String tripId)=>_rideAction(tripId,'cancel');
  Future<MobileRideIncidentQueue> rideIncidentQueue() async=>MobileRideIncidentQueue.fromJson(await _request('rides/incidents',authenticated:true));
  Future<MobileRideIncidentReviewed> reviewRideIncident(String incidentId,String outcome,String note) async=>MobileRideIncidentReviewed.fromJson(await _request('rides/incidents/${Uri.encodeComponent(incidentId)}/review',method:'POST',body:MobileRideIncidentReview(outcome:outcome,note:note).toJson(),authenticated:true));
  Future<MobileRideLocation> rideLocation(String tripId) async=>MobileRideLocation.fromJson(await _request('rides/${Uri.encodeComponent(tripId)}/location',authenticated:true));
  Future<MobileRideLocationConsent> setRideLocationConsent(String tripId,bool enabled) async=>MobileRideLocationConsent.fromJson(await _request('rides/${Uri.encodeComponent(tripId)}/location/consent',method:'PUT',body:MobileRideLocationConsent(enabled:enabled).toJson(),authenticated:true));
  Future<MobileRideLocationConsent> sendRideLocation(String tripId,MobileRidePoint point) async=>MobileRideLocationConsent.fromJson(await _request('rides/${Uri.encodeComponent(tripId)}/location',method:'POST',body:point.toJson(),authenticated:true));
  Future<MobileRideCurrent> currentRide() async=>MobileRideCurrent.fromJson(await _request('rides/current',authenticated:true));
  Future<MobileGroups> groups() async=>MobileGroups.fromJson(await _request('groups',authenticated:true));
  Future<MobileGroup> createGroup() async=>MobileGroup.fromJson(await _request('groups',method:'POST',body:const {},authenticated:true));
  Future<MobileGroup> group(String groupId) async=>MobileGroup.fromJson(await _request('groups/${Uri.encodeComponent(groupId)}',authenticated:true));
  Future<MobileGroupInvite> inviteToGroup(String groupId) async=>MobileGroupInvite.fromJson(await _request('groups/${Uri.encodeComponent(groupId)}/invite',method:'POST',body:const {},authenticated:true));
  Future<MobileGroup> joinGroup(String token) async=>MobileGroup.fromJson(await _request('groups/join',method:'POST',body:MobileGroupJoin(token:token).toJson(),authenticated:true));
  Future<MobileGroup> setGroupLine(String groupId,String branchId,String productId,int qty) async=>MobileGroup.fromJson(await _request('groups/${Uri.encodeComponent(groupId)}/lines',method:'POST',body:MobileGroupLineSet(branchId:branchId,productId:productId,qty:qty).toJson(),authenticated:true));
  Future<MobileGroup> removeGroupMemberLine(String groupId,String memberId,String branchId,String productId) async=>MobileGroup.fromJson(await _request('groups/${Uri.encodeComponent(groupId)}/members/${Uri.encodeComponent(memberId)}',method:'POST',body:MobileGroupLineSet(branchId:branchId,productId:productId,qty:0).toJson(),authenticated:true));
  Future<MobileGroup> lockGroup(String groupId,String expectedVersion) async=>MobileGroup.fromJson(await _request('groups/${Uri.encodeComponent(groupId)}/lock',method:'POST',body:MobileGroupLock(expectedVersion:expectedVersion).toJson(),authenticated:true));
  Future<MobileGroup> cancelGroup(String groupId) async=>MobileGroup.fromJson(await _request('groups/${Uri.encodeComponent(groupId)}/cancel',method:'POST',body:const {},authenticated:true));
  Future<MobileGroupLeft> leaveGroup(String groupId) async=>MobileGroupLeft.fromJson(await _request('groups/${Uri.encodeComponent(groupId)}/leave',method:'POST',body:const {},authenticated:true));
  Future<MobileRideFareState> rideFare() async=>MobileRideFareState.fromJson(await _request('rides/fare',authenticated:true));
  Future<MobileRideFare> publishRideFare(MobileRideFarePublish fare) async=>MobileRideFare.fromJson(await _request('rides/fare',method:'PUT',body:fare.toJson(),authenticated:true));
  Future<MobileRideShare> shareRide(String tripId) async=>MobileRideShare.fromJson(await _request('rides/${Uri.encodeComponent(tripId)}/share',method:'POST',body:const {},authenticated:true));
  Future<MobileRideShareRevoked> revokeRideShares(String tripId) async=>MobileRideShareRevoked.fromJson(await _request('rides/${Uri.encodeComponent(tripId)}/share/revoke',method:'POST',body:const {},authenticated:true));
  Future<MobileRideIncidentReceipt> reportRideIncident(String tripId,String kind,String body) async=>MobileRideIncidentReceipt.fromJson(await _request('rides/${Uri.encodeComponent(tripId)}/incidents',method:'POST',body:MobileRideIncident(idempotencyKey:const Uuid().v4(),kind:kind,body:body).toJson(),authenticated:true));
  Future<MobileAddresses> addresses({String? cursor}) async=>MobileAddresses.fromJson(await _request('account/addresses${cursor==null?'':'?cursor=${Uri.encodeQueryComponent(cursor)}'}',authenticated:true));
  ProfileMutation profileMutation(MobileProfile profile,String displayName,String locale)=>ProfileMutation(MobileProfileUpdate(displayName:displayName,locale:locale,expectedVersion:profile.version,idempotencyKey:const Uuid().v4()));
  CreateAddressMutation createAddressMutation(MobileAddressFields address)=>CreateAddressMutation(MobileAddressCreate(idempotencyKey:const Uuid().v4(),address:address));
  UpdateAddressMutation updateAddressMutation(MobileAddress address,MobileAddressFields fields)=>UpdateAddressMutation(address.id,MobileAddressUpdate(idempotencyKey:const Uuid().v4(),expectedVersion:address.version,address:fields));
  ArchiveAddressMutation archiveAddressMutation(MobileAddress address)=>ArchiveAddressMutation(address.id,MobileAddressArchive(idempotencyKey:const Uuid().v4(),expectedVersion:address.version));
  String get _accountMutationKey {
    if(_session==null)throw const MobileApiException('AUTH_REQUIRED',401);
    return 'bitpos.pendingAccount.${_session!.accountId}';
  }
  Future<AccountMutation?> pendingAccountMutation(){
    final key=_accountMutationKey;
    return _accountOperation(() async {
      final raw=await storage.read(key:key);
      return raw==null?null:AccountMutation.fromJson(jsonDecode(raw) as Map<String,dynamic>);
    });
  }
  Future<void> submitAccountMutation(AccountMutation mutation){
    final owner=_session,key=_accountMutationKey,encoded=jsonEncode(mutation.toJson());
    return _accountOperation(() async {
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      final saved=await storage.read(key:key);
      if(saved!=null&&saved!=encoded)throw const MobileApiException('PENDING_ACCOUNT_RECOVERY_REQUIRED',409);
      await storage.write(key:key,value:encoded);
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      try{
        final response=await _request(mutation.path,method:mutation.method,body:mutation.body,authenticated:true);
        if(mutation is ProfileMutation){
          if(MobileProfile.fromJson(response).id!=owner!.accountId)throw const FormatException('Unexpected profile owner');
        }else{
          final address=MobileAddress.fromJson(response);
          if(mutation.addressId!=null&&address.id!=mutation.addressId)throw const FormatException('Unexpected address response');
        }
        await storage.delete(key:key);
      }on MobileApiException catch(error){
        if(['INVALID_REQUEST','VERSION_CONFLICT','ADDRESS_LIMIT','RESOURCE_NOT_FOUND'].contains(error.code))await storage.delete(key:key);
        rethrow;
      }
    });
  }
  Future<DriverProfileResult> driverProfile() async=>DriverProfileResult.fromJson(await _request('driver/profile',authenticated:true));
  DriverApplicationMutation driverApplicationCommand(DriverProfile? profile,DriverApplication application)=>DriverApplicationMutation(DriverApplicationCommand(idempotencyKey:const Uuid().v4(),expectedVersion:profile?.version??'0',application:application));
  DriverAvailabilityMutation driverAvailabilityCommand(DriverProfile profile,bool online)=>DriverAvailabilityMutation(DriverAvailabilityCommand(idempotencyKey:const Uuid().v4(),expectedVersion:profile.availability.version,online:online));
  String get _driverMutationKey{
    if(_session==null)throw const MobileApiException('AUTH_REQUIRED',401);
    return 'bitpos.pendingDriver.${_session!.accountId}';
  }
  Future<DriverMutation?> pendingDriverMutation(){
    final key=_driverMutationKey;
    return _accountOperation(() async{final raw=await storage.read(key:key);return raw==null?null:DriverMutation.fromJson(jsonDecode(raw) as Map<String,dynamic>);});
  }
  Future<void> submitDriverMutation(DriverMutation mutation){
    final owner=_session,key=_driverMutationKey,encoded=jsonEncode(mutation.toJson());
    return _accountOperation(() async{
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      final saved=await storage.read(key:key);
      if(saved!=null&&saved!=encoded)throw const MobileApiException('PENDING_DRIVER_RECOVERY_REQUIRED',409);
      await storage.write(key:key,value:encoded);
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      try{
        DriverCommandReceipt.fromJson(await _request(mutation.path,method:'PUT',body:mutation.body,authenticated:true));
        await storage.delete(key:key);
      }on MobileApiException catch(error){
        if(['INVALID_REQUEST','VERSION_CONFLICT','DRIVER_SUSPENDED','DRIVER_DOCUMENT_EXPIRED','DRIVER_VERIFICATION_REQUIRED','RESOURCE_NOT_FOUND'].contains(error.code))await storage.delete(key:key);
        rethrow;
      }
    });
  }
  String _chatKey(String assignmentId) {
    final session=_session;
    if(session==null)throw const MobileApiException('AUTH_REQUIRED',401);
    return 'bitpos.pendingChat.${session.accountId}.$assignmentId';
  }
  FoodChatSendCommand newFoodChatMessage(String body,{List<String> attachmentIds=const []})=>FoodChatSendCommand(commandId:const Uuid().v4(),body:body.trim(),attachmentIds:attachmentIds);
  FoodChatSendCommand _decodeChatCommand(String raw) {
    final json=jsonDecode(raw) as Map<String,dynamic>;
    final legacy=json.length==2&&json.containsKey('commandId')&&json.containsKey('body');
    return FoodChatSendCommand.fromJson(legacy?{...json,'attachmentIds':<String>[]}:json);
  }
  Future<FoodChatSendCommand?> pendingFoodChatMessage(String assignmentId) {
    final key=_chatKey(assignmentId);
    return _accountOperation(()async {
      final raw=await storage.read(key:key);
      return raw==null?null:_decodeChatCommand(raw);
    });
  }
  Future<FoodChatPage> foodChat(String assignmentId,{String afterSequence='0',String? beforeSequence}) async {
    final page=FoodChatPage.fromJson(await _request('food/assignments/${Uri.encodeComponent(assignmentId)}/chat?${beforeSequence==null?'afterSequence=${Uri.encodeQueryComponent(afterSequence)}':'beforeSequence=${Uri.encodeQueryComponent(beforeSequence)}'}',authenticated:true));
    if(page.assignmentId!=assignmentId||page.items.any((message)=>message.assignmentId!=assignmentId))throw const FormatException('Chat page scope mismatch');
    return page;
  }
  Future<({Uint8List bytes,Map<String,String> headers})> _chatBinary(String path,{String method='GET',Uint8List? body,Map<String,String> headers=const {},int maximum=4*1024*1024}) async {
    if(_session==null)throw const MobileApiException('AUTH_REQUIRED',401);
    if(!DateTime.parse(_session!.accessExpiresAt).isAfter(DateTime.now().add(const Duration(seconds:30)))) {
      await (_refreshing??=_refresh().whenComplete(()=>_refreshing=null));
    }
    final owner=_session,abort=Completer<void>();
    final changed=_sessionChanges.stream.listen((_){if(!identical(owner,_session)&&!abort.isCompleted)abort.complete();});
    try {
      final request=http.AbortableRequest(method,base.resolve(path),abortTrigger:abort.future)..followRedirects=false;
      request.headers.addAll({'Authorization':'Bearer ${owner!.accessToken}',...headers});
      if(body!=null)request.bodyBytes=body;
      final elapsed=Stopwatch()..start();
      final response=await _client.send(request).timeout(const Duration(seconds:30),onTimeout:(){if(!abort.isCompleted)abort.complete();throw TimeoutException('Private media deadline');});
      if(!identical(owner,_session)){await response.stream.listen((_){}).cancel();throw const MobileApiException('SESSION_CHANGED',409);}
      final remaining=const Duration(seconds:30)-elapsed.elapsed;
      if(remaining<=Duration.zero){await response.stream.listen((_){}).cancel();throw TimeoutException('Private media deadline');}
      final bytes=await _readResponse(response,response.statusCode==200?maximum:65536,remaining,owner,true);
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      if(response.statusCode!=200) {
        if(response.statusCode==401)await _writeSession(owner,null);
        final value=jsonDecode(utf8.decode(bytes));
        throw MobileApiException(value is Map&&value['error'] is Map&&value['error']['code'] is String?value['error']['code'] as String:'REQUEST_FAILED',response.statusCode);
      }
      return (bytes:bytes,headers:response.headers);
    }finally{await changed.cancel();if(!abort.isCompleted)abort.complete();}
  }
  Future<Uint8List> foodChatImage(String assignmentId,FoodChatAttachment image) async {
    final result=await _chatBinary('food/assignments/${Uri.encodeComponent(assignmentId)}/chat/images/${Uri.encodeComponent(image.id)}',maximum:image.byteLength);
    if(result.headers['content-type']?.split(';').first!='image/jpeg'||result.bytes.length!=image.byteLength||crypto.sha256.convert(result.bytes).toString()!=image.sha256)throw const FormatException('Private image integrity mismatch');
    return result.bytes;
  }
  Future<FoodChatUpload> uploadFoodChatImage(String assignmentId,String commandId,Uint8List bytes,String mime) async {
    if(bytes.isEmpty||bytes.length>4*1024*1024)throw const FormatException('Image size unsupported');
    final result=await _chatBinary('food/assignments/${Uri.encodeComponent(assignmentId)}/chat/images',method:'POST',body:bytes,headers:{'Content-Type':mime,'Idempotency-Key':commandId},maximum:65536);
    final value=FoodChatUpload.fromJson(jsonDecode(utf8.decode(result.bytes)) as Map<String,dynamic>);
    if(value.assignmentId!=assignmentId)throw const FormatException('Upload scope mismatch');
    return value;
  }
  Future<FoodChatUpload> recoverFoodChatUpload(String assignmentId,String commandId) async {
    final value=FoodChatUpload.fromJson(await _request('food/assignments/${Uri.encodeComponent(assignmentId)}/chat/images/commands/${Uri.encodeComponent(commandId)}',authenticated:true));
    if(value.assignmentId!=assignmentId)throw const FormatException('Upload scope mismatch');
    return value;
  }
  /// Absolute monotonic cursor; loss is recovered by the next visible-message acknowledgement.
  Future<FoodChatReadReceipt> markFoodChatRead(String assignmentId,String lastReadSequence) async {
    final owner=sessionScope;
    final result=FoodChatReadReceipt.fromJson(await _request('food/assignments/${Uri.encodeComponent(assignmentId)}/chat/read',method:'PUT',body:FoodChatReadCommand(lastReadSequence:lastReadSequence).toJson(),authenticated:true));
    if(sessionScope!=owner)throw const MobileApiException('SESSION_CHANGED',409);
    if(result.assignmentId!=assignmentId||BigInt.parse(result.lastReadSequence)<BigInt.parse(lastReadSequence))throw const FormatException('Read receipt scope mismatch');
    return result;
  }
  Future<FoodChatMessage> sendFoodChat(String assignmentId,FoodChatSendCommand command) {
    final owner=_session,key=_chatKey(assignmentId),encoded=jsonEncode(command.toJson());
    return _accountOperation(()async {
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      final prior=await storage.read(key:key);
      if(prior!=null&&jsonEncode(_decodeChatCommand(prior).toJson())!=encoded)throw const MobileApiException('PENDING_CHAT_RECOVERY_REQUIRED',409);
      await storage.write(key:key,value:encoded);
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      late final FoodChatMessage result;
      try {
        result=FoodChatMessage.fromJson(await _request('food/assignments/${Uri.encodeComponent(assignmentId)}/chat',method:'POST',body:command.toJson(),authenticated:true));
      } on MobileApiException catch(error) {
        // The server checks committed-command replay BEFORE upload expiry. A
        // scoped410 therefore proves this command was not committed. Unknown
        // transport outcomes and every other error must keep the journal.
        if(error.status==410&&error.code=='CHAT_IMAGE_EXPIRED'&&command.attachmentIds.isNotEmpty&&identical(owner,_session)) {
          await storage.delete(key:key);
        }
        rethrow;
      }
      if(result.assignmentId!=assignmentId||result.commandId!=command.commandId||result.body!=command.body||!result.mine||result.attachments.length!=command.attachmentIds.length||Iterable<int>.generate(command.attachmentIds.length).any((i)=>result.attachments[i].id!=command.attachmentIds[i]))throw const FormatException('Chat receipt scope mismatch');
      await storage.delete(key:key);
      return result;
    });
  }
  Future<DriverReviewSummary> driverReviewSummary() async {
    final owner=sessionScope;
    final result=DriverReviewSummary.fromJson(await _request('driver/reviews/summary',authenticated:true));
    if(sessionScope!=owner)throw const MobileApiException('SESSION_CHANGED',409);
    if((BigInt.parse(result.publishedCount)==BigInt.zero)!=(result.averageTenths==null))throw const FormatException('Rating count mismatch');
    return result;
  }
  Future<DriverDailyEarnings> driverDailyEarnings() async=>DriverDailyEarnings.fromJson(await _request('driver/earnings/daily',authenticated:true));
  Future<FoodDiscoverySnapshot> foodDiscovery() async=>FoodDiscoverySnapshot.fromJson(await _request('driver/food/discovery',authenticated:true));
  FoodDiscoveryConsentCommand foodDiscoveryCommand(FoodDiscoverySnapshot snapshot,bool enabled,List<FoodDiscoveryZone> zones)=>FoodDiscoveryConsentCommand(idempotencyKey:const Uuid().v4(),expectedVersion:snapshot.consent?.revision??'0',enabled:enabled,zones:zones);
  String get _discoveryMutationKey{final session=_session;if(session==null)throw const MobileApiException('AUTH_REQUIRED',401);return 'bitpos.pendingFoodDiscovery.${session.accountId}.${session.sessionId}';}
  Future<FoodDiscoveryConsentCommand?> pendingFoodDiscoveryConsent(){final key=_discoveryMutationKey;return _accountOperation(()async{final raw=await storage.read(key:key);return raw==null?null:FoodDiscoveryConsentCommand.fromJson(jsonDecode(raw) as Map<String,dynamic>);});}
  Future<FoodDiscoveryConsentReceipt> foodDiscoveryConsent(FoodDiscoveryConsentCommand command){
    final owner=_session,key=_discoveryMutationKey,encoded=jsonEncode(command.toJson());
    return _accountOperation(()async{
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      final saved=await storage.read(key:key);if(saved!=null&&saved!=encoded)throw const MobileApiException('PENDING_DRIVER_RECOVERY_REQUIRED',409);
      await storage.write(key:key,value:encoded);if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      try{final result=FoodDiscoveryConsentReceipt.fromJson(await _request('driver/food/discovery',method:'PUT',body:command.toJson(),authenticated:true));await storage.delete(key:key);return result;}
      on MobileApiException catch(error){if(['INVALID_REQUEST','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','ROLE_REQUIRED','DRIVER_UNAVAILABLE','RESOURCE_NOT_FOUND'].contains(error.code))await storage.delete(key:key);rethrow;}
    });
  }
  Future<FoodDiscoveryLocationReceipt> uploadFoodIdleLocation(FoodDiscoveryLocationCommand command) async=>FoodDiscoveryLocationReceipt.fromJson(await _request('driver/food/discovery/location',method:'POST',body:command.toJson(),authenticated:true));
  Future<FoodDriverWork> foodDriverWork() async=>FoodDriverWork.fromJson(await _request('driver/food/work',authenticated:true));
  Future<FoodDriverCompensation> foodDriverCompensation(String assignmentId) async {final result=FoodDriverCompensation.fromJson(await _request('driver/food/assignments/${Uri.encodeComponent(assignmentId)}/compensation',authenticated:true));if(result.assignmentId!=assignmentId||result.execution!=null&&result.execution!.fundsTransferred!=(result.execution!.state=='FINALIZED'))throw const FormatException('Driver compensation identity mismatch');return result;}
  Future<FoodCustomerRefundExecution> foodRefundExecution(String orderId) async { final result=FoodCustomerRefundExecution.fromJson(await _request('food/orders/${Uri.encodeComponent(orderId)}/refund-execution',authenticated:true));if(result.orderId!=orderId)throw const FormatException('Refund order identity mismatch');return result;}
  Future<FoodCustomerWork> foodCustomerWork(String orderId) async=>FoodCustomerWork.fromJson(await _request('food/orders/${Uri.encodeComponent(orderId)}/delivery',authenticated:true));
  Future<FoodTrackingSnapshot> foodTracking(String shipmentId) async=>FoodTrackingSnapshot.fromJson(await _request('food/shipments/${Uri.encodeComponent(shipmentId)}/tracking',authenticated:true));
  Future<FoodNavigationSnapshot> foodNavigation({String? orderId,required String assignmentId,required String generation,required String leaseGeneration}) async {
    final path=orderId==null?'driver/food/navigation':'food/orders/${Uri.encodeComponent(orderId)}/delivery/navigation';
    final query=Uri(queryParameters:{'assignmentId':assignmentId,'generation':generation,'leaseGeneration':leaseGeneration}).query;
    return FoodNavigationSnapshot.fromJson(await _request('$path?$query',authenticated:true,maxResponseBytes:256*1024));
  }
  Future<FoodNavigationTile> foodNavigationTile({String? orderId,required String assignmentId,required String generation,required String leaseGeneration,required int z,required int x,required int y}) async {
    final path=orderId==null?'driver/food/navigation/tile':'food/orders/${Uri.encodeComponent(orderId)}/delivery/navigation/tile';
    final query=Uri(queryParameters:{'assignmentId':assignmentId,'generation':generation,'leaseGeneration':leaseGeneration,'z':'$z','x':'$x','y':'$y'}).query;
    return FoodNavigationTile.fromJson(await _request('$path?$query',authenticated:true,maxResponseBytes:352*1024));
  }
  Future<FoodLocationReceipt> uploadFoodLocation(String assignmentId,FoodLocationCommand command) async=>FoodLocationReceipt.fromJson(await _request('driver/food/assignments/${Uri.encodeComponent(assignmentId)}/location',method:'POST',body:command.toJson(),authenticated:true));
  String get _dispatchMutationKey{if(_session==null)throw const MobileApiException('AUTH_REQUIRED',401);return 'bitpos.pendingDispatch.${_session!.accountId}';}
  Future<FoodDispatchMutation?> pendingFoodDispatch(){final key=_dispatchMutationKey;return _accountOperation(() async{final saved=await storage.read(key:key);return saved==null?null:FoodDispatchMutation.fromJson(jsonDecode(saved) as Map<String,dynamic>);});}
  FoodClaimMutation claimFoodCommand(FoodDriverOffer offer)=>FoodClaimMutation(offer.id,FoodClaimCommand(idempotencyKey:const Uuid().v4(),expectedVersion:offer.version,generation:offer.generation));
  FoodDeclineMutation declineFoodCommand(FoodDriverOffer offer,String reason)=>FoodDeclineMutation(offer.id,FoodDeclineCommand(idempotencyKey:const Uuid().v4(),expectedVersion:offer.version,generation:offer.generation,reason:reason));
  FoodWithdrawMutation withdrawFoodCommand(FoodDriverDuty duty,String reason){
    final (id,version,generation,lease)=switch(duty){FoodDriverAssignment a=>(a.id,a.shipmentVersion,a.generation,a.leaseGeneration),FoodDriverRestrictedAssignment a=>(a.id,a.shipmentVersion,a.generation,a.leaseGeneration)};
    return FoodWithdrawMutation(id,FoodWithdrawCommand(idempotencyKey:const Uuid().v4(),expectedVersion:version,generation:generation,leaseGeneration:lease,reason:reason));
  }
  FoodIncidentMutation reportFoodIncidentCommand(FoodDriverDuty duty,{required String kind,required String body}){
    final (id,generation,lease)=switch(duty){FoodDriverAssignment a=>(a.id,a.generation,a.leaseGeneration),FoodDriverRestrictedAssignment a=>(a.id,a.generation,a.leaseGeneration)};
    return FoodIncidentMutation(id,FoodIncidentReportCommand(idempotencyKey:const Uuid().v4(),generation:generation,leaseGeneration:lease,kind:kind,body:body));
  }
  Future<FoodIncidentPage> foodIncidents(String assignmentId,{String? afterId})async=>FoodIncidentPage.fromJson(await _request('driver/food/assignments/${Uri.encodeComponent(assignmentId)}/incidents${afterId==null?'':'?afterId=${Uri.encodeQueryComponent(afterId)}'}',authenticated:true));
  FoodArrivalMutation arriveFoodCommand(FoodDriverAssignment assignment,String stage)=>FoodArrivalMutation(assignment.id,FoodArrivalCommand(idempotencyKey:const Uuid().v4(),generation:assignment.generation,leaseGeneration:assignment.leaseGeneration,stage:stage));
  FoodConsumeMutation consumeFoodCommand(FoodDriverAssignment assignment,FoodDriverProof proof,String secret)=>FoodConsumeMutation(assignment.id,FoodProofConsumeCommand(idempotencyKey:const Uuid().v4(),proofId:proof.id,generation:assignment.generation,leaseGeneration:assignment.leaseGeneration,secret:secret));
  FoodDeliveryProofMutation deliveryProofCommand(FoodCustomerAssignment assignment,{required bool rotate})=>FoodDeliveryProofMutation(assignment.id,FoodProofIssueCommand(idempotencyKey:const Uuid().v4(),generation:assignment.generation,leaseGeneration:assignment.leaseGeneration,rotate:rotate));
  Future<Object> submitFoodDispatch(FoodDispatchMutation mutation){
    final owner=_session,key=_dispatchMutationKey,encoded=jsonEncode(mutation.toJson());
    return _accountOperation(() async{
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      final saved=await storage.read(key:key);if(saved!=null&&saved!=encoded)throw const MobileApiException('PENDING_DISPATCH_RECOVERY_REQUIRED',409);
      await storage.write(key:key,value:encoded);if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      try{
        final value=await _request(mutation.path,method:'POST',body:mutation.body,authenticated:true);
        final Object receipt=switch(mutation){
          FoodClaimMutation()=>FoodClaimReceipt.fromJson(value),
          FoodDeclineMutation()=>FoodDeclineReceipt.fromJson(value),
          FoodWithdrawMutation()=>FoodRecoveryReceipt.fromJson(value),
          FoodIncidentMutation()=>FoodIncidentReceipt.fromJson(value),
          FoodArrivalMutation()=>FoodArrivalReceipt.fromJson(value),
          FoodConsumeMutation()=>value['accepted']==true?FoodProofAccepted(FoodProofConfirmed.fromJson(value)):FoodProofRejected(FoodProofRefused.fromJson(value)),
          FoodDeliveryProofMutation()=>FoodProofIssueReceipt.fromJson(value),
        };
        if(mutation is FoodWithdrawMutation&&receipt is FoodRecoveryReceipt&&
          (receipt.assignmentId!=mutation.targetId||receipt.generation!=mutation.command.generation||receipt.leaseGeneration!=mutation.command.leaseGeneration||receipt.replacementOffer!=null)){
          throw const FormatException('Withdrawal receipt does not match pending assignment');
        }
        if(mutation is FoodIncidentMutation&&receipt is FoodIncidentReceipt){
          final incident=receipt.incident;
          if(incident.assignmentId!=mutation.targetId||incident.generation!=mutation.command.generation||incident.leaseGeneration!=mutation.command.leaseGeneration||incident.kind!=mutation.command.kind){
            throw const FormatException('Incident receipt does not match pending report');
          }
        }
        await storage.delete(key:key);return receipt;
      }on MobileApiException catch(error){
        if(['INVALID_REQUEST','RESOURCE_NOT_FOUND','ROLE_REQUIRED','VERSION_CONFLICT','ASSIGNMENT_CHANGED','OFFER_UNAVAILABLE','DRIVER_UNAVAILABLE','DISPATCH_NOT_READY','DISPATCH_TRANSITION_INVALID','PROOF_UNAVAILABLE','PROOF_ROTATION_REQUIRED','CUSTODY_RETAINED','INCIDENT'].contains(error.code))await storage.delete(key:key);
        rethrow;
      }
    });
  }
  Future<SettlementDriverPage> driverEarnings({String? afterId}) async=>SettlementDriverPage.fromJson(await _request('driver/earnings${afterId==null?'':'?afterId=${Uri.encodeComponent(afterId)}'}',authenticated:true));
  EnrollSettlementBeneficiary enrollSettlementBeneficiary(String merchantId,String publicKey)=>EnrollSettlementBeneficiary(SettlementEnrollCommand(idempotencyKey:const Uuid().v4(),expectedVersion:'0',merchantId:merchantId,provider:'solana-devnet',publicKey:publicKey));
  VerifySettlementBeneficiary verifySettlementBeneficiary(String beneficiaryId,String version,String signature)=>VerifySettlementBeneficiary(beneficiaryId,SettlementBeneficiaryVerifyCommand(idempotencyKey:const Uuid().v4(),expectedVersion:version,signature:signature));
  String get _settlementBeneficiaryKey{
    if(_session==null)throw const MobileApiException('AUTH_REQUIRED',401);
    return 'bitpos.pendingSettlementBeneficiary.${_session!.accountId}';
  }
  Future<SettlementBeneficiaryMutation?> _readSettlementBeneficiary(String key,({String accountId,String sessionId}) scope,{bool replay=false})async{
    final raw=await storage.read(key:key);
    if(sessionScope!=scope)throw const MobileApiException('SESSION_CHANGED',409);
    if(raw==null)return null;
    final saved=jsonDecode(raw) as Map<String,dynamic>;
    if(saved.length!=3||!saved.keys.every(['originalSessionId','deviceId','mutation'].contains)||saved['deviceId']!=_deviceId)throw const FormatException('Invalid beneficiary authority journal');
    final origin=SettlementAuthorityRetirementCommand.fromJson({'originalSessionId':saved['originalSessionId']});
    final mutation=SettlementBeneficiaryMutation.fromJson(saved['mutation'] as Map<String,dynamic>);
    if(origin.originalSessionId==scope.sessionId)return mutation;
    // Never replay the old challenge with a new session. Explicit revocation,
    // not expiry, proves no original request can still commit afterward.
    final retired=SettlementAuthorityRetiredReceipt.fromJson(await _request('driver/payout-beneficiaries/retired-authority',method:'POST',body:origin.toJson(),authenticated:true));
    if(sessionScope!=scope)throw const MobileApiException('SESSION_CHANGED',409);
    if(retired.accountId!=scope.accountId||retired.originalSessionId!=origin.originalSessionId||retired.deviceId!=_deviceId)throw const FormatException('Mismatched beneficiary authority retirement');
    await storage.delete(key:key);
    if(replay)throw const MobileApiException('SETTLEMENT_AUTHORITY_RETIRED',409);
    return null;
  }
  Future<SettlementBeneficiaryMutation?> pendingSettlementBeneficiary(){
    final scope=sessionScope,key=_settlementBeneficiaryKey;
    return _accountOperation(()async{
      if(sessionScope!=scope)throw const MobileApiException('SESSION_CHANGED',409);
      return _readSettlementBeneficiary(key,scope!);
    });
  }
  Future<Object> submitSettlementBeneficiary(SettlementBeneficiaryMutation mutation){
    final scope=sessionScope,key=_settlementBeneficiaryKey;
    return _accountOperation(()async{
      if(sessionScope!=scope)throw const MobileApiException('SESSION_CHANGED',409);
      final saved=await _readSettlementBeneficiary(key,scope!,replay:true);
      if(saved!=null&&jsonEncode(saved.toJson())!=jsonEncode(mutation.toJson()))throw const MobileApiException('PENDING_SETTLEMENT_RECOVERY_REQUIRED',409);
      await storage.write(key:key,value:jsonEncode({'originalSessionId':scope.sessionId,'deviceId':_deviceId,'mutation':mutation.toJson()}));
      if(sessionScope!=scope)throw const MobileApiException('SESSION_CHANGED',409);
      try{
        final response=await _request(mutation.path,method:'POST',body:mutation.body,authenticated:true);
        if(sessionScope!=scope)throw const MobileApiException('SESSION_CHANGED',409);
        final Object receipt;
        if(mutation case EnrollSettlementBeneficiary(:final command)){
          final pending=SettlementBeneficiaryPendingReceipt.fromJson(response);
          if(pending.challenge.accountId!=scope.accountId||pending.challenge.deviceId!=_deviceId||pending.challenge.tenantId!=command.merchantId||pending.challenge.destinationOwner!=command.publicKey||pending.challenge.enrollmentId!=pending.beneficiaryId)throw const FormatException('Mismatched enrollment receipt');
          receipt=pending;
        }else if(mutation case VerifySettlementBeneficiary(:final id,:final command)){
          final verified=SettlementBeneficiaryVerifiedReceipt.fromJson(response);
          if(verified.beneficiaryId!=id||BigInt.parse(verified.version)!=BigInt.parse(command.expectedVersion)+BigInt.one)throw const FormatException('Mismatched beneficiary verification');
          receipt=verified;
        }else{throw const FormatException('Unsupported beneficiary command');}
        await storage.delete(key:key);return receipt;
      }on MobileApiException catch(error){
        if((['INVALID_REQUEST','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','SETTLEMENT_NOT_READY'].contains(error.code)||saved==null&&mutation is EnrollSettlementBeneficiary&&error.code=='RESOURCE_NOT_FOUND')&&sessionScope==scope)await storage.delete(key:key);
        rethrow;
      }
    });
  }
  Future<FoodCancellationReviewOwnPage> foodCancellationReviews(String orderId) async=>FoodCancellationReviewOwnPage.fromJson(await _request('orders/${Uri.encodeComponent(orderId)}/cancellation-reviews',authenticated:true));
  String get _cancellationReviewKey{final session=_session;if(session==null)throw const MobileApiException('AUTH_REQUIRED',401);return 'bitpos.pendingCancellationReview.${session.accountId}';}
  Future<FoodCancellationReviewMutation?> pendingCancellationReview(){
    final owner=_session,key=_cancellationReviewKey;
    return _accountOperation(() async{
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      final raw=await storage.read(key:key);if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      return raw==null?null:FoodCancellationReviewMutation.fromJson(jsonDecode(raw) as Map<String,dynamic>);
    });
  }
  FoodCancellationReviewMutation newCancellationReview({required String orderId,required String shipmentId,required String shipmentVersion,required String reasonCode,required String detail})=>FoodCancellationReviewMutation(orderId:orderId,shipmentId:shipmentId,command:FoodCancellationReviewRequestCommand(idempotencyKey:const Uuid().v4(),expectedVersion:shipmentVersion,reasonCode:reasonCode,detail:detail));
  Future<FoodCancellationReviewReceipt> submitCancellationReview(FoodCancellationReviewMutation mutation){
    final owner=_session,key=_cancellationReviewKey,encoded=jsonEncode(mutation.toJson());
    return _accountOperation(() async{
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      final saved=await storage.read(key:key);if(saved!=null&&saved!=encoded)throw const MobileApiException('PENDING_CANCELLATION_REVIEW_RECOVERY_REQUIRED',409);
      await storage.write(key:key,value:encoded);if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      try{
        final receipt=FoodCancellationReviewReceipt.fromJson(await _request('orders/${Uri.encodeComponent(mutation.orderId)}/cancellation-reviews',method:'POST',body:mutation.command.toJson(),authenticated:true)),review=receipt.review;
        if(review is! FoodCancellationReviewOpen||review.shipmentId!=mutation.shipmentId||review.reasonCode!=mutation.command.reasonCode||review.requestedShipmentVersion!=mutation.command.expectedVersion)throw const FormatException('Cancellation review receipt does not match saved request');
        await storage.delete(key:key);return receipt;
      }on MobileApiException catch(error){
        if(['INVALID_REQUEST','RESOURCE_NOT_FOUND','ROLE_REQUIRED','VERSION_CONFLICT','CANCELLATION_REVIEW_OPEN'].contains(error.code))await storage.delete(key:key);
        rethrow;
      }
    });
  }
  String newFoodLineId()=>const Uuid().v4();
  MobileFoodOrderRequest newFoodOrderCommand({required String branchId, required String quoteId, required String priceVersion}) =>
    MobileFoodOrderRequest(branchId: branchId, quoteId: quoteId, priceVersion: priceVersion, idempotencyKey: const Uuid().v4());
  Future<MobileFoodReviewSnapshot> foodReview(String orderId)async=>MobileFoodReviewSnapshot.fromJson(await _request('orders/${Uri.encodeComponent(orderId)}/review',authenticated:true));
  Future<MobileBranchReviews> branchReviews(String branchId,{String? cursor})async=>MobileBranchReviews.fromJson(await _request('branches/${Uri.encodeComponent(branchId)}/reviews${cursor==null?'':'?cursor=${Uri.encodeQueryComponent(cursor)}'}'));
  String get _reviewMutationKey{if(_session==null)throw const MobileApiException('AUTH_REQUIRED',401);return 'bitpos.pendingReview.${_session!.accountId}';}
  ReviewMutation newFoodReview(String orderId,String expectedVersion,{required int stars,int? driverStars,required String body})=>ReviewMutation(orderId,MobileFoodReviewCommand(commandId:const Uuid().v4(),expectedVersion:expectedVersion,action:'SUBMIT',stars:stars,driverStars:driverStars,body:body.trim()));
  ReviewMutation withdrawFoodReview(MobileFoodReview review)=>ReviewMutation(review.orderId,MobileFoodReviewCommand(commandId:const Uuid().v4(),expectedVersion:review.version,action:'WITHDRAW',stars:null,driverStars:null,body:''));
  Future<ReviewMutation?> pendingReviewMutation(){final key=_reviewMutationKey;return _accountOperation(()async{final raw=await storage.read(key:key);return raw==null?null:ReviewMutation.fromJson(jsonDecode(raw)as Map<String,dynamic>);});}
  Future<MobileFoodReview> submitReviewMutation(ReviewMutation mutation){
   final owner=_session,key=_reviewMutationKey,encoded=jsonEncode(mutation.toJson());
   return _accountOperation(()async{
    if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
    final saved=await storage.read(key:key);if(saved!=null&&saved!=encoded)throw const MobileApiException('PENDING_REVIEW_RECOVERY_REQUIRED',409);
    await storage.write(key:key,value:encoded);if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
    try{final result=MobileFoodReview.fromJson(await _request('orders/${Uri.encodeComponent(mutation.orderId)}/review',method:'POST',body:mutation.command.toJson(),authenticated:true));
     if(result.orderId!=mutation.orderId||mutation.command.action=='SUBMIT'&&(result.stars!=mutation.command.stars||result.driverStars!=mutation.command.driverStars||result.body!=mutation.command.body.trim())||mutation.command.action=='WITHDRAW'&&(result.state!='WITHDRAWN'||result.body.isNotEmpty))throw const FormatException('Review receipt mismatch');
     await storage.delete(key:key);return result;
    }on MobileApiException catch(error){if(error.status==422||error.code=='VERSION_CONFLICT')await storage.delete(key:key);rethrow;}
   });
  }
  String get _supportMutationKey{if(_session==null)throw const MobileApiException('AUTH_REQUIRED',401);return 'bitpos.pendingSupport.${_session!.accountId}';}
  Future<SupportMutation?> pendingSupportMutation(){final key=_supportMutationKey;return _accountOperation(()async{final raw=await storage.read(key:key);return raw==null?null:SupportMutation.fromJson(jsonDecode(raw) as Map<String,dynamic>);});}
  CreateSupportMutation newSupportCase(String subject,String message,{MobileSupportOrder? order})=>CreateSupportMutation(MobileSupportCreate(commandId:const Uuid().v4(),subject:subject.trim(),message:message.trim(),order:order));
  SendSupportMutation newSupportMessage(String caseId,String message)=>SendSupportMutation(caseId,MobileSupportSend(commandId:const Uuid().v4(),message:message.trim()));
  Future<void> submitSupportMutation(SupportMutation mutation){
   final owner=_session,key=_supportMutationKey,encoded=jsonEncode(mutation.toJson());
   return _accountOperation(()async{
    if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
    final saved=await storage.read(key:key);if(saved!=null&&saved!=encoded)throw const MobileApiException('PENDING_SUPPORT_RECOVERY_REQUIRED',409);
    await storage.write(key:key,value:encoded);if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
    try{final response=await _request(mutation.path,method:'POST',body:mutation.body,authenticated:true);
     if(mutation is CreateSupportMutation){MobileSupportCase.fromJson(response);}else{MobileSupportMessage.fromJson(response);}
     await storage.delete(key:key);
    }on MobileApiException catch(error){if(error.status==422||error.status==404)await storage.delete(key:key);rethrow;}
   });
  }
  Future<MobileSupportCase> supportCase(String id)async=>MobileSupportCase.fromJson(await _request('account/support/${Uri.encodeComponent(id)}',authenticated:true));
  Future<MobileSupportCases> supportCases({String? cursor})async=>MobileSupportCases.fromJson(await _request('account/support${cursor==null?'':'?cursor=${Uri.encodeQueryComponent(cursor)}'}',authenticated:true));

  Future<MobileSupportMessages> supportMessages(String caseId,{String? cursor})async=>MobileSupportMessages.fromJson(await _request('account/support/${Uri.encodeComponent(caseId)}/messages${cursor==null?'':'?cursor=${Uri.encodeQueryComponent(cursor)}'}',authenticated:true));

  Future<MobileFavourites> favourites({String? cursor})async=>MobileFavourites.fromJson(await _request('account/favourites${cursor==null?'':'?cursor=${Uri.encodeQueryComponent(cursor)}'}',authenticated:true));
  Future<MobileFavouriteReceipt> setFavourite(String branchId,bool favourite)async=>MobileFavouriteReceipt.fromJson(await _request('account/favourites/${Uri.encodeComponent(branchId)}',method:'PUT',body:MobileFavouriteUpdate(favourite:favourite).toJson(),authenticated:true));
  Future<MobileBranches> branches({String? cursor,String search='',String serving='all'}) async {
    final query=Uri(queryParameters:{if(cursor!=null)'cursor':cursor,if(search.isNotEmpty)'search':search,if(serving!='all')'serving':serving}).query;
    return MobileBranches.fromJson(await _request('branches${query.isEmpty?'':'?$query'}'));
  }
  Future<MobileMenu> menu(String branchId,{String? cursor,String? menuVersion}) async {
    final query=cursor==null?'':'?cursor=${Uri.encodeQueryComponent(cursor)}&menuVersion=${Uri.encodeQueryComponent(menuVersion!)}';
    return MobileMenu.fromJson(await _request('branches/${Uri.encodeComponent(branchId)}/menu$query'));
  }
  Future<MobileFoodQuote> quoteFood(MobileFoodQuoteRequest request) async => MobileFoodQuote.fromJson(
    await _request('food/quotes', method: 'POST', body: request.toJson(), authenticated: true,maxResponseBytes:_configuredResponseBytes));
  Future<MobileCustomerDeliveryPolicy> deliveryPolicy(String branchId) async => MobileCustomerDeliveryPolicy.fromJson(
    await _request('branches/${Uri.encodeComponent(branchId)}/delivery-policy', authenticated: true));
  Future<MobileFoodQuote> quoteDelivery(MobileDeliveryQuoteRequest request) async => MobileFoodQuote.fromJson(
    await _request('food/quotes', method: 'POST', body: request.toJson(), authenticated: true,maxResponseBytes:_configuredResponseBytes));
  String get _pendingFoodKey {
    if (_session == null) throw const MobileApiException('AUTH_REQUIRED', 401);
    return 'bitpos.pendingFood.${_session!.accountId}';
  }
  Future<MobileFoodOrderRequest?> pendingFoodOrder() {
    final key=_pendingFoodKey;
    return _foodOperation(() async {
      final value=await storage.read(key:key);
      return value==null?null:MobileFoodOrderRequest.fromJson(jsonDecode(value) as Map<String,dynamic>);
    });
  }
  String get _activeFoodKey {
    if (_session == null) throw const MobileApiException('AUTH_REQUIRED', 401);
    return 'bitpos.activeFood.${_session!.accountId}';
  }
  Future<String?> activeFoodOrderId() {
    final key=_activeFoodKey;
    return _foodOperation(()=>storage.read(key:key));
  }
  Future<void> rememberFoodOrder(String id) {
    final key=_activeFoodKey;
    return _foodOperation(()=>storage.write(key:key,value:id));
  }
  Future<void> forgetFoodOrder() {
    final key=_activeFoodKey;
    return _foodOperation(()=>storage.delete(key:key));
  }
  /// Fresh account-scoped idempotency key for a coupon or slot command.
  String newCommandKey() => const Uuid().v4();
  /// Attach a coupon code to a quote. The server returns a replacement quote whose discount and total it computed.
  Future<MobileCouponQuote> applyFoodCoupon(String quoteId, MobileCouponApplyRequest request) async => MobileCouponQuote.fromJson(
    await _request('food/quotes/${Uri.encodeComponent(quoteId)}/coupon', method: 'POST', body: request.toJson(), authenticated: true,maxResponseBytes:_configuredResponseBytes));
  /// Currently bookable slots the branch has published; an empty list means none are published.
  Future<MobileScheduleSlots> scheduleSlots(String branchId, String serving) async => MobileScheduleSlots.fromJson(
    await _request('branches/${Uri.encodeComponent(branchId)}/schedule-slots?serving=${Uri.encodeQueryComponent(serving)}', authenticated: true));
  Future<MobileScheduleHold> holdScheduleSlot(String quoteId, MobileScheduleHoldRequest request) async => MobileScheduleHold.fromJson(
    await _request('food/quotes/${Uri.encodeComponent(quoteId)}/schedule-hold', method: 'POST', body: request.toJson(), authenticated: true));
  Future<MobileFoodOrderResult> submitFoodOrder(MobileFoodOrderRequest command) {
    final owner=_session;
    return _foodOperation(() {
      if(!identical(owner,_session))throw const MobileApiException('SESSION_CHANGED',409);
      return _submitFoodOrder(command);
    });
  }
  Future<MobileFoodOrderResult> _submitFoodOrder(MobileFoodOrderRequest command) async {
    final submittingSession = _session;
    final key = _pendingFoodKey;
    final activeKey = _activeFoodKey;
    final encoded = jsonEncode(command.toJson());
    final pending = await storage.read(key: key);
    if(!identical(_session,submittingSession))throw const MobileApiException('SESSION_CHANGED',409);
    if (pending != null && pending != encoded) {
      throw const MobileApiException('PENDING_ORDER_RECOVERY_REQUIRED', 409);
    }
    // Durable before network I/O: process death/response loss must recover the
    // same account-bound command, never create a replacement with a new key.
    await storage.write(key: key, value: encoded);
    if(!identical(_session,submittingSession))throw const MobileApiException('SESSION_CHANGED',409);
    try {
      final result = MobileFoodOrderResult.fromJson(await _request('food/orders',
        method: 'POST', body: command.toJson(), authenticated: true,maxResponseBytes:_configuredResponseBytes));
      await storage.write(key: activeKey,value: result.order.id);
      await storage.delete(key: key);
      return result;
    } on MobileApiException catch (error) {
      if (['QUOTE_EXPIRED', 'QUOTE_CHANGED', 'PRICE_VERSION_CHANGED', 'STOCK_UNAVAILABLE',
          'SERVING_UNAVAILABLE', 'RESOURCE_NOT_FOUND', 'INVALID_REQUEST'].contains(error.code)) {
        await storage.delete(key: key);
      }
      rethrow;
    }
  }
  Future<MobileFoodOrder> foodOrder(String id) async => MobileFoodOrder.fromJson(
    await _request('food/orders/${Uri.encodeComponent(id)}', authenticated: true,maxResponseBytes:_configuredResponseBytes));
  Future<MobileFoodOrders> foodOrders({String? cursor}) async => MobileFoodOrders.fromJson(
    await _request('food/orders${cursor == null ? '' : '?cursor=${Uri.encodeQueryComponent(cursor)}'}', authenticated: true));
  Future<MobileFoodRefunds> foodRefunds(String id,{({String cursor,String generation})? after}) async=>MobileFoodRefunds.fromJson(
    await _request('food/orders/${Uri.encodeComponent(id)}/refunds${after==null?'':'?cursor=${Uri.encodeQueryComponent(after.cursor)}&generation=${Uri.encodeQueryComponent(after.generation)}'}',authenticated:true));
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async => MobileFoodEvents.fromJson(
    await _request('food/orders/${Uri.encodeComponent(id)}/events${cursor == null ? '' : '?cursor=${Uri.encodeQueryComponent(cursor)}'}', authenticated: true,maxResponseBytes:_configuredResponseBytes));
  Future<MobilePushStatus> pushStatus(MobilePushApp app,String installationKey) async=>MobilePushStatus.fromJson(await _request('notifications/${app.name}/installation',authenticated:true,extraHeaders:{'X-BitPOS-Push-Installation-Key':installationKey}));
  Future<MobilePushReceipt> pushCommand(MobilePushApp app,MobilePushCommand command,String installationKey,{String? nextKey}) async=>MobilePushReceipt.fromJson(await _request('notifications/${app.name}/installation',method:'POST',authenticated:true,body:command.toJson(),extraHeaders:{'X-BitPOS-Push-Installation-Key':installationKey,'X-BitPOS-Push-Next-Key':?nextKey}));
  Future<MobilePushOpenResult> pushOpen(MobilePushApp app,String eventId,MobilePushOpenRequest command,String installationKey) async=>MobilePushOpenResult.fromJson(await _request('notifications/${app.name}/events/${Uri.encodeComponent(eventId)}/open',method:'POST',authenticated:true,body:command.toJson(),extraHeaders:{'X-BitPOS-Push-Installation-Key':installationKey}));
  Future<void> logout({bool allDevices = false}) async {
    await _request('auth/logout', method: 'POST', authenticated: true,
      body: LogoutRequest(allDevices: allDevices).toJson());
    await _writeSession(_session,null);
  }
  void close() { _client.close();_sessionChanges.close(); }
}
