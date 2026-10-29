// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Tourist mode on meta-pay: the menu's item names in the visitor's language. Muse Spark translates only the names that
// are missing or whose English name changed, in one call per language, and the result is cached (migration 318).
// Prices, offers and availability still come from the server menu; without a model the English names are shown.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {MetaRouter} from '../../../../packages/meta-ai/src/router';
import type {MetaDb} from './identity';
import type {MenuItem} from './agent-orders';

export const TOURIST={ja:['日本語','Japanese'],zh:['中文','Simplified Chinese'],ko:['한국어','Korean'],fr:['Français','French'],de:['Deutsch','German'],es:['Español','Spanish']} as const;
export type TouristLang=keyof typeof TOURIST;
export const isTourist=(l:unknown):l is TouristLang=>typeof l==='string'&&l in TOURIST;
/** The few page words a visitor needs, per language (item names come from the cache). */
export const TOURIST_UI:Record<TouristLang,{menu:string;add:string;cart:string;pay:string;total:string;note:string}>={
 ja:{menu:'メニュー',add:'カートに入れる',cart:'カート',pay:'Stripeで支払う',total:'合計',note:'料理名はAI(Muse Spark)による翻訳です。価格はお店が設定しています。'},
 zh:{menu:'菜单',add:'加入购物车',cart:'购物车',pay:'用 Stripe 付款',total:'合计',note:'菜名由 AI(Muse Spark)翻译，价格由店家设定。'},
 ko:{menu:'메뉴',add:'장바구니에 담기',cart:'장바구니',pay:'Stripe로 결제',total:'합계',note:'메뉴 이름은 AI(Muse Spark)가 번역했으며 가격은 매장이 정합니다.'},
 fr:{menu:'Menu',add:'Ajouter au panier',cart:'Panier',pay:'Payer avec Stripe',total:'Total',note:'Noms traduits par l’IA (Muse Spark). Les prix sont fixés par le café.'},
 de:{menu:'Speisekarte',add:'In den Warenkorb',cart:'Warenkorb',pay:'Mit Stripe bezahlen',total:'Summe',note:'Namen von KI (Muse Spark) übersetzt. Preise legt das Café fest.'},
 es:{menu:'Menú',add:'Añadir al carrito',cart:'Carrito',pay:'Pagar con Stripe',total:'Total',note:'Nombres traducidos por IA (Muse Spark). Los precios los fija la cafetería.'},
};
const sha=(s:string)=>createHash('sha256').update(s).digest();

/** productId → translated name for the listed items; translates what is missing (one model call) when a router is given. */
export async function menuNames(db:MetaDb,router:MetaRouter|null,merchantId:string,lang:TouristLang,items:MenuItem[],deadlineMs=15000):Promise<Map<string,string>>{
 const cached=(await db.tenant(merchantId,c=>c.query<{product_id:string;name:string;source_sha256:Buffer}>('SELECT product_id,name,source_sha256 FROM meta_menu_translations WHERE lang=$1',[lang]))).rows;
 const out=new Map<string,string>();
 for(const r of cached){const i=items.find(x=>x.productId===r.product_id);if(i&&sha(i.nameEn).equals(r.source_sha256))out.set(r.product_id,r.name);}
 const missing=items.filter(i=>!out.has(i.productId)).slice(0,40);
 if(!missing.length||!router)return out;
 const ids=missing.map(i=>i.productId) as [string,...string[]];
 const schema=z.object({names:z.array(z.object({productId:z.enum(ids),name:z.string().trim().min(1).max(80)}).strict()).max(40)}).strict();
 const jsonSchema={type:'object',additionalProperties:false,required:['names'],properties:{names:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['productId','name'],properties:{productId:{type:'string',enum:ids},name:{type:'string',maxLength:80}}}}}};
 try{
  const r=await router.invoke({task:'agent_order',merchantId,messages:[{role:'system',content:`Translate cafe menu item names into ${TOURIST[lang][1]}. Keep each name short and natural for a menu; keep brand-like words (e.g. Latte) as a customer in that country would read them. Return every productId given. Do not add prices, sizes or descriptions.`},
   {role:'user',content:JSON.stringify({items:missing.map(i=>({productId:i.productId,english:i.nameEn,thai:i.name,category:i.category}))})}],
   output:{name:'menu_names',schema,jsonSchema},maxOutputTokens:2000,reasoningEffort:'minimal',deadlineMs});
  await db.tenant(merchantId,async c=>{for(const n of r.value.names){const i=missing.find(x=>x.productId===n.productId);if(!i||/[$฿€£¥₩]|\d{2,}/.test(n.name))continue;out.set(n.productId,n.name);
   await c.query(`INSERT INTO meta_menu_translations(merchant_id,product_id,lang,name,source_sha256) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,$3,$4)
    ON CONFLICT(merchant_id,product_id,lang) DO UPDATE SET name=EXCLUDED.name,source_sha256=EXCLUDED.source_sha256,created_at=clock_timestamp()`,[n.productId,lang,n.name,sha(i.nameEn)]);}});
 }catch{/* model unavailable: English names stay */}
 return out;
}
