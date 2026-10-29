import 'mobile_v1.generated.dart';

sealed class AccountMutation {
 const AccountMutation();
 String get kind;
 String? get addressId=>null;
 String get path;
 String get method;
 Map<String,dynamic> get body;
 Map<String,dynamic> toJson()=>{'kind':kind,'addressId':addressId,'body':body};
 static AccountMutation fromJson(Map<String,dynamic> json){
  if(json.length!=3||!json.keys.every(['kind','addressId','body'].contains)||json['body'] is! Map<String,dynamic>)throw const FormatException('Invalid saved account command');
  final body=json['body'] as Map<String,dynamic>;
  switch(json['kind']){
   case 'profile':
    if(json['addressId']!=null)throw const FormatException('Invalid profile command');
    return ProfileMutation(MobileProfileUpdate.fromJson(body));
   case 'create':
    if(json['addressId']!=null)throw const FormatException('Invalid address command');
    return CreateAddressMutation(MobileAddressCreate.fromJson(body));
   case 'update':
    if(json['addressId'] is! String)throw const FormatException('Invalid address command');
    return UpdateAddressMutation(json['addressId'] as String,MobileAddressUpdate.fromJson(body));
   case 'archive':
    if(json['addressId'] is! String)throw const FormatException('Invalid address command');
    return ArchiveAddressMutation(json['addressId'] as String,MobileAddressArchive.fromJson(body));
   default:throw const FormatException('Unknown saved account command');
  }
 }
}
final class ProfileMutation extends AccountMutation {
 const ProfileMutation(this.command);
 final MobileProfileUpdate command;
 @override String get kind=>'profile';
 @override String get path=>'account/profile';
 @override String get method=>'PUT';
 @override Map<String,dynamic> get body=>command.toJson();
}
final class CreateAddressMutation extends AccountMutation {
 const CreateAddressMutation(this.command);
 final MobileAddressCreate command;
 @override String get kind=>'create';
 @override String get path=>'account/addresses';
 @override String get method=>'POST';
 @override Map<String,dynamic> get body=>command.toJson();
}
final class UpdateAddressMutation extends AccountMutation {
 const UpdateAddressMutation(this.id,this.command);
 final String id;
 final MobileAddressUpdate command;
 @override String get kind=>'update';
 @override String get addressId=>id;
 @override String get path=>'account/addresses/${Uri.encodeComponent(id)}';
 @override String get method=>'PUT';
 @override Map<String,dynamic> get body=>command.toJson();
}
final class ArchiveAddressMutation extends AccountMutation {
 const ArchiveAddressMutation(this.id,this.command);
 final String id;
 final MobileAddressArchive command;
 @override String get kind=>'archive';
 @override String get addressId=>id;
 @override String get path=>'account/addresses/${Uri.encodeComponent(id)}/archive';
 @override String get method=>'POST';
 @override Map<String,dynamic> get body=>command.toJson();
}
