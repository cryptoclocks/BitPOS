import 'dart:convert';import 'mobile_v1.generated.dart';
sealed class SettlementBeneficiaryMutation{
 const SettlementBeneficiaryMutation();String get kind;String get path;Map<String,dynamic> get body;String? get beneficiaryId=>null;
 Map<String,dynamic> toJson()=>{'kind':kind,'beneficiaryId':beneficiaryId,'body':body};
 static SettlementBeneficiaryMutation fromJson(Map<String,dynamic> json){
  if(json.length!=3||!json.keys.every(['kind','beneficiaryId','body'].contains)||json['body'] is! Map<String,dynamic>)throw const FormatException('Invalid beneficiary journal');
  final body=json['body'] as Map<String,dynamic>;
  return switch(json['kind']){
   'ENROLL' when json['beneficiaryId']==null=>EnrollSettlementBeneficiary(SettlementEnrollCommand.fromJson(body)),
   'VERIFY' when json['beneficiaryId'] is String=>VerifySettlementBeneficiary(json['beneficiaryId'] as String,SettlementBeneficiaryVerifyCommand.fromJson(body)),
   _=>throw const FormatException('Invalid beneficiary command'),
  };
 }
}
final class EnrollSettlementBeneficiary extends SettlementBeneficiaryMutation{
 const EnrollSettlementBeneficiary(this.command);final SettlementEnrollCommand command;
 @override String get kind=>'ENROLL';@override String get path=>'driver/payout-beneficiaries';@override Map<String,dynamic> get body=>command.toJson();
}
final class VerifySettlementBeneficiary extends SettlementBeneficiaryMutation{
 VerifySettlementBeneficiary(String id,this.command):id=_id(id);final String id;final SettlementBeneficiaryVerifyCommand command;
 static String _id(String value){if(!RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').hasMatch(value))throw const FormatException('Invalid beneficiary ID');return value;}
 @override String get kind=>'VERIFY';@override String get beneficiaryId=>id;@override String get path=>'driver/payout-beneficiaries/$id/verify';@override Map<String,dynamic> get body=>command.toJson();
}
/// Exact protocol bytes for an external wallet's sign-message operation; never
/// a transaction, transfer approval or request for a private key/seed phrase.
String settlementOwnershipMessage(SettlementOwnershipChallenge c)=>jsonEncode(['BitPOS/SolanaDevnet/PayoutBeneficiaryOwnership/v1',c.version,c.domain,c.genesisHash,c.tenantId,c.accountId,c.deviceId,c.enrollmentId,c.challengeId,c.nonce,c.destinationOwner,c.issuedAt,c.expiresAt]);
