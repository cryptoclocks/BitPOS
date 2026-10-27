import 'mobile_v1.generated.dart';
class ReviewMutation{
 const ReviewMutation(this.orderId,this.command);
 final String orderId;final MobileFoodReviewCommand command;
 Map<String,dynamic>toJson()=>{'orderId':orderId,'command':command.toJson()};
 factory ReviewMutation.fromJson(Map<String,dynamic>json){
  if(json.length!=2||json['orderId']is!String||!RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').hasMatch(json['orderId']as String)||json['command']is!Map<String,dynamic>)throw const FormatException('Invalid review recovery command');
  return ReviewMutation(json['orderId']as String,MobileFoodReviewCommand.fromJson(json['command']as Map<String,dynamic>));
 }
}
