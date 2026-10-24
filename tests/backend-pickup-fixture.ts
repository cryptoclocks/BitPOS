import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {tableFixture,success} from './backend-table-fixture';

type PublicRequest=(path:string,method:string,input?:unknown)=>Promise<unknown>;
export async function publicPickupFixture(transport?:PublicRequest){
 const f=await tableFixture();
 // Intentional opt-in test loading boundary: importing backend modules statically
 // would require private runtime config even when database tests are skipped.
 const {tableRequest}=await import('../apps/api/src/table-ordering');
 const api=await import('../apps/api/src/fulfillment');
 const request=transport??tableRequest;
 const entry=(await f.tenant(f.merchant,db=>db.query('SELECT e.* FROM table_entries e JOIN devices d ON d.merchant_id=e.merchant_id AND d.id=e.device_id AND d.assignment_generation=e.assignment_generation AND d.auth_generation=e.auth_generation WHERE d.id=$1',[f.b.id]))).rows[0];
 assert.ok(entry);
 const base='/api/table/'+entry.entry_token;
 const visitSchema=z.object({visitToken:z.string()}).passthrough();
 const visit=async()=>{const v=visitSchema.parse(await request(base+'/visit','POST',{requestId:randomUUID()}));return {token:v.visitToken,path:base+'/visit/'+v.visitToken};};
 const original=await visit();
 const q=z.object({quote:z.object({id:z.string(),priceVersion:z.string()}).passthrough()}).passthrough().parse(await request(original.path+'/quotes','POST',{items:[{productId:f.product,qty:1}]}));
 const {order}=z.object({order:z.object({id:z.string()}).passthrough()}).passthrough().parse(await request(original.path+'/orders','POST',{quoteId:q.quote.id,priceVersion:q.quote.priceVersion,idempotencyKey:randomUUID()}));
 // Synthetic PAID state only; no verifier, settlement, chain or physical claim.
 // Keep the actual public order, immutable quote/guest and ended session. Emit and
 // ACK its synthetic paid receipt so the real public dismiss boundary runs.
 const {emitOrder}=await import('../apps/api/src/orders');
 const paid=await f.tenant(f.merchant,async db=>{const row=(await db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1 RETURNING *",[order.id])).rows[0];await emitOrder(db,row);return (await db.query('SELECT * FROM outbox_events WHERE order_id=$1 AND order_version=$2 ORDER BY device_seq DESC LIMIT 1',[order.id,row.version])).rows[0];});
 async function delivery(e:{id:string;device_seq:string}){await f.tenant(f.merchant,db=>db.query('INSERT INTO device_event_deliveries(merchant_id,device_id,event_id,device_seq,connection_generation) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[f.merchant,f.b.id,e.id,e.device_seq,f.devices.get(f.b.id)!.connectionGeneration]));}
 const ack=(e:{id:string;device_seq:string;screen_generation:string},orderId:string|null=null,orderVersion:number|null=null)=>({type:'ACK',eventId:e.id,deviceSeq:String(e.device_seq),orderId,orderVersion,screenGeneration:String(e.screen_generation),rendered:true});
 await delivery(paid);success(await f.command(f.b.id,ack(paid,order.id,paid.order_version)));
 await request(original.path+'/dismiss','POST',{});
 const originalBinding=(await f.tenant(f.merchant,db=>db.query('SELECT v.id,v.created_at,s.id AS session_id,s.ended_at,s.pickup_guest_generation::text FROM table_visits v JOIN device_sessions s ON s.merchant_id=v.merchant_id AND s.id=v.session_id WHERE v.order_id=$1',[order.id]))).rows[0];
 assert.ok(originalBinding.ended_at,'the public order really ended its acquired session');
 const kitchen=(status:string,version:number)=>f.tenant(f.merchant,db=>api.fulfillmentRequest(db,f.merchant,f.actor,'staff',order.id,false,{status,expectedVersion:version,idempotencyKey:randomUUID()}));
 const retry=(version=2,key=randomUUID())=>f.tenant(f.merchant,db=>api.fulfillmentRequest(db,f.merchant,f.actor,'staff',order.id,true,{expectedVersion:version,idempotencyKey:key,targetDeviceId:f.b.id,assignmentGeneration:'1',confirmTarget:true}));
 const reconcile=()=>f.tenant(f.merchant,db=>api.reconcilePickup(db,f.merchant,f.b.id,f.devices.get(f.b.id)!.connectionGeneration));
 const notice=async()=>(await f.tenant(f.merchant,db=>db.query('SELECT * FROM pickup_notifications WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[order.id]))).rows[0];
 const event=async(id?:string)=>(await f.tenant(f.merchant,db=>db.query('SELECT e.* FROM outbox_events e WHERE e.id=coalesce($2::uuid,(SELECT last_event_id FROM pickup_notifications WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1))',[order.id,id??null]))).rows[0];
 const validate=(eventId:string)=>f.tenant(f.merchant,async db=>{const a=f.devices.get(f.b.id)!;return (await db.query('SELECT bitpos.device_validate_send($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::uuid) AS checked',[a.merchant,a.device,a.tokenHash,a.authGeneration,a.connectionGeneration,a.connectionId,eventId])).rows[0].checked;});
 const financial=()=>f.tenant(f.merchant,async db=>(await db.query(`SELECT to_jsonb(o) AS bill,to_jsonb(a) AS authority,to_jsonb(q) AS quote,to_jsonb(c) AS customer,
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY product_id) FROM order_items i WHERE i.order_id=o.id) AS items,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payments p WHERE p.order_id=o.id) AS payments,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payment_attempts p WHERE p.order_id=o.id) AS attempts,
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY device_seq) FROM outbox_events e WHERE e.order_id=o.id) AS financial_events,
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY effect_id) FROM device_sound_effects e WHERE e.order_id=o.id) AS financial_effects,
 (SELECT jsonb_build_object('stock',stock,'reserved',reserved) FROM products WHERE id=$2) AS stock
 FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id JOIN customers c ON c.merchant_id=o.merchant_id AND c.id=o.customer_id WHERE o.id=$1`,[order.id,f.product])).rows[0]);
 const fulfillment=()=>f.tenant(f.merchant,async db=>(await api.fulfillmentViews(db,f.merchant,[order.id])).get(order.id)!);
 return {...f,base,entry,order,original,originalBinding,visit,request,api,kitchen,retry,reconcile,notice,event,delivery,ack,validate,financial,fulfillment};
}
