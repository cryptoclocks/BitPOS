import 'mobile_v1.generated.dart';
sealed class SupportMutation {
 const SupportMutation();
 String get path;
 Map<String,dynamic> get body;
 Map<String,dynamic> toJson();
 static SupportMutation fromJson(Map<String,dynamic> json){
  if(json['kind']=='create'&&json.length==2&&json['body'] is Map<String,dynamic>)return CreateSupportMutation(MobileSupportCreate.fromJson(json['body'] as Map<String,dynamic>));
  if(json['kind']=='message'&&json.length==3&&json['caseId'] is String&&RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').hasMatch(json['caseId'] as String)&&json['body'] is Map<String,dynamic>)return SendSupportMutation(json['caseId'] as String,MobileSupportSend.fromJson(json['body'] as Map<String,dynamic>));
  throw const FormatException('Invalid saved support command');
 }
}
class CreateSupportMutation extends SupportMutation{
 const CreateSupportMutation(this.command);final MobileSupportCreate command;
 @override String get path=>'account/support';
 @override Map<String,dynamic> get body=>command.toJson();
 @override Map<String,dynamic> toJson()=>{'kind':'create','body':body};
}
class SendSupportMutation extends SupportMutation{
 const SendSupportMutation(this.caseId,this.command);final String caseId;final MobileSupportSend command;
 @override String get path=>'account/support/${Uri.encodeComponent(caseId)}/messages';
 @override Map<String,dynamic> get body=>command.toJson();
 @override Map<String,dynamic> toJson()=>{'kind':'message','caseId':caseId,'body':body};
}
