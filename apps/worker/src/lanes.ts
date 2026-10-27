import {setTimeout as delay} from 'node:timers/promises';
export interface WorkerLane {tick:()=>Promise<void>;unavailable:string;}
/** One awaited tick per lane: slow external IO cannot queue overlapping ticks. */
export async function runWorkerLanes(lanes:readonly WorkerLane[],signal:AbortSignal){
 await Promise.all(lanes.map(async lane=>{
  while(!signal.aborted){
   try{await lane.tick();}catch{console.error(lane.unavailable);}
   if(signal.aborted)break;
   try{await delay(750,undefined,{signal});}catch(error){if(!signal.aborted)throw error;}
  }
 }));
 // All active ticks have drained before the owner closes the shared database pool.
}
