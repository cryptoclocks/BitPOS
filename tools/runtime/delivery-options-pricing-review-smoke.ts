import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {configuredLines,validateOptionGroups}=await import('../../apps/api/src/online-options');
const {MobileProductOptionsSchema,MobileConfiguredCartItemSchema,MobileConfiguredFoodLineSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const {pool}=await import('../../apps/api/src/db');
const after=process.argv.includes('--after');let checks=0;
try{
 const money={currency:'USD' as const,decimals:2 as const,amountMinor:'35'},product=randomUUID(),priceVersion=randomUUID(),version=randomUUID();
 const groups=Array.from({length:10},()=>({id:randomUUID(),name:'กลุ่ม',nameEn:'Group',enabled:true,minSelections:20,maxSelections:20,choices:Array.from({length:20},()=>({id:randomUUID(),name:'ตัวเลือก',nameEn:'Choice',enabled:true,maxQty:1,priceDelta:money}))}));
 const options=MobileProductOptionsSchema.parse({version,revision:'1',noteEnabled:true,groups});validateOptionGroups(options,money);
 const raw={lineId:randomUUID(),productId:product,qty:1,optionVersion:version,selections:groups.flatMap(g=>g.choices.map(c=>({groupId:g.id,choiceId:c.id,qty:1}))),allergyNote:null};
 const parsed=MobileConfiguredCartItemSchema.safeParse(raw);assert.equal(parsed.success,after);checks++;
 const p={productId:product,name:'กาแฟ',nameEn:'Coffee',qty:1,priceVersion,basePrice:{...money,amountMinor:'270'},unitPrice:{...money,amountMinor:'270'},promotion:null};
 if(parsed.success){const result=configuredLines([parsed.data],[p],new Map([[product,options]]));assert.equal(result[0].selections.length,200);assert.equal(result[0].lineTotal.amountMinor,'7270');MobileConfiguredFoodLineSchema.parse(result[0]);checks++;}
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',minimal={lineId:id,productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null};
 const parseAndPrice=()=>configuredLines([minimal,{...minimal,lineId:id.toUpperCase()}].map(i=>MobileConfiguredCartItemSchema.parse(i)),[{...p,qty:2}],new Map());
 if(after){assert.throws(parseAndPrice);checks++;}else{assert.equal(parseAndPrice().length,2);checks++;}
 assert.equal(MobileProductOptionsSchema.safeParse({version,revision:'1',noteEnabled:true,groups:[{...groups[0],id:groups[0].id.toUpperCase()}]}).success,!after);checks++;
 const receipt={environment:'deterministic_local_fixture',mode:after?'after':'before',assertions:checks,maximumSupportedSelectionTuples:200,maximumBoundaryAccepted:parsed.success,mixedCaseDuplicateBlocked:after,limits:['Strict generated transport boundary followed by actual pure canonical pricing; no API quote/order or payment claim'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-options-pricing-review-'+(after?'after':'before')+'.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await pool.end();}
