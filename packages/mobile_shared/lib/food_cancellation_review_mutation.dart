import 'package:uuid/uuid.dart';
import 'mobile_v1.generated.dart';

/// A review request is not an order cancellation or financial instruction.
class FoodCancellationReviewMutation {
 final String orderId,shipmentId;
 final FoodCancellationReviewRequestCommand command;
 const FoodCancellationReviewMutation({required this.orderId,required this.shipmentId,required this.command});
 factory FoodCancellationReviewMutation.fromJson(Map<String,dynamic> value){
  if(value.length!=3||!value.keys.every(['orderId','shipmentId','command'].contains)||value['orderId'] is! String||value['shipmentId'] is! String||!Uuid.isValidUUID(fromString:value['orderId'] as String)||!Uuid.isValidUUID(fromString:value['shipmentId'] as String)||value['command'] is! Map<String,dynamic>)throw const FormatException('Invalid cancellation review journal');
  return FoodCancellationReviewMutation(orderId:value['orderId'] as String,shipmentId:value['shipmentId'] as String,command:FoodCancellationReviewRequestCommand.fromJson(value['command'] as Map<String,dynamic>));
 }
 Map<String,dynamic> toJson()=>{'orderId':orderId,'shipmentId':shipmentId,'command':command.toJson()};
}
