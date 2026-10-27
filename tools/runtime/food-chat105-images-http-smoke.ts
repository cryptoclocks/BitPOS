import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type pg from 'pg';
import sharp from 'sharp';
import {FoodChatMessageSchema,FoodChatPageSchema,FoodChatUploadSchema} from '../../packages/contracts/src/mobile-v1.generated';
type Actor={account:string;access:string};
type Context={db:pg.Client;base:string;assignmentId:string;customer:Actor;driverActor:Actor;outsider:Actor};
export async function verifyChat105ImagesHttp(c:Context){
 const base=c.base+'/api/mobile/v1/food/assignments/'+c.assignmentId+'/chat';
 async function request(actor:Actor,path:string,body?:unknown,status=200){
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+actor.access,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;
 }
 async function upload(color:string){
  const source=await sharp({create:{width:24,height:16,channels:3,background:color}}).jpeg().toBuffer();
  const response=await fetch(base+'/images',{method:'POST',headers:{Authorization:'Bearer '+c.customer.access,'Idempotency-Key':randomUUID(),'Content-Type':'image/jpeg'},body:new Uint8Array(source),signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200);return FoodChatUploadSchema.parse(await response.json());
 }
 async function bytes(actor:Actor,id:string,status=200){
  const response=await fetch(base+'/images/'+id,{headers:{Authorization:'Bearer '+actor.access},signal:AbortSignal.timeout(10000)});assert.equal(response.status,status);return Buffer.from(await response.arrayBuffer());
 }
 const photo=await upload('#64188a');await bytes(c.driverActor,photo.id,404);
 const command={commandId:randomUUID(),body:'',attachmentIds:[photo.id]};
 const sent=FoodChatMessageSchema.parse(await request(c.customer,'',command));
 assert.equal(sent.body,'');assert.equal(sent.attachments[0].id,photo.id);
 for(let i=0;i<12;i++){const replay=FoodChatMessageSchema.parse(await request(c.customer,'',command));assert.equal(replay.id,sent.id);}
 assert.equal(createHash('sha256').update(await bytes(c.driverActor,photo.id)).digest('hex'),photo.sha256);
 await bytes(c.outsider,photo.id,404);
 const page=FoodChatPageSchema.parse(await request(c.driverActor,'?afterSequence=0'));
 assert.equal(page.items.find(row=>row.id===sent.id)?.attachments[0].id,photo.id);
 await request(c.customer,'',{...command,body:'changed'},409);
 await request(c.customer,'',{...command,commandId:randomUUID()},409);
 await request(c.driverActor,'',{commandId:randomUUID(),body:'',attachmentIds:[photo.id]},404);
 const photos=[];for(const color of ['#ff8500','#ffffff','#29183f','#efe6f8'])photos.push(await upload(color));
 const caption={commandId:randomUUID(),body:'Four ordered fixture images',attachmentIds:photos.map(p=>p.id)};
 const ordered=FoodChatMessageSchema.parse(await request(c.customer,'',caption));assert.deepEqual(ordered.attachments.map(p=>p.id),caption.attachmentIds);
 await request(c.customer,'',{...caption,attachmentIds:[...caption.attachmentIds].reverse()},409);
 await request(c.customer,'',{commandId:randomUUID(),body:'',attachmentIds:[]},422);
 const unbound=await upload('#d0b0ea');
 await c.db.query("UPDATE bitpos.food_chat104_uploads SET expires_at=clock_timestamp()-interval '1 second' WHERE assignment_id=$1",[c.assignmentId]);
 const expiredCommand={commandId:randomUUID(),body:'Unsent expired fixture',attachmentIds:[unbound.id]};
 const expiredError=await request(c.customer,'',expiredCommand,410);assert.equal(expiredError.error.code,'CHAT_IMAGE_EXPIRED');
 assert.equal((await c.db.query('SELECT count(*)::int n FROM bitpos.food_chat102_messages WHERE assignment_id=$1 AND command_id=$2',[c.assignmentId,expiredCommand.commandId])).rows[0].n,0);
 await c.db.query('SELECT bitpos.food_chat104_dispose_expired(100)');
 assert.equal(createHash('sha256').update(await bytes(c.driverActor,photo.id)).digest('hex'),photo.sha256);
 assert.equal((await c.db.query('SELECT count(*)::int n FROM bitpos.food_chat105_attachments a JOIN bitpos.food_chat102_messages m ON m.id=a.message_id WHERE m.assignment_id=$1',[c.assignmentId])).rows[0].n,5);
 const replay=FoodChatMessageSchema.parse(await request(c.customer,'',command));assert.equal(replay.id,sent.id);
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/food-chat105-images-actual-http-20261020.json',JSON.stringify({status:'PASS_ACTUAL_HTTP_IMAGE_MESSAGE_BINDING',checks:['Photo-only message, twelve exact retries one persisted message/link','Counterpart cannot read unpublished bytes; authorized linked bytes match digest; stranger refused','Current page carries attachment metadata; changed/reused/foreign/empty commands refused','Four-image caption preserves attachment order; changed order conflicts','Explicit expired unbound send410 leaves no message; expiry worker preserves linked bytes and committed replay after upload lease expires'],limits:['Synthetic generated images and canonical disposable local fixture; no actual-use migration','No current native picker/gallery/recipient rendering or whole UI pixel acceptance','No physical device, antivirus, retention/backup erasure or deployment claim']},null,2)+'\n');
 console.log('PASS_ACTUAL_HTTP_IMAGE_MESSAGE_BINDING');
}
