// Meta hackathon work (2026-10-26..11-04).
// Development stand-in for an NTAG424 DNA sticker until stickers are provisioned: prints one fresh SUN tap URL
// (/meta/t/:tagId?e&m) for a registered tag, computed exactly as the chip would with the derived per-tag keys.
// Usage: npx tsx tools/meta/sim-tap.ts <env-file> <tagId> [<uid-hex> <last-counter>]
// Reads META_TAP_MASTER_KEY, META_PUBLIC_URL and META_DB_URL from the env file (outside the repo).
// Pass the UID and last counter when META_DB_URL is the RLS-bound application role (OCI), which cannot read tags.
// Anyone holding the master key can mint taps, so this proves nothing physical; label demo runs that use it.
import {createCipheriv} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {aesCmac,deriveTagKeys} from '../../packages/meta-ai/src/ntag424';

const [envFile,tagId,uidArg,counterArg]=process.argv.slice(2);
if(!envFile||!tagId)throw Error('usage: sim-tap.ts <env-file> <tagId> [<uid-hex> <last-counter>]');
const env:Record<string,string>={};
for(const line of readFileSync(envFile,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}

let tag:{uid:string;last_counter:number}|undefined;
if(uidArg&&counterArg)tag={uid:uidArg,last_counter:Number(counterArg)};
else{
 const db=new pg.Client({connectionString:env.META_DB_URL});
 await db.connect();
 tag=(await db.query<{uid:string;last_counter:number}>('SELECT uid,last_counter FROM bitpos.meta_ntag_tags WHERE tag_id=$1',[tagId])).rows[0];
 await db.end();
}
if(!tag||!/^[0-9A-F]{14}$/.test(tag.uid)||!Number.isInteger(tag.last_counter))throw Error(`tag ${tagId} is not registered`);

const counter=Number(tag.last_counter)+1,keys=deriveTagKeys(Buffer.from(env.META_TAP_MASTER_KEY,'hex'),tagId);
const uid=Buffer.from(tag.uid,'hex'),ctr=Buffer.from([counter&0xff,(counter>>8)&0xff,(counter>>16)&0xff]);
const c=createCipheriv('aes-128-cbc',keys.metaReadKey,Buffer.alloc(16));c.setAutoPadding(false);
const e=Buffer.concat([c.update(Buffer.concat([Buffer.from([0xc7]),uid,ctr,Buffer.alloc(5,0x11)])),c.final()]).toString('hex').toUpperCase();
const full=aesCmac(aesCmac(keys.fileReadKey,Buffer.concat([Buffer.from('3cc300010080','hex'),uid,ctr])),Buffer.alloc(0));
const m=Buffer.from([1,3,5,7,9,11,13,15].map(i=>full[i])).toString('hex').toUpperCase();
console.log(`${env.META_PUBLIC_URL.replace(/\/$/,'')}/meta/t/${encodeURIComponent(tagId)}?e=${e}&m=${m}`);
