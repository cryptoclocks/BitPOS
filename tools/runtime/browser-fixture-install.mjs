import {spawnSync} from 'node:child_process';
// Public DOM request/result bridge: OMP eval callbacks do not survive a run.
// Every signature is produced by the fixed-order, database-constrained host CLI.
function sign(orderId,operation,bytes){const result=spawnSync('/opt/homebrew/bin/node',['/Users/cryptoclock/Desktop/BitPOS/tools/runtime/fixture-sign.cjs'],{cwd:'/Users/cryptoclock/Desktop/BitPOS',input:JSON.stringify({orderId,operation,bytes}),encoding:'utf8'});if(result.status!==0)throw Error('Host-constrained fixture refused signing');return JSON.parse(result.stdout);}
export default async function install(page,orderId){
 const address=sign(orderId,'address');
 await page.evaluate(address=>{
  const script=document.createElement('script');
  script.textContent=`(()=>{const request=(operation,bytes)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();const receive=event=>{const result=JSON.parse(event.detail);if(result.id!==id)return;document.removeEventListener('bitpos-fixture-result',receive);result.error?reject(Error(result.error)):resolve(Uint8Array.from(result.result));};document.addEventListener('bitpos-fixture-result',receive);document.documentElement.dataset.bitposFixtureRequest=JSON.stringify({id,operation,bytes:Array.from(bytes)});});window.__BITPOS_TEST_WALLET__={isBitPOSTestFixture:true,connect:async()=>({address:${JSON.stringify(address)}}),signMessage:bytes=>request('signMessage',bytes),signTransaction:bytes=>request('signTransaction',bytes)};})();`;
  document.head.append(script);script.remove();
 },address);
 return {fixture:true,address,orderId,executionWorld:'application main world; host keys never exposed'};
}
export async function processRequest(page,orderId){
 await page.waitForSelector('html[data-bitpos-fixture-request]',{timeout:25000});
 const request=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.bitposFixtureRequest));
 const result=sign(orderId,request.operation,request.bytes);
 await page.evaluate(response=>{delete document.documentElement.dataset.bitposFixtureRequest;const script=document.createElement('script');script.textContent='document.dispatchEvent(new CustomEvent("bitpos-fixture-result",{detail:'+JSON.stringify(JSON.stringify(response))+'}));';document.head.append(script);script.remove();},{id:request.id,result});
 return {operation:request.operation,fixedOrderId:orderId,hostPolicyVerified:true};
}
