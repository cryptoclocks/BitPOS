// Meta hackathon work (2026-10-26..11-05). See meta-hackathon/PROVENANCE.md.
// Prints the unchanging link to write on a plain NFC card (/meta/s/<tagId>?k=<key>).
// Usage: npx tsx tools/meta/static-tap-url.ts <env-file> <tagId>
// Reads META_TAP_MASTER_KEY and META_PUBLIC_URL from the env file (outside the repo). The link can be copied: it does not prove presence.
import {readFileSync} from 'node:fs';
import {staticTapKey} from '../../apps/api/src/meta/identity';

const [envFile,tagId]=process.argv.slice(2);
if(!envFile||!tagId||!/^[A-Za-z0-9_-]{4,64}$/.test(tagId))throw Error('usage: static-tap-url.ts <env-file> <tagId>');
const env:Record<string,string>={};
for(const line of readFileSync(envFile,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
if(!/^[0-9a-fA-F]{32}$/.test(env.META_TAP_MASTER_KEY??''))throw Error('META_TAP_MASTER_KEY is required');
console.log(`${new URL(env.META_PUBLIC_URL).origin}/meta/s/${tagId}?k=${staticTapKey(Buffer.from(env.META_TAP_MASTER_KEY,'hex'),tagId)}`);
