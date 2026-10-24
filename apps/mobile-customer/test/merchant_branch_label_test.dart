import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/food_labels.dart';
void main(){
 test('branch card language fallback preserves actual source names',(){
  expect(merchantBranchLabel(thai:false,name:'ร้านกาแฟ',nameEn:' ',merchantName:'Merchant'),'ร้านกาแฟ');
  expect(merchantBranchLabel(thai:true,name:'',nameEn:'Coffee',merchantName:'Merchant'),'Coffee');
  expect(merchantBranchLabel(thai:false,name:'',nameEn:'',merchantName:' Merchant '),'Merchant');
  expect(merchantBranchLabel(thai:false,name:'',nameEn:'',merchantName:''),'Unnamed branch');
 });
}
