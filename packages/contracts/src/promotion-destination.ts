import {z} from 'zod';
const generation=z.string().regex(/^[1-9][0-9]*$/).max(19).refine(v=>BigInt(v)<=9223372036854775807n);
export const promotionDestination=z.object({deviceId:z.string().uuid(),tableId:z.string().uuid(),assignmentGeneration:generation,authGeneration:generation}).strict();
export type PromotionDestination=z.infer<typeof promotionDestination>;
