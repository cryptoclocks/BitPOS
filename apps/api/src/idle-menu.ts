import {readFileSync} from 'node:fs';
import {z} from 'zod';

const manifestSchema=z.object({schemaVersion:z.literal(1),version:z.literal('bitpos-menu-v1'),width:z.literal(480),height:z.literal(200),pixelFormat:z.literal('RGB565_LE'),sdRoot:z.literal('/sdcard/bitpos/menu/v1'),maxPhotos:z.literal(12),assets:z.array(z.object({catalogKey:z.string().min(1).max(95),file:z.string().regex(/^[a-z0-9-]+\.rgb565$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.literal(192000)})).length(12)});
export type MenuAssetManifest=z.infer<typeof manifestSchema>;
let loadedManifest:MenuAssetManifest|null|undefined;
export function menuAssetManifest():MenuAssetManifest|null {
 if(loadedManifest!==undefined)return loadedManifest;
 try{
 const manifest=manifestSchema.parse(JSON.parse(readFileSync(new URL('../../../data/menu-assets.json',import.meta.url),'utf8')));
 if(new Set(manifest.assets.map(a=>a.catalogKey)).size!==12||new Set(manifest.assets.map(a=>a.file)).size!==12)throw Error('Duplicate menu asset');
 loadedManifest=manifest;
 }catch{loadedManifest=null;}
 return loadedManifest;
}
