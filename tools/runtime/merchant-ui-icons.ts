import ts from 'typescript';
import {readFile,writeFile} from 'node:fs/promises';
const files=['Pos','CustomerCard','RegistrySettings','PricingSettings','ProductOfferEditor'];
const apply=process.argv.includes('--write');
const meanings:[RegExp,string][]=[[/Decrease|^−$/,'minus'],[/Increase|^\+$/,'plus'],[/Log out/,'logout'],[/Sign in/,'login'],[/Review canonical|row\.id|Order|Incoming/,'receipt'],[/Confirm|Done|Acknowledge/,'check'],[/Clear|Delete|Remove|Disable/,'trash'],[/Close|Cancel/,'close'],[/Refresh|Retry|Resolve|Load/,'refresh'],[/Edit|offer/,'edit'],[/Save|Publish/,'save'],[/pair|Pair/,'link'],[/Settings/,'settings'],[/Menu/,'menu'],[/Cart|cart/,'cart'],[/Add|Create|New/,'plus'],[/customer|Customer|contact/,'staff']];
for(const file of files){
 const path=`apps/web/src/components/${file}.tsx`;const source=await readFile(path,'utf8');
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const changes:{start:number,end:number,text:string}[]=[];let buttons=0;
 function visit(node:ts.Node){
  if(ts.isJsxElement(node)&&(node.openingElement.tagName.getText(ast)==='button'||(node.openingElement.tagName.getText(ast)==='a'&&node.openingElement.getText(ast).includes('className="button"')))){
   const children=node.children.map(c=>c.getText(ast)).join(' ');const opening=node.openingElement.getText(ast);
   if(!children.includes('MerchantIcon')&&!children.includes('LocaleFlag')){
    if(opening.includes('setLanguage')){
     const head=opening.replace('className="secondary"','className="secondary language-toggle"').replace(' onClick='," title={text('เปลี่ยนเป็นภาษาอังกฤษ', 'Switch to Thai')} aria-pressed={language === 'th'} onClick=");
     changes.push({start:node.openingElement.getStart(ast),end:node.openingElement.end,text:head},{start:node.openingElement.end,end:node.closingElement.getStart(ast),text:"<LocaleFlag language={language === 'en' ? 'th' : 'en'} />"});
    }else{
     const glyph=children.trim();const role=opening.includes('data-demo-role');const meaning=role?'{role}':`"${meanings.find(([pattern])=>pattern.test(children+' '+opening.match(/aria-label=\{?[^>]+/)?.[0]))?.[1]??(opening.includes('className="product"')?'plus':'arrow')}"`;
     const icon=`<MerchantIcon name=${meaning} />`;
     changes.push({start:node.openingElement.end,end:['−','+'].includes(glyph)?node.closingElement.getStart(ast):node.openingElement.end,text:icon});
    }
    buttons++;
   }
  }
  if(file==='Pos'&&ts.isJsxElement(node)&&node.openingElement.tagName.getText(ast)==='span'&&node.openingElement.getText(ast)==='<span className="badge">'&&node.children.some(c=>c.getText(ast)==='{session.role}')){
   changes.push({start:node.openingElement.getStart(ast),end:node.openingElement.end,text:'<span className="badge" data-role={session.role}>'},{start:node.openingElement.end,end:node.openingElement.end,text:"<MerchantIcon name={session.role === 'owner' ? 'owner' : session.role === 'manager' ? 'manager' : 'staff'} />"});
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);
 if(changes.length){
  if(!source.includes("from './MerchantIcon'"))changes.push({start:0,end:0,text:`import MerchantIcon${file==='Pos'?', { LocaleFlag }':''} from './MerchantIcon';\n`});
  changes.sort((a,b)=>b.start-a.start);let result=source;for(const change of changes)result=result.slice(0,change.start)+change.text+result.slice(change.end);
  if(apply)await writeFile(path,result);
 }
 console.log(JSON.stringify({path,apply,buttons,changes:changes.length}));
}
