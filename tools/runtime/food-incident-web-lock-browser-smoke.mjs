export async function verifyFoodIncidentWebLocks(tab){
 return tab.run(async({browser,assert})=>{
  const source=await (await import('node:fs/promises')).readFile('/tmp/bitpos-incident-session-browser-fixture.js','utf8');
  assert=(await import('node:assert/strict')).default;
  const pages=[await browser.newPage(),await browser.newPage()];
  try{
   for(const page of pages){await page.goto('http://127.0.0.1:4382/platform/food-incidents');await page.evaluate(source);await page.evaluate(async()=>{
    const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');window.fixtureRequests=[];window.fixtureId=id;window.fixtureAccount=id(90001);
    window.fetch=async input=>{if(String(input).endsWith('/auth/verify'))return Response.json({accountId:window.fixtureAccount,sessionId:id(90002),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'});return new Promise(resolve=>window.fixtureRequests.push(resolve));};
    window.fixtureApi=new window.BitposIncidentSessionFixture.FoodIncidentSession();await window.fixtureApi.verify('+66900000999','123456');
    window.fixtureCommand=n=>({kind:'ACK',incidentId:id(90003),command:{idempotencyKey:id(n),expectedVersion:'1',reason:'Synthetic cross-tab durable journal race'}});
    window.fixtureReceipt=()=>Response.json({incident:{incidentId:id(90003),assignmentId:id(90004),shipmentId:id(90005),generation:'1',leaseGeneration:'1',incidentVersion:'2',kind:'SOS',custodyPhase:'AT_PICKUP',blocksDuty:true,reportedAt:'2026-10-18T00:00:00Z',acknowledgedAt:'2026-10-18T00:01:00Z',resolvedAt:null,resolution:null},shipmentVersion:'7',paused:true});
   });}
   const [a,b]=pages;
   await a.evaluate(()=>localStorage.removeItem('bitpos.platform.foodIncident.'+window.fixtureAccount));
   await a.evaluate(()=>{window.fixtureX=window.fixtureApi.submitIncident(window.fixtureCommand(90010));});await a.waitForFunction(()=>window.fixtureRequests.length===1);
   const rejected=await b.evaluate(async()=>{try{await window.fixtureApi.submitIncident(window.fixtureCommand(90012));return 'UNEXPECTED';}catch(error){return error.code;}});assert.equal(rejected,'PENDING_COMMAND');
   await b.evaluate(()=>{window.fixtureReplay=window.fixtureApi.submitIncident(window.fixtureCommand(90010));});await b.waitForFunction(()=>window.fixtureRequests.length===1);
   await a.evaluate(async()=>{window.fixtureRequests[0](window.fixtureReceipt());await window.fixtureX;window.fixtureY=window.fixtureApi.submitIncident(window.fixtureCommand(90011)).catch(error=>error);});await a.waitForFunction(()=>window.fixtureRequests.length===2);
   await b.evaluate(async()=>{window.fixtureRequests[0](window.fixtureReceipt());await window.fixtureReplay;});
   const saved=await b.evaluate(()=>window.fixtureApi.pendingIncident());assert.equal(saved.command.idempotencyKey,'00000000-0000-4000-8000-000000090011');
   await a.evaluate(async()=>{window.fixtureRequests[1](Response.json({error:{code:'SERVICE_UNAVAILABLE'}},{status:503}));await window.fixtureY;});
   await b.reload();
   const persisted=await b.evaluate(()=>JSON.parse(localStorage.getItem('bitpos.platform.foodIncident.00000000-0000-4000-8000-000000090001')));assert.deepEqual(persisted,saved);
   await b.evaluate(()=>localStorage.removeItem('bitpos.platform.foodIncident.00000000-0000-4000-8000-000000090001'));
   return {status:'PASS_GENUINE_BROWSER_TWO_TAB_WEB_LOCK_JOURNAL',initialDifferentCommandDenied:true,lateExactReplayCannotEraseNewCommand:true,responseLostNewCommandSurvivesReload:true,fixture:'Current production FoodIncidentSession browser bundle; actual two same-origin pages/localStorage/navigator.locks. Synthetic session and controlled receipt/transport fixture only; no provider/API/domain transition acceptance.',physicalTesting:'deferred_by_user_2026-10-16'};
  }finally{await Promise.all(pages.map(page=>page.close()));}
 },{timeout:40});
}
