// Fixture-only mock of the BitPOS API for rendering web pages locally (synthetic data, no real services).
// Run: node mock-api.mjs   (listens on 127.0.0.1:3001; web proxies /api to it)
import http from 'node:http';
const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const money=(m,c='USD',d=2)=>({currency:c,decimals:d,amountMinor:String(m)});
const now=new Date().toISOString();
const products=[['Iced latte','ลาเต้เย็น','Coffee',450,12],['Flat white','แฟลตไวท์','Coffee',480,3],['Matcha latte','มัทฉะลาเต้','Tea',520,0],['Croissant','ครัวซองต์','Bakery',380,20],['Pad kra pao','ผัดกะเพรา','Food',650,8]].map(([n,t,c,p,a],i)=>({id:U(100+i),name:t,nameEn:n,imageUrl:null,category:c,description:'',unitPrice:money(p),basePrice:money(p),promotion:null,available:a}));
const menu={products,merchant:{name:'Sample Cafe (fixture)'},asOf:now,priceValidUntil:new Date(Date.now()+36e5).toISOString(),menuVersion:'1',priceVersion:'1',pricingRevision:'1',currency:'USD',decimals:2};
const tables=['Window 1','Window 2','Bar 1'].map((l,i)=>({id:U(200+i),label:l,retiredAt:null,occupancy:{active:false}}));
const devices=[{id:U(300),label:'Counter Mini',tableId:tables[0].id,tableLabel:'Window 1',assignmentGeneration:'3',authGeneration:'5',revokedAt:null,online:true,lastSeenAt:now,connectionGeneration:'5',screen:{kind:'idle',screenGeneration:'8',orderId:null,sessionId:null}}];
const registers=[{id:U(400),label:'Front register',deviceId:U(300),pairingGeneration:'4',retiredAt:null,targetOnline:true}];
const line=(p,q)=>({productId:p.id,name:p.name,nameEn:p.nameEn,qty:q,priceVersion:'1',basePrice:p.unitPrice,unitPrice:p.unitPrice,promotion:null});
const settle={currency:'USDG',decimals:6,amountMinor:'8300000',network:'solana:devnet',genesisHash:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',mint:'MintFixture',tokenProgram:'TokenFixture',testToken:true,recipient:'DemoTreasuryWalletAddressFixtureOnly11111111',sponsor:'merchant_funded'};
const mkOrder=(i,status,fulfil,ch)=>({id:U(500+i),status,version:2,authority:ch==='counter'?{kind:'versioned',source:{kind:'register',registerId:U(400),label:'Front register'},serving:{kind:'counter',label:'Counter'},target:{deviceId:U(300),assignmentGeneration:'3'},pairingGeneration:'4'}:{kind:'versioned',source:{kind:'online',accountId:U(9),branchId:U(10),channel:'customer_app',label:'Customer app'},serving:{kind:'pickup',label:'Pickup'},target:null,pairingGeneration:null},payer:null,pricing:{kind:'versioned',priceVersion:'1',lines:[line(products[0],1+i%2),line(products[3],1)],total:money(830+450*(i%2))},settlement:settle,quoteExpiresAt:new Date(Date.now()+6e5).toISOString(),paymentUrl:'http://127.0.0.1:4482/pay/x',fulfillment:{status:fulfil,version:1,notification:null,target:null},createdAt:now});
const orders=[mkOrder(0,'PAID','NEW','counter'),mkOrder(1,'PAID','PREPARING','online'),mkOrder(2,'PAID','READY','online'),mkOrder(3,'PAID','COMPLETED','counter'),mkOrder(4,'PENDING','NEW','online')];

const usdg={assetId:'usdg-devnet',symbol:'USDG',displayLabel:'Test USDG',cluster:'devnet',genesisHash:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',mint:'4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7',tokenProgram:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',decimals:6,instructionPolicy:'token2022_zero_fee',issuerTestAsset:true};
const usdgSettle={...settle,mint:usdg.mint,tokenProgram:usdg.tokenProgram};
const usdc={...usdg,assetId:'usdc-devnet',symbol:'USDC',displayLabel:'Test USDC',mint:'UsdcMintFixture',tokenProgram:'TokenkegFixture',instructionPolicy:'spl_checked'};
const usdcSettle={...settle,currency:'USDC',mint:usdc.mint,tokenProgram:usdc.tokenProgram,assetId:'usdc-devnet',displayLabel:'Test USDC',denominationPolicy:{id:'fixture-1to1',numerator:'10000',denominator:'1'}};
const payOrder={...mkOrder(0,'PENDING','RECEIVED','counter'),settlement:{...usdgSettle},customerContext:{merchantId:U(1),menuUrl:'/pay/abc/menu'}};
const group=[{currency:'USD',decimals:2,sourceKind:'counter',orders:4,totalMinor:'4120'}];
const routes=[
 [/^GET \/api\/pay\/[^/]+\/menu$/,()=>({menu,tableUrl:null})],
 [/^GET \/api\/pay\/[^/]+\/assets$/,()=>({selectedAssetId:'usdg-devnet',canChange:true,assets:[{asset:usdg,settlement:{...usdgSettle}},{asset:usdc,settlement:usdcSettle}]})],
 [/^GET \/api\/pay\/([^/]+)$/,(m)=>{const st={paid:'PAID',conf:'CONFIRMING',exp:'EXPIRED',rec:'RECOVERY',wallet:'AWAITING_WALLET'}[m.split('-')[0]]||'AWAITING_PAYMENT';return {...payOrder,status:st,customerContext:{merchantId:U(1),menuUrl:`/pay/${m}/menu`}};}],
 [/^GET \/api\/table\/[A-Za-z0-9_-]{43}$/,()=>({tableLabel:'Window 1',menu,online:true,available:true,occupancy:{active:false},collectionPolicy:{counterEnabled:true,version:1}})],
 [/^GET \/api\/demo-session$/,()=>({enabled:true})],
 [/^(POST|GET) \/api\/(demo-)?session$/,()=>({token:'fixture-token',merchantId:U(1),userId:U(2),role:'owner'})],
 [/^GET \/api\/menu/,()=>menu],[/^GET \/api\/tables/,()=>({tables})],[/^GET \/api\/devices/,()=>({devices})],[/^GET \/api\/registers$/,()=>({registers})],
 [/^GET \/api\/orders\/[^/]+$/,()=>orders[1]],
 [/^GET \/api\/orders/,()=>({orders})],
 [/^GET \/api\/registers\/.*\/order/,()=>({order:null})],
 [/^GET \/api\/settings\/hours/,()=>({configured:true,timeZone:'Asia/Bangkok',revision:1,week:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[String(d),[{open:'08:00',close:'17:00'}]]))})],
 [/^GET \/api\/settings\/pricing/,()=>({revision:'1',configured:true,priceVersion:'1',catalogCurrency:'USD',decimals:2,provenance:null,prices:products.map(p=>({productId:p.id,unitMinor:p.unitPrice.amountMinor})),settlement:{genesisHash:'x',quotePolicy:null}})],
 [/^GET \/api\/settings\/collection/,()=>({counterEnabled:true,version:1})],
 [/^GET \/api\/settings\/payment-assets/,()=>({assets:[],revision:'1'})],
 [/^GET \/api\/settings$/,()=>({treasury:'DemoTreasuryWalletAddressFixtureOnly11111111'})],
 [/^GET \/api\/inventory\/stock/,()=>({products:products.map(p=>({productId:p.id,stock:p.available+2,reserved:2,available:p.available,reorderLevel:p.available<5?10:null}))})],
 [/^GET \/api\/inventory\/movements/,()=>({movements:[{id:U(600),productId:products[0].id,kind:'RECEIVE',delta:24,stockBefore:0,stockAfter:24,reason:'Delivery',reference:'INV-001',actor:U(2),createdAt:now},{id:U(601),productId:products[1].id,kind:'ADJUST',delta:-2,stockBefore:5,stockAfter:3,reason:'Spoiled',reference:'',actor:U(2),createdAt:now}],nextCursor:null})],
 [/^GET \/api\/suppliers/,()=>({suppliers:[{id:U(700),name:'Bean Co (fixture)',supplies:'Coffee beans',contact:'Somchai',phone:'0800000000',active:true,version:1,createdAt:now,updatedAt:now}]})],
 [/^GET \/api\/reports\/sales/,()=>({from:now.slice(0,10),to:now.slice(0,10),timeZone:'Asia/Bangkok',days:[{day:now.slice(0,10),groups:group}],hours:[],refunds:[],excludedOrders:0})],
 [/^GET \/api\/returns/,()=>({returns:[]})],
 [/^GET \/api\/shifts/,()=>({open:{periodStart:now,asOf:now,snapshot:{timeZone:'Asia/Bangkok',groups:group,excludedOrders:0}},closes:[]})],
 [/^GET \/api\/team/,()=>({members:[{userId:U(2),role:'owner',you:true},{userId:U(3),role:'manager',you:false},{userId:U(4),role:'staff',you:false}]})],
 [/^GET \/api\/activity/,()=>({entries:[{id:U(800),actor:U(2),action:'product.update',subject:'Iced latte',createdAt:now},{id:U(801),actor:U(3),action:'stock.receive',subject:'Flat white',createdAt:now}],nextCursor:null})],
 [/^GET \/api\/customers\/[^/]+\/orders/,()=>({orders:orders.slice(0,2)})],
 [/^GET \/api\/customers/,()=>({customers:[{id:U(900),name:'Customer A (fixture)',email:'a@example.invalid',phone:'0800000001',notes:'',wallets:[{address:'7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',avatar:''}]},{id:U(901),name:'Customer B (fixture)',wallets:[]}]})],
 [/^GET \/api\/promotions\/recipients/,()=>({tables:[],customers:[{id:U(900),name:'Customer A (fixture)',walletLabel:'7xKX…gAsU',paidOrders:3}],orders:[]})],
 [/^GET \/api\/promotions/,()=>({campaigns:[],jobs:[],drafts:[],queues:{}})],
];
http.createServer((req,res)=>{
 const key=`${req.method} ${req.url.split('?')[0]}`;
 const r=routes.find(([p])=>p.test(key));
 let body='';req.on('data',d=>body+=d);req.on('end',()=>{
  if(!r){console.log('MISS',key);res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({error:{code:'RESOURCE_NOT_FOUND',message:'fixture has no route',retryable:false}}));}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(r[1](decodeURIComponent((req.url.match(/\/pay\/([^/?]+)/)||[])[1]||''))));});
}).listen(3001,'127.0.0.1',()=>console.log('mock api on 3001'));
