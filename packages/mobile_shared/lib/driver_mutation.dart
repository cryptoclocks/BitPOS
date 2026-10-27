import 'mobile_v1.generated.dart';
sealed class DriverMutation{
 const DriverMutation();
 String get kind;
 String get path;
 Map<String,dynamic> get body;
 Map<String,dynamic> toJson()=>{'kind':kind,'body':body};
 static DriverMutation fromJson(Map<String,dynamic> json){
  if(json.length!=2||!json.keys.every(['kind','body'].contains)||json['body'] is! Map<String,dynamic>)throw const FormatException('Invalid saved driver command');
  final body=json['body'] as Map<String,dynamic>;
  return switch(json['kind']){'application'=>DriverApplicationMutation(DriverApplicationCommand.fromJson(body)),'availability'=>DriverAvailabilityMutation(DriverAvailabilityCommand.fromJson(body)),_=>throw const FormatException('Unknown saved driver command')};
 }
}
final class DriverApplicationMutation extends DriverMutation{
 const DriverApplicationMutation(this.command);final DriverApplicationCommand command;
 @override String get kind=>'application';
 @override String get path=>'driver/profile';
 @override Map<String,dynamic> get body=>command.toJson();
}
final class DriverAvailabilityMutation extends DriverMutation{
 const DriverAvailabilityMutation(this.command);final DriverAvailabilityCommand command;
 @override String get kind=>'availability';
 @override String get path=>'driver/availability';
 @override Map<String,dynamic> get body=>command.toJson();
}
