import assert from 'node:assert/strict';
import {customerAuthMessage,CUSTOMER_CONSENT_VERSION} from '../../../packages/contracts/src/customer-auth.ts';

// Rerunnable checkout DOM + HTTP + visibly labeled wallet fixture. No usable
// signer, provider, chain transaction, physical Android or live-payment claim.
// Import this lever with tsx and supply a fresh Playwright page + local web origin.
export default async function customerConsentBrowserContracts(page,origin){
 assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
 const merchant='00000000-0000-4000-8000-000000000001',foreignMerchant='00000000-0000-4000-8000-000000000002',wallet='11111111111111111111111111111111',otherWallet='11111111111111111111111111111112';
 const tokens=['A','B','C','D'].map(char=>char.repeat(43)),calls=[],requested=[];
 const money={currency:'USD',decimals:2,amountMinor:'270'};
 const settlement={currency:'USDG',decimals:6,amountMinor:'2700000',network:'solana:devnet',genesisHash:'FIXTURE-genesis',mint:'FIXTURE-mint',tokenProgram:'FIXTURE-program',testToken:true,recipient:'FIXTURE-recipient',sponsor:'merchant_funded',assetId:'usdg-devnet',displayLabel:'USDG issuer devnet test',denominationPolicy:{id:'FIXTURE-denomination',numerator:'10000',denominator:'1'}};
 const asset={assetId:'usdg-devnet',symbol:'USDG',displayLabel:settlement.displayLabel,cluster:'devnet',genesisHash:settlement.genesisHash,mint:settlement.mint,tokenProgram:settlement.tokenProgram,decimals:6,instructionPolicy:'token2022_zero_fee',issuerTestAsset:true};
 const orders=tokens.map((token,index)=>({id:`00000000-0000-4000-8000-00000000001${index}`,version:1,status:index===2?'EXPIRED':'AWAITING_PAYMENT',payer:null,authority:{kind:'versioned',source:{kind:'register',registerId:'FIXTURE-register',label:'FIXTURE counter'},serving:{kind:'counter',label:'FIXTURE counter'},target:{deviceId:'FIXTURE-device',assignmentGeneration:'1'},pairingGeneration:'1'},pricing:{kind:'versioned',priceVersion:'FIXTURE-price',total:money,lines:[{productId:'FIXTURE-coffee',name:'กาแฟทดสอบ',nameEn:'Espresso',qty:1,priceVersion:'FIXTURE-price',basePrice:money,unitPrice:money,promotion:null}]},settlement,quoteExpiresAt:new Date(Date.now()+(index===2?-60000:600000)).toISOString(),paymentUrl:`${origin}/pay/${token}`,customerContext:{merchantId:index===3?foreignMerchant:merchant,menuUrl:`/pay/${token}/menu`}}));
 const frozen=JSON.stringify(orders),token='S'.repeat(43);
 const session={sessionId:'00000000-0000-4000-8000-000000000003',customerId:'00000000-0000-4000-8000-000000000004',merchantId:merchant,origin:new URL(origin).origin,walletAddress:wallet,consentVersion:CUSTOMER_CONSENT_VERSION,consentedPurchaseContext:true,expiresAt:new Date(Date.now()+7*86400000).toISOString(),sessionToken:token};
 let revoked=false;
 const cachePrefix=`bitpos-customer-auth:${session.origin}:${merchant}`,cacheKey=cachePrefix+':'+wallet;
 const menu={merchant:{id:merchant,name:'BROWSER MENU FIXTURE'},asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+60000).toISOString(),menuVersion:'FIXTURE-menu',priceVersion:'FIXTURE-price',pricingRevision:'1',currency:'USD',decimals:2,products:[{id:'FIXTURE-coffee',name:'กาแฟทดสอบ',nameEn:'Espresso',imageUrl:'/images/menu/espresso.jpg',category:'Coffee',description:'BROWSER FIXTURE',basePrice:money,unitPrice:money,promotion:null,available:5}]};
 page.on('request',request=>requested.push(request.url()));
 await page.addInitScript(({wallet})=>{
  window.phantom={solana:{isPhantom:true,isBitPOSTestFixture:true,
   async connect(){return {publicKey:{toString:()=>sessionStorage.getItem('fixture-wallet-address')||wallet}};},
   async signMessage(){sessionStorage.setItem('fixture-message-signatures',String(Number(sessionStorage.getItem('fixture-message-signatures')||0)+1));return {signature:new Uint8Array(64).fill(1)};},
   async signTransaction(){throw Error('No payment signature authorized by this browser fixture');},
  }};
 },{wallet});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,method=request.method(),body=method==='POST'?request.postDataJSON():null;
  calls.push({path,method,body});
  const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(path.endsWith('/events'))return route.abort('failed');
  const match=path.match(/^\/api\/pay\/([A-D]{43})(.*)$/);assert.ok(match,`Unexpected fixture request ${method} ${path}`);
  const order=orders[tokens.indexOf(match[1])],operation=match[2];assert.ok(order);
  if(operation==='')return reply(order);
  if(operation==='/assets')return reply({selectedAssetId:'usdg-devnet',canChange:true,assets:[{asset,settlement}]});
  if(operation==='/menu'){assert.equal(method,'GET');return reply({menu,tableUrl:null});}
  if(operation==='/customer/challenge'){
   assert.equal(body.walletAddress,wallet);
   const challenge={challengeId:'00000000-0000-4000-8000-000000000005',origin:session.origin,merchantId:merchant,walletAddress:wallet,order:{orderId:order.id,requestHash:'FIXTURE-request',createdAt:new Date(Date.now()-1000).toISOString(),occupancyId:null,occupancyGeneration:null},nonce:'N'.repeat(43),issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),consentVersion:CUSTOMER_CONSENT_VERSION};
   return reply({...challenge,message:customerAuthMessage(challenge)});
  }
  if(operation==='/customer/verify'){assert.deepEqual(body.consent,{version:CUSTOMER_CONSENT_VERSION,profile:true,purchaseHistory:true});return reply(session);}
  if(operation==='/customer/session'||operation==='/customer/use'){
   assert.equal(body.sessionToken,token);
   if(revoked||order.customerContext.merchantId!==merchant)return reply({error:{code:'AUTH_REQUIRED',message:'Fixture session rejected',retryable:false}},401);
   if(operation==='/customer/use')assert.equal(body.walletAddress,wallet);
   return reply(session);
  }
  if(operation==='/customer/revoke'){revoked=true;return reply({revoked:true,scope:'merchant-wallet'});}
  if(operation==='/attempt')return reply({error:{code:'WALLET_CONFLICT',message:'No payment attempt authorized by fixture',retryable:false}},409);
  throw Error(`Unexpected fixture request ${method} ${path}`);
 });
 const open=async index=>{await page.goto(`${origin}/pay/${tokens[index]}`);await page.getByRole('link',{name:'View menu / ดูเมนู',exact:true}).waitFor();};
 const offers=page.getByLabel('Optional personal offers / ข้อเสนอส่วนตัวแบบเลือกใช้');
 const expand=async()=>{await offers.locator('summary').click();await page.waitForFunction(()=>!document.querySelector('.checkout-options[aria-label^="Optional"]')?.textContent.includes('Checking your existing session'));};
 const signatures=()=>page.evaluate(()=>Number(sessionStorage.getItem('fixture-message-signatures')||0));
 await page.setViewportSize({width:390,height:844});await open(0);await page.evaluate(()=>sessionStorage.clear());await page.reload();await page.getByRole('link',{name:'View menu / ดูเมนู',exact:true}).waitFor();
 // Immediate anonymous browsing must perform no POST, wallet connect or signature.
 await page.getByRole('link',{name:'View menu / ดูเมนู',exact:true}).click();await page.getByRole('region',{name:'Cafe menu',exact:true}).waitFor();
 assert.match(await page.getByRole('region',{name:'Cafe menu',exact:true}).textContent(),/Espresso.*USD 2\.70/);
 assert.equal(await page.getByRole('link',{name:'Open this table’s ordering menu',exact:true}).count(),0,'Counter never guesses a table');
 assert.equal(calls.some(call=>call.method==='POST'),false);assert.equal(await signatures(),0);
 await page.getByRole('button',{name:'เปลี่ยนเป็นภาษาไทย',exact:true}).click();await page.getByRole('heading',{name:'เมนู',exact:true}).waitFor();await page.getByRole('link',{name:'กลับไปบิลเดิม',exact:true}).click();await expand();
 await offers.getByRole('combobox').first().selectOption('en');
 await offers.getByRole('combobox').nth(1).selectOption('Phantom');
 assert.equal(await offers.getByRole('checkbox').isChecked(),false,'Consent is never automatic');
 assert.equal(await offers.getByRole('button',{name:'Sign message & confirm consent',exact:true}).isDisabled(),true);
 await offers.getByRole('checkbox').check();await offers.getByRole('button',{name:'Sign message & confirm consent',exact:true}).click();await offers.getByText(/Verified for personal offers on this bill/).waitFor();assert.equal(await signatures(),1);
 await open(1);await expand();await offers.getByText(/Verified session ready to use/).waitFor();
 assert.equal(calls.filter(call=>call.path.endsWith('/customer/use')).length,0,'Restoring bill two must not bind it automatically');
 await offers.getByRole('button',{name:'Use this session for this bill',exact:true}).click();await offers.getByText(/Verified for personal offers on this bill/).waitFor();
 assert.equal(await signatures(),1,'Two bills reuse a live session without repeated wallet approval');assert.equal(calls.filter(call=>call.path.endsWith('/customer/challenge')).length,1);assert.equal(calls.filter(call=>call.path.endsWith('/customer/verify')).length,1);assert.equal(calls.filter(call=>call.path.endsWith('/customer/use')).length,1);
 // A connected different wallet must not inherit the cached wallet identity.
 await page.evaluate(address=>sessionStorage.setItem('fixture-wallet-address',address),otherWallet);
 await page.getByRole('button',{name:'Pay 2.70 USDG',exact:true}).click();await offers.getByRole('checkbox').waitFor();assert.equal(await offers.getByRole('button',{name:'Use this session for this bill',exact:true}).count(),0);assert.equal(await signatures(),1);
 await page.evaluate(()=>sessionStorage.removeItem('fixture-wallet-address'));
 await open(3);await expand();assert.equal(await offers.getByRole('checkbox').isChecked(),false);assert.equal(calls.filter(call=>call.path.includes(tokens[3])&&call.path.endsWith('/customer/session')).length,0,'Foreign merchant never receives this token');
 // Explicit server revocation clears the merchant/wallet cache and stays revoked on reload.
 await open(1);await expand();await offers.getByRole('button',{name:'Revoke authentication & consent',exact:true}).click();await offers.getByText(/Authentication and consent revoked/).waitFor();assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),cacheKey),null);
 await page.reload();await expand();assert.equal(await offers.getByRole('checkbox').isChecked(),false);assert.equal(await signatures(),1);
 await page.evaluate(({key,prefix,session})=>{sessionStorage.setItem(key,JSON.stringify(session));sessionStorage.setItem(prefix,session.walletAddress);},{key:cacheKey,prefix:cachePrefix,session});await page.reload();await expand();await offers.getByRole('alert').waitFor();assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),cacheKey),null,'A server-revoked cached session is evicted');
 revoked=false;
 for(const change of [{expiresAt:'2000-01-01T00:00:00Z'},{origin:'https://foreign.example'},{walletAddress:otherWallet}]){
  await page.evaluate(({key,prefix,session,change})=>{sessionStorage.setItem(key,JSON.stringify({...session,...change}));sessionStorage.setItem(prefix,session.walletAddress);},{key:cacheKey,prefix:cachePrefix,session,change});await page.reload();await expand();await offers.getByRole('alert').waitFor();assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),cacheKey),null);assert.equal(await signatures(),1);
 }
 await open(2);await page.getByRole('heading',{name:'This order has expired',exact:true}).waitFor();await page.getByRole('link',{name:'View menu / ดูเมนู',exact:true}).click();await page.getByRole('region',{name:'Cafe menu',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(JSON.stringify(orders),frozen,'Navigation/auth never rewrites bill, payer, price or target');assert.equal(calls.some(call=>/dismiss|release|\/quotes|\/orders|\/visit|\/submit/.test(call.path)),false,'No release, join, order or transaction is authorized');
 assert.equal(requested.some(url=>new URL(url).origin!==new URL(origin).origin),false,'Browser fixture performs no external requests');
 return {origin:'browser_http_wallet_fixture_contract',physicalAndroid:false,livePayment:false,twoOrderSignatures:await signatures(),serverRevalidation:true,explicitSessionUse:true,anonymousUnpaidAndExpiredMenu:true,cacheIsolation:['merchant','origin','wallet'],revocationEviction:true,billAuthorityUnchanged:true};
}
