// One bounded worker process for local restart/no-driver acceptance only.
import {createFoodSearchWorker} from '../../../apps/worker/src/food-search';
const target=new URL(process.env.BITPOS_W02_WORKER_URL??'');
if(target.hostname!=='127.0.0.1'||!((target.port==='55446'&&target.pathname==='/bitpos_w01_fixture')||(target.port==='55440'&&target.pathname==='/bitpos_delivery_fixture'))||!/^bitpos_w02_worker_[0-9]+$/.test(target.username))throw Error('Only W02 restricted fixture worker allowed');
let providerCalls=0;
const unavailable=process.argv.includes('--unavailable');
const worker=createFoodSearchWorker(target.href,unavailable?{kind:'unavailable',reason:'unconfigured'}:{kind:'valhalla',origin:new URL('http://127.0.0.1:3998'),fixture:true,attribution:'No-candidate fixture; provider must not be contacted'},{fetch:async()=>{providerCalls++;throw Error('Unexpected provider request with no candidates');}});
if(!worker)throw Error('Worker missing');
try{await worker.tick();if(providerCalls!==0)throw Error('Unexpected provider call');console.log('PASS_RESTRICTED_WORKER_PROCESS_TICK_NO_PROVIDER');}finally{await worker.close();}
