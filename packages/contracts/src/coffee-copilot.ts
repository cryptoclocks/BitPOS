import {z} from 'zod';
export const coffeeItems=z.array(z.object({productId:z.string().uuid(),qty:z.number().int().min(1).max(100)}).strict()).min(1).max(50).refine(a=>new Set(a.map(i=>i.productId)).size===a.length);
export const coffeeCandidate=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('proposal'),items:coffeeItems,collection:z.enum(['table','counter'])}).strict(),
 z.object({kind:z.literal('clarification'),message:z.string().min(1).max(400)}).strict()
]);
const draftTuple=z.tuple([z.string().uuid(),z.array(z.object({productId:z.string().uuid(),qty:z.number().int().min(1).max(100)}).strict()).max(50),z.enum(['table','counter'])]);
export const coffeeDraftRevision=z.string().min(1).max(8192).refine(value=>{try{return draftTuple.safeParse(JSON.parse(value)).success;}catch{return false;}});
export const coffeeTextRequest=z.object({requestId:z.string().uuid(),draftRevision:coffeeDraftRevision,text:z.string().trim().min(1).max(2000)}).strict();
export const coffeeAudioRequest=z.object({requestId:z.string().uuid(),draftRevision:coffeeDraftRevision,mimeType:z.enum(['audio/webm','audio/webm;codecs=opus','audio/ogg','audio/ogg;codecs=opus','audio/mp4','audio/wav']),durationMs:z.number().int().min(1).max(20000),audio:z.string().min(4).max(2796204)}).strict();
export type CoffeeCandidate=z.infer<typeof coffeeCandidate>;
export type CoffeeResult=({kind:'proposal';items:z.infer<typeof coffeeItems>;collection:'table'|'counter';expiresAt:string}|{kind:'clarification';message:string}|{kind:'transcript';text:string}|{kind:'pending'}|{kind:'refused';code:string})&{requestId:string;draftRevision:string};
