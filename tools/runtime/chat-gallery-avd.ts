import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile,unlink} from 'node:fs/promises';
import type {ReviewAvdScope} from './food-cancellation-review-avd-smoke';
const adb='/Users/cryptoclock/Library/Android/sdk/platform-tools/adb';
export async function galleryAdb(scope:ReviewAvdScope,args:string[]){
 const child=scope.track(spawn(adb,['-s','emulator-5554',...args],{stdio:['ignore','pipe','pipe']}));
 const chunks:Buffer[]=[];child.stdout.on('data',p=>chunks.push(p));
 assert.equal((await scope.wait(once(child,'exit')))[0],0);return Buffer.concat(chunks).toString();
}
export async function prepareGallery(scope:ReviewAvdScope,session:string,image:Buffer){
 const name='BitPOS-chat-'+session+'.jpg',local='/tmp/'+name,remote='/sdcard/Download/'+name;
 await writeFile(local,image);
 try{await galleryAdb(scope,['push',local,remote]);await galleryAdb(scope,['shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file://'+remote]);}finally{await unlink(local);}
 const timezone=(await galleryAdb(scope,['shell','getprop','persist.sys.timezone'])).trim();
 let row='';
 for(let n=0;n<12&&!row;n++){
  const result=await galleryAdb(scope,['shell','content','query','--uri','content://media/external/images/media','--projection','_display_name:datetaken:date_modified']);
  row=result.split('\n').find(line=>line.includes('_display_name='+name+','))??'';
  if(!row)await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(row,'Synthetic image must be indexed by exact filename');
 const taken=row.match(/datetaken=(\d+)/),modified=row.match(/date_modified=(\d+)/);
 const epoch=taken&&Number(taken[1])>0?Number(taken[1]):Number(modified?.[1])*1000;
 assert.ok(Number.isFinite(epoch));
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone||'UTC',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(new Date(epoch));
 const part=(type:string)=>parts.find(p=>p.type===type)?.value;
 const description=`Photo taken on ${part('month')} ${part('day')}, ${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
 return {name,remote,description};
}
export async function selectGallery(scope:ReviewAvdScope,name:string,description:string){
 const file='/data/local/tmp/bitpos-chat-picker.xml';
 try{
  for(let attempt=0;attempt<18;attempt++){
   await new Promise(resolve=>setTimeout(resolve,400));scope.signal.throwIfAborted();
   await galleryAdb(scope,['shell','uiautomator','dump',file]);
   const xml=await galleryAdb(scope,['shell','cat',file]);
   const nodes=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]);
   const named=nodes.find(n=>n.includes('text="'+name+'"')||n.includes('content-desc="'+name+'"'));
   const dated=nodes.filter(n=>n.includes('content-desc="'+description+'"'));
   if(!named)assert.ok(dated.length<=1,'Ambiguous timestamp; refuse to select a different image');
   const target=named??dated[0];
   const navigation=nodes.find(n=>/text="(Browse|Browse…|Browse\.\.\.|Files)"/.test(n))??nodes.find(n=>n.includes('content-desc="More options"'));
   const node=target??navigation;
   if(node){const bounds=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);if(bounds){await galleryAdb(scope,['shell','input','tap',String(Math.floor((Number(bounds[1])+Number(bounds[3]))/2)),String(Math.floor((Number(bounds[2])+Number(bounds[4]))/2))]);if(target){
      for(let confirm=0;confirm<6;confirm++){
       await new Promise(resolve=>setTimeout(resolve,250));
       await galleryAdb(scope,['shell','uiautomator','dump',file]);
       const selectedXml=await galleryAdb(scope,['shell','cat',file]);
       const selectedNodes=[...selectedXml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]);
       if(!selectedNodes.some(n=>n.includes('Selected '+description)))return;
       const done=selectedNodes.find(n=>n.includes('text="Done"'));
       if(done){const box=done.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);assert.ok(box);await galleryAdb(scope,['shell','input','tap',String(Math.floor((Number(box[1])+Number(box[3]))/2)),String(Math.floor((Number(box[2])+Number(box[4]))/2))]);return;}
      }
      throw Error('Synthetic image selected but picker confirmation not found');
     }}}
   if(attempt===17)throw Error('Exact synthetic gallery filename not found; observed labels: '+nodes.map(n=>n.match(/text="([^"]*)"/)?.[1]).filter(Boolean).join(',').slice(0,1000));
  }
 }finally{await galleryAdb(scope,['shell','rm','-f',file]).catch(()=>{});}
}
