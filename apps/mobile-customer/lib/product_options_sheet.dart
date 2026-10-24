import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'presentation/food_presentation.dart';

/// U10: local selections are a request, never a payable quote.
class ProductOptionsSheet extends StatefulWidget {
 final MobileProduct product;
 final MobileProductOptions options;
 final String lineId;
 final bool thai;
 final int maximumQuantity;
 final MobileConfiguredCartItem? initial;
 const ProductOptionsSheet({super.key,required this.product,required this.options,required this.lineId,required this.thai,required this.maximumQuantity,this.initial});
 @override
 State<ProductOptionsSheet> createState()=>_ProductOptionsSheetState();
}
class _ProductOptionsSheetState extends State<ProductOptionsSheet> {
 final Map<String,int> _selected={};
 late final TextEditingController _note;
 late int _quantity;
 String? _error;
 String t(String th,String en)=>widget.thai?th:en;
 String key(String group,String choice)=>'$group:$choice';
 @override
 void initState(){
  super.initState();final initial=widget.initial;
  _quantity=initial?.qty??1;_note=TextEditingController(text:initial?.allergyNote??'');
  if(initial!=null&&initial.optionVersion==widget.options.version){for(final s in initial.selections){_selected[key(s.groupId,s.choiceId)]=s.qty;}}
 }
 @override
 void dispose(){_note.dispose();super.dispose();}
 int count(MobileOptionGroup group)=>group.choices.fold(0,(sum,c)=>sum+(_selected[key(group.id,c.id)]??0));
 void change(MobileOptionGroup group,MobileOptionChoice choice,int delta){
  final id=key(group.id,choice.id),next=(_selected[id]??0)+delta;
  if(next<0||next>choice.maxQty||delta>0&&count(group)>=group.maxSelections)return;
  setState((){if(next==0){_selected.remove(id);}else{_selected[id]=next;}_error=null;});
 }
 Widget choiceCard(BuildContext context,MobileOptionGroup group,MobileOptionChoice choice){
  final quantity=_selected[key(group.id,choice.id)]??0;
  final selected=quantity>0,single=group.maxSelections==1;
  final name=widget.thai?choice.name:choice.nameEn;
  final canSelect=choice.maxQty>0&&(single||count(group)<group.maxSelections);
  void toggle(){
   if(selected){change(group,choice,-1);return;}
   if(!canSelect)return;
   if(!single){change(group,choice,1);return;}
   setState((){
    for(final peer in group.choices){_selected.remove(key(group.id,peer.id));}
    _selected[key(group.id,choice.id)]=1;_error=null;
   });
  }
  final details=Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text(name,style:Theme.of(context).textTheme.titleMedium),
   Text('${selected?t('เลือกแล้ว · ','Selected · '):''}+${formatMinorUnits(choice.priceDelta.amountMinor,choice.priceDelta.decimals,choice.priceDelta.currency)}',style:Theme.of(context).textTheme.bodySmall),
  ]);
  if(single||choice.maxQty==1){return FoodRowCard(child:Row(children:[
   Semantics(checked:selected,inMutuallyExclusiveGroup:single,child:IconButton(
    tooltip:'${selected?t('ลด','Decrease'):t('เพิ่ม','Increase')} $name',
    onPressed:selected||canSelect?toggle:null,
    icon:Icon(single?(selected?Icons.radio_button_checked:Icons.radio_button_unchecked):(selected?Icons.check_box:Icons.check_box_outline_blank)),
   )),
   const SizedBox(width:10),Expanded(child:details),
  ]));}
  return FoodRowCard(child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
   details,
   Wrap(crossAxisAlignment:WrapCrossAlignment.center,children:[
    IconButton(tooltip:'${t('ลด','Decrease')} $name',onPressed:selected?()=>change(group,choice,-1):null,icon:const Icon(Icons.remove_circle_outline)),
    Semantics(label:name,value:'$quantity',child:Text('$quantity')),
    IconButton(tooltip:'${t('เพิ่ม','Increase')} $name',onPressed:quantity>=choice.maxQty||count(group)>=group.maxSelections?null:()=>change(group,choice,1),icon:const Icon(Icons.add_circle_outline)),
   ]),
  ]));
 }
 void submit(){
  if(_quantity<1||_quantity>widget.maximumQuantity){setState(()=>_error=t('จำนวนเกินสินค้าคงเหลือ กรุณาโหลดเมนูใหม่','Quantity exceeds availability. Reload the menu.'));return;}
  for(final g in widget.options.groups.where((g)=>g.enabled)){
   final n=count(g);if(n<g.minSelections||n>g.maxSelections){setState(()=>_error=t('กรุณาเลือก ${g.name} ให้ครบ ${g.minSelections}–${g.maxSelections} ต่อชิ้น','Choose ${g.minSelections}–${g.maxSelections} ${g.nameEn} per item.'));return;}
  }
  final note=_note.text;
  if(note.length>300||utf8.encode(note).length>1200||RegExp(r'[\x00-\x09\x0b-\x1f\x7f-\x9f]').hasMatch(note)){
   setState(()=>_error=t('หมายเหตุยาวเกินไปหรือมีอักขระที่ไม่รองรับ','Note is too long or contains unsupported control characters.'));return;
  }
  final selections=<MobileOptionSelection>[];
  for(final g in widget.options.groups.where((g)=>g.enabled)){for(final c in g.choices.where((c)=>c.enabled)){
   final n=_selected[key(g.id,c.id)]??0;if(n>0)selections.add(MobileOptionSelection(groupId:g.id,choiceId:c.id,qty:n));
  }}
  Navigator.of(context).pop(MobileConfiguredCartItem(lineId:widget.initial?.lineId??widget.lineId,productId:widget.product.id,qty:_quantity,optionVersion:widget.options.version,selections:selections,allergyNote:widget.options.noteEnabled&&note.isNotEmpty?note:null));
 }
 @override
 Widget build(BuildContext context){
  final product=widget.product;
  return FoodPresentation(child:Builder(builder:(context)=>Padding(
   padding:EdgeInsets.only(bottom:MediaQuery.viewInsetsOf(context).bottom),
   child:SizedBox(height:MediaQuery.sizeOf(context).height,child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
    Expanded(child:SingleChildScrollView(child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
     Padding(padding:const EdgeInsets.fromLTRB(18,8,24,12),child:Row(children:[
      IconButton(key:const ValueKey('product-detail-back'),tooltip:t('ปิด','Close'),onPressed:()=>Navigator.of(context).pop(),icon:const Icon(Icons.arrow_back),style:IconButton.styleFrom(backgroundColor:Theme.of(context).colorScheme.surface,shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(14)))),
      const SizedBox(width:10),
      Expanded(child:Text(widget.thai?product.name:product.nameEn,style:Theme.of(context).textTheme.headlineSmall)),
     ])),
     KeyedSubtree(key:const ValueKey('product-detail-hero'),child:FoodImage(url:product.imageUrl,hero:true)),
     Padding(padding:const EdgeInsets.fromLTRB(24,20,24,12),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
      Builder(builder:(context){
       final title=Text((widget.thai?product.name:product.nameEn).trim().isNotEmpty?(widget.thai?product.name:product.nameEn):(widget.thai?product.nameEn:product.name),style:Theme.of(context).textTheme.titleLarge?.copyWith(fontSize:27));
       final price=product.unitPrice==null?null:Semantics(label:t('ราคาสินค้าเริ่มต้น','Starting product price'),child:Text(formatMinorUnits(product.unitPrice!.amountMinor,product.unitPrice!.decimals,product.unitPrice!.currency),style:TextStyle(fontSize:25,fontWeight:FontWeight.w600,color:Theme.of(context).colorScheme.primary)));
       if(price==null)return title;
       return LayoutBuilder(builder:(context,constraints){
        if(constraints.maxWidth<330||MediaQuery.textScalerOf(context).scale(27)>32.4){
         return Column(crossAxisAlignment:CrossAxisAlignment.start,children:[title,const SizedBox(height:8),price]);
        }
        return Row(crossAxisAlignment:CrossAxisAlignment.start,children:[Expanded(child:title),const SizedBox(width:16),ConstrainedBox(constraints:BoxConstraints(maxWidth:constraints.maxWidth*0.4),child:price)]);
       });
      }),
      if(product.description.isNotEmpty)...[const SizedBox(height:8),Text(product.description)],
      if(widget.maximumQuantity<1)...[
       const SizedBox(height:12),
       Semantics(liveRegion:true,child:Text(t('สินค้าหมดหรือจำนวนในตะกร้าครบแล้ว กรุณากลับไปตรวจสอบเมนู','Unavailable or already at the cart limit. Return to check the menu.'),style:TextStyle(color:Theme.of(context).colorScheme.error))),
      ],
      if(product.unitPrice==null)...[
       const SizedBox(height:12),
       Semantics(liveRegion:true,child:Text(t('ยังไม่มีราคาสินค้า กรุณากลับไปโหลดเมนูใหม่','Price unavailable. Return and reload the menu.'),style:TextStyle(color:Theme.of(context).colorScheme.error))),
      ],
      const SizedBox(height:16),
      for(final g in widget.options.groups.where((g)=>g.enabled))...[
       Text(widget.thai?g.name:g.nameEn,style:Theme.of(context).textTheme.titleMedium?.copyWith(fontSize:16)),
       Text('${t('เลือกต่อชิ้น','Selections per item')}: ${count(g)} / ${g.minSelections}–${g.maxSelections}',style:Theme.of(context).textTheme.bodySmall),
       const SizedBox(height:12),
       for(final c in g.choices.where((c)=>c.enabled))choiceCard(context,g,c),
       const SizedBox(height:12),
      ],
      if(widget.options.noteEnabled)...[
       const SizedBox(height:16),
       TextField(controller:_note,maxLength:300,maxLines:3,decoration:InputDecoration(labelText:t('หมายเหตุอาหารแพ้ / คำแนะนำ','Allergy notes / instructions'),helperText:t('ไม่ใช่การรับรองว่าปลอดสารก่อภูมิแพ้ กรุณาตรวจสอบกับร้าน','Not an allergen-free guarantee. Confirm with the merchant.'),helperMaxLines:3)),
      ],
      const SizedBox(height:20),
      Wrap(crossAxisAlignment:WrapCrossAlignment.center,children:[
       IconButton(tooltip:t('ลดจำนวนสินค้า','Decrease product quantity'),onPressed:_quantity<=1?null:()=>setState(()=>_quantity--),icon:const Icon(Icons.remove_circle_outline)),
       Text('$_quantity',style:const TextStyle(fontSize:21,fontWeight:FontWeight.w600)),
       IconButton(tooltip:t('เพิ่มจำนวนสินค้า','Increase product quantity'),onPressed:_quantity>=widget.maximumQuantity?null:()=>setState(()=>_quantity++),icon:const Icon(Icons.add_circle_outline)),
      ]),
      const SizedBox(height:12),
      Text(t('ราคาสุดท้ายและโปรโมชันตรวจโดยเซิร์ฟเวอร์ก่อนยืนยัน ตัวเลือกที่เลือกใช้ต่อสินค้าหนึ่งชิ้น','The server confirms final prices and promotions before ordering. Selections apply per item.'),style:Theme.of(context).textTheme.bodySmall),
      if(_error!=null)Semantics(liveRegion:true,child:Text(_error!,style:TextStyle(color:Theme.of(context).colorScheme.error))),
     ])),
    ]))),
    SafeArea(top:false,child:Padding(padding:const EdgeInsets.fromLTRB(24,12,24,24),child:FilledButton(key:const ValueKey('product-detail-submit'),
     onPressed:widget.maximumQuantity<1||product.unitPrice==null?null:submit,
     child:Text(widget.initial==null?t('เพิ่มลงตะกร้า','Add to cart'):t('บันทึกรายการ','Save item')),
    ))),
   ])),
  )));
 }
}
