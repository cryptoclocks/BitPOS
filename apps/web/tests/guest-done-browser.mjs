import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Actual hydrated TableMenu -> Payment -> TableMenu/RepeatCoffee, with local HTTP
// fixtures only. No stored PAID seed, wallet signer, settlement/backend eligibility,
// chain transaction, physical Android, device ACK or deployment proof is claimed.
// Supply a fresh Playwright page and running loopback web origin, or run this file
// directly with <web-origin> [loopback-CDP-url] to print its observed receipt.
export default async function guestDoneBrowserContracts(page,origin){
 assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Fixtures must stay local');
 const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const entry='E'.repeat(43),originalVisit='V'.repeat(43),nextVisit='W'.repeat(43),access='P'.repeat(43);
 const base='/table/'+entry,guestKey='bitpos-table-guest-v1:'+entry,paidKey='bitpos-table-paid-visit-v1:'+entry;
 const generation='9007199254740993',money={currency:'USD',decimals:2,amountMinor:'300'},discounted={...money,amountMinor:'270'};
 const expiry=()=>new Date(Date.now()+600000).toISOString();
 const settlement={currency:'USDG',decimals:6,amountMinor:'3000000',network:'solana:devnet',genesisHash:'FIXTURE-genesis',mint:'FIXTURE-mint',tokenProgram:'FIXTURE-program',testToken:true,recipient:'FIXTURE-recipient',sponsor:'merchant_funded',assetId:'usdg-devnet',displayLabel:'USDG browser HTTP fixture',denominationPolicy:{id:'FIXTURE-denomination',numerator:'10000',denominator:'1'}};
 const asset={assetId:settlement.assetId,symbol:'USDG',displayLabel:settlement.displayLabel,cluster:'devnet',genesisHash:settlement.genesisHash,mint:settlement.mint,tokenProgram:settlement.tokenProgram,decimals:6,instructionPolicy:'token2022_zero_fee',issuerTestAsset:true};
 const authority={kind:'versioned',source:{kind:'device',deviceId:id(3),label:'FIXTURE clock'},serving:{kind:'table',tableId:id(4),label:'FIXTURE Table 4'},target:{deviceId:id(3),assignmentGeneration:'1'},pairingGeneration:null};
 const espresso={id:id(1),name:'เอสเปรสโซทดสอบ',nameEn:'Fixture espresso',category:'Coffee',description:'Browser HTTP fixture',imageUrl:'/images/menu/espresso.jpg',basePrice:money,unitPrice:money,available:20,promotion:null};
 const latte={...espresso,id:id(2),name:'ลาเต้ทดสอบ',nameEn:'Fixture latte',imageUrl:'/images/menu/latte.jpg'};
 const personal={targetId:id(10),campaignId:id(11),campaignVersion:1,recipientId:id(12),occupancyId:id(13),occupancyGeneration:generation,sessionId:id(14),discountPercent:10,expiresAt:expiry()};
 const menu=privateVisit=>({merchant:{name:'PAID DONE HTTP FIXTURE'},products:[espresso,privateVisit?{...latte,unitPrice:discounted,personalPromotion:personal}:latte],asOf:new Date().toISOString(),priceValidUntil:new Date(Date.now()+60000).toISOString(),menuVersion:'fixture-menu',priceVersion:id(5),pricingRevision:'1',currency:'USD',decimals:2});
 let paid=false,submitted=false,dismissed=false,sequence=20;
 const calls=[],visits=new Map();
 const occupancy=()=>({generation,active:submitted});
 const draft=token=>({kind:'draft',expiresAt:expiry(),online:true,available:true,occupancy:occupancy(),quote:null,menu:menu(token===nextVisit)});
 const line=product=>({productId:product.id,name:product.name,nameEn:product.nameEn,qty:1,priceVersion:id(5),basePrice:money,unitPrice:product.unitPrice,promotion:null,...(product.personalPromotion?{personalPromotion:product.personalPromotion}:{})});
 const originalLine=line(espresso);
 const order=()=>({id:id(6),status:paid?'PAID':'AWAITING_WALLET',version:paid?2:1,payer:null,authority,pricing:{kind:'versioned',priceVersion:id(5),lines:[originalLine],total:money},settlement,quoteExpiresAt:expiry(),paymentUrl:`${origin}/pay/${access}`,tableOccupancyGeneration:generation,customerContext:{merchantId:id(7),menuUrl:`/pay/${access}/menu`}});
 const quote=product=>({id:id(sequence++),priceVersion:id(5),pricingRevision:'1',cartVersion:null,lines:[line(product)],total:product.unitPrice,settlement:{...settlement,amountMinor:(BigInt(product.unitPrice.amountMinor)*10000n).toString()},quotedAt:new Date().toISOString(),validUntil:expiry(),collection:{kind:'table',policyVersion:1},authority});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.slice(4),method=request.method(),body=method==='GET'?null:request.postDataJSON();
  calls.push({path,method,body});
  const reply=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  if(path===`/pay/${access}/events`)return route.abort('failed');
  if(path===`/pay/${access}`){assert.equal(method,'GET');assert.equal(submitted,true);return reply(order());}
  if(path===`/pay/${access}/assets`)return reply({selectedAssetId:asset.assetId,canChange:false,assets:[{asset,settlement}]});
  if(path===`/pay/${access}/dismiss`){
   assert.equal(method,'POST');assert.deepEqual(body,{});assert.equal(paid,true);assert.equal(submitted,true);
   dismissed=true;return reply({done:true,returnUrl:base});
  }
  if(path===base){assert.equal(method,'GET');return reply({tableLabel:'FIXTURE Table 4',menu:menu(false),online:true,available:true,occupancy:occupancy()});}
  if(path===base+'/visit'){
   assert.equal(method,'POST');assert.match(body.requestId,/^[0-9a-f-]{36}$/i);
   const token=submitted?nextVisit:originalVisit;
   if(submitted){assert.equal(dismissed,true);assert.equal(body.sourceVisitToken,originalVisit,'Menu must carry the paid original private recipient into the new visit');}
   else assert.equal(body.sourceVisitToken,undefined);
   visits.set(token,body.requestId);return reply({visitToken:token,state:draft(token)});
  }
  const match=path.match(new RegExp('^'+base+'/visit/([A-Za-z0-9_-]{43})(.*)$'));assert.ok(match,`Unexpected fixture request ${method} ${path}`);
  const [,token,operation]=match;assert.equal(visits.has(token),true,'Only acquired private visits may be used');
  if(!operation){assert.equal(method,'GET');return reply(token===originalVisit&&submitted?{kind:'order',order:order()}:draft(token));}
  if(operation==='/quotes'){
   assert.equal(method,'POST');assert.equal(body.collection,'table');assert.equal(body.confirmJoin,submitted);
   assert.deepEqual(body.items,[{productId:token===originalVisit?espresso.id:latte.id,qty:1}]);
   return reply({quote:quote(token===originalVisit?espresso:{...latte,unitPrice:discounted,personalPromotion:personal})});
  }
  if(operation==='/orders'){
   assert.equal(method,'POST');assert.equal(token,originalVisit);assert.equal(submitted,false,'There must be only one submitted order');
   assert.match(body.quoteId,/^[0-9a-f-]{36}$/i);assert.equal(body.priceVersion,id(5));assert.match(body.idempotencyKey,/^[0-9a-f-]{36}$/i);
   submitted=true;return reply({kind:'order',order:order()});
  }
  if(operation==='/repeat-quotes'){
   assert.equal(method,'POST');assert.equal(token,nextVisit);assert.equal(body.sourceVisitToken,originalVisit,'Repeat must use the same original paid source, not the new draft');
   assert.equal(body.assetId,asset.assetId);assert.equal(body.maxAtomic,'3000000');assert.equal(body.confirmJoin,true);assert.ok(Date.parse(body.expiresAt)>Date.now());
   return reply({quote:quote(espresso)});
  }
  throw Error(`Unexpected fixture request ${method} ${path}`);
 });
 const enabled=async name=>{await page.waitForFunction(name=>[...document.querySelectorAll('button')].some(button=>(button.getAttribute('aria-label')||button.textContent.trim())===name&&!button.disabled),name);};
 const readStorage=key=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),key);
 await page.setViewportSize({width:390,height:844});await page.goto(origin+base);
 await enabled('Increase Fixture espresso');assert.equal(await readStorage(paidKey),null,'Start without any seeded paid source');
 await page.getByRole('button',{name:'Increase Fixture espresso',exact:true}).click();
 await page.getByRole('button',{name:/View your order/}).click();await enabled('Review order');
 await page.getByRole('button',{name:'Review order',exact:true}).click();await enabled('Confirm order & pay');
 await page.getByRole('button',{name:'Confirm order & pay',exact:true}).click();
 await page.waitForURL(origin+'/pay/'+access);await page.getByRole('heading',{name:'Your order, ready to pay.',exact:true}).waitFor();
 const unpaidJournal=await readStorage(guestKey);
 assert.equal(unpaidJournal.phase,'order');assert.equal(unpaidJournal.order.status,'AWAITING_WALLET');assert.equal(unpaidJournal.visitToken,originalVisit);
 assert.equal(await readStorage(paidKey),null);
 // Change only the HTTP settlement outcome; no menu tab polls/rewrites storage.
 paid=true;await page.reload();await page.getByRole('heading',{name:'Payment received',exact:true}).waitFor();
 assert.deepEqual(await readStorage(guestKey),unpaidJournal,'Payment must still face the real originally unpaid journal');
 await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Done · Returning to menu…',exact:true}).waitFor();
 assert.equal(dismissed,true);assert.deepEqual(await readStorage(paidKey),{visitToken:originalVisit,orderId:id(6),occupancyGeneration:generation});
 const cleared=await readStorage(guestKey);assert.equal(cleared.phase,'draft');assert.deepEqual(cleared.items,[]);assert.equal(cleared.visitToken,undefined);assert.notEqual(cleared.requestId,unpaidJournal.requestId);
 // Follow the actual Done timer/navigation, not a manually opened replacement.
 await page.waitForURL(origin+base,{timeout:20000});await enabled('Increase Fixture latte');
 await page.getByRole('button',{name:'Increase Fixture latte',exact:true}).click();await page.getByRole('button',{name:/View your order/}).click();
 await enabled('Join table & review');await page.getByRole('button',{name:'Join table & review',exact:true}).click();
 const review=page.getByRole('region',{name:'Canonical guest review',exact:true});await review.waitFor();
 assert.match(await review.textContent(),/Fixture latte.*USD 2\.70/,'The second visit must visibly obtain its private personal price');
 const continued=await readStorage(guestKey);assert.equal(continued.visitToken,nextVisit);assert.equal(continued.quote.lines[0].personalPromotion.recipientId,personal.recipientId);assert.equal(continued.quote.total.amountMinor,'270');
 await page.getByRole('button',{name:'Add something else',exact:true}).click();await page.getByText('More options',{exact:true}).click();
 const repeat=page.getByRole('region',{name:'Repeat previous paid order',exact:true});
 // The visible toggle's CSS-generated repeat glyph is part of its accessible name.
 await enabled('Order again');await repeat.getByRole('button',{name:/^Order again\b/}).click();
 await repeat.getByText(/Verified paid bill/).waitFor();
 assert.match(await repeat.textContent(),/1 × Fixture espresso/,'Repeat reloads the original settled order, not the second cart');
 await repeat.getByRole('button',{name:'Join table & prepare new bill',exact:true}).click();await review.waitFor();
 assert.match(await review.textContent(),/Fixture espresso.*USD 3\.00/);
 assert.equal(calls.filter(call=>call.path.endsWith('/orders')&&call.method==='POST').length,1,'Preparing the private/repeat bills must not submit another order');
 assert.equal(calls.filter(call=>call.path.endsWith('/dismiss')).length,1);
 assert.equal(calls.filter(call=>call.path.endsWith('/repeat-quotes')).length,1);
 assert.equal(calls.some(call=>/\/release$|\/clear$|\/attempt$|\/submit$|\/grants\/checkout$/.test(call.path)),false,'Done/continuation never clears occupancy or signs/submits payments');
 assert.deepEqual(await readStorage(paidKey),{visitToken:originalVisit,orderId:id(6),occupancyGeneration:generation});
 return {origin:'browser_http_fixture_contract',livePayment:false,backendEligibility:false,physicalAndroid:false,unpaidJournalCreatedByMenu:true,serverPaidDismiss:true,actualDoneMenuReturn:true,privateRecipientContinued:true,personalQuoteMinor:'270',repeatOriginalPaidSource:true,occupancyGeneration:generation,submittedOrders:1};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const origin=process.argv[2],cdp=process.argv[3]||'http://127.0.0.1:29347';
 assert.ok(origin,'Usage: node apps/web/tests/guest-done-browser.mjs <loopback-web-origin> [loopback-CDP-url]');
 for(const url of [origin,cdp])assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'Browser fixture endpoints must be loopback');
 const {chromium}=await import('../../../local/toolchains/browser-contract/node_modules/playwright/index.mjs');
 const browser=await chromium.connectOverCDP(cdp),context=await browser.newContext();
 let exit=0;
 try{console.log(JSON.stringify(await guestDoneBrowserContracts(await context.newPage(),origin),null,2));}
 catch(error){console.error(error);exit=1;}
 finally{await context.close();process.exit(exit);} // Never close the shared native-owned browser.
}
