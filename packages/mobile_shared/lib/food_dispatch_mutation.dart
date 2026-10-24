import 'mobile_v1.generated.dart';
sealed class FoodDispatchMutation {
 const FoodDispatchMutation(this.targetId);final String targetId;
 String get kind;String get path;Map<String,dynamic> get body;
 Map<String,dynamic> toJson()=>{'kind':kind,'targetId':targetId,'body':body};
 static FoodDispatchMutation fromJson(Map<String,dynamic> json){
  if(json.length!=3||!json.keys.every(['kind','targetId','body'].contains)||json['targetId'] is! String||json['body'] is! Map<String,dynamic>)throw const FormatException('Invalid saved food dispatch command');
  final id=json['targetId'] as String,body=json['body'] as Map<String,dynamic>;
  return switch(json['kind']){'claim'=>FoodClaimMutation(id,FoodClaimCommand.fromJson(body)),'decline'=>FoodDeclineMutation(id,FoodDeclineCommand.fromJson(body)),'withdraw'=>FoodWithdrawMutation(id,FoodWithdrawCommand.fromJson(body)),'incident-report'=>FoodIncidentMutation(id,FoodIncidentReportCommand.fromJson(body)),'arrive'=>FoodArrivalMutation(id,FoodArrivalCommand.fromJson(body)),'consume'=>FoodConsumeMutation(id,FoodProofConsumeCommand.fromJson(body)),'delivery-proof'=>FoodDeliveryProofMutation(id,FoodProofIssueCommand.fromJson(body)),_=>throw const FormatException('Unknown saved food dispatch command')};
 }
}
final class FoodClaimMutation extends FoodDispatchMutation {
 const FoodClaimMutation(super.targetId,this.command);final FoodClaimCommand command;
 @override String get kind=>'claim';@override String get path=>'driver/food/offers/${Uri.encodeComponent(targetId)}/claim';@override Map<String,dynamic> get body=>command.toJson();
}
final class FoodDeclineMutation extends FoodDispatchMutation {
 const FoodDeclineMutation(super.targetId,this.command);final FoodDeclineCommand command;
 @override String get kind=>'decline';@override String get path=>'driver/food/offers/${Uri.encodeComponent(targetId)}/decline';@override Map<String,dynamic> get body=>command.toJson();
}
final class FoodWithdrawMutation extends FoodDispatchMutation {
 const FoodWithdrawMutation(super.targetId,this.command);final FoodWithdrawCommand command;
 @override String get kind=>'withdraw';@override String get path=>'driver/food/assignments/${Uri.encodeComponent(targetId)}/withdraw';@override Map<String,dynamic> get body=>command.toJson();
}
final class FoodIncidentMutation extends FoodDispatchMutation {
 const FoodIncidentMutation(super.targetId,this.command);final FoodIncidentReportCommand command;
 @override String get kind=>'incident-report';@override String get path=>'driver/food/assignments/${Uri.encodeComponent(targetId)}/incidents';@override Map<String,dynamic> get body=>command.toJson();
}
final class FoodArrivalMutation extends FoodDispatchMutation {
 const FoodArrivalMutation(super.targetId,this.command);final FoodArrivalCommand command;
 @override String get kind=>'arrive';@override String get path=>'driver/food/assignments/${Uri.encodeComponent(targetId)}/arrive';@override Map<String,dynamic> get body=>command.toJson();
}
final class FoodConsumeMutation extends FoodDispatchMutation {
 const FoodConsumeMutation(super.targetId,this.command);final FoodProofConsumeCommand command;
 @override String get kind=>'consume';@override String get path=>'driver/food/assignments/${Uri.encodeComponent(targetId)}/consume-proof';@override Map<String,dynamic> get body=>command.toJson();
}
final class FoodDeliveryProofMutation extends FoodDispatchMutation {
 const FoodDeliveryProofMutation(super.targetId,this.command);final FoodProofIssueCommand command;
 @override String get kind=>'delivery-proof';@override String get path=>'food/assignments/${Uri.encodeComponent(targetId)}/delivery-proof';@override Map<String,dynamic> get body=>command.toJson();
}
sealed class FoodProofResult {const FoodProofResult();}
final class FoodProofAccepted extends FoodProofResult {const FoodProofAccepted(this.receipt);final FoodProofConfirmed receipt;}
final class FoodProofRejected extends FoodProofResult {const FoodProofRejected(this.receipt);final FoodProofRefused receipt;}
