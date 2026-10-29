import {z} from 'zod';
const version=z.string().regex(/^(0|[1-9][0-9]{0,18})$/).refine(v=>BigInt(v)<=9223372036854775807n);
const item=z.object({shipmentId:z.string().uuid(),version:version.refine(v=>v!=='0'),generation:version}).strict();
export const FoodBatchCandidatesSchema=z.object({
 items:z.array(item).max(3),
 snapshotAt:z.string().datetime({offset:true}),assignmentCreated:z.literal(false),
}).strict().refine(v=>new Set(v.items.map(item=>item.shipmentId)).size===v.items.length);
export type FoodBatchCandidates=z.infer<typeof FoodBatchCandidatesSchema>;
const draftItems=z.array(item).min(2).max(3).refine(items=>new Set(items.map(value=>value.shipmentId)).size===items.length);
export const FoodBatchDraftCommandSchema=z.object({idempotencyKey:z.string().uuid(),driverId:z.string().uuid(),items:draftItems}).strict();
export const FoodBatchDraftReceiptSchema=z.object({batchId:z.string().uuid(),state:z.literal('DRAFT'),version:z.literal('1'),assignmentCreated:z.literal(false),items:draftItems}).strict();
