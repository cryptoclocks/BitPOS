// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Prints the table-screen URL for a tag (/meta/screen/<tagId>?k=<key>), to open on a tablet or phone at the table.
// Usage: npx tsx tools/meta/screen-url.ts <env-file> <tagId>
// Reads META_TAP_MASTER_KEY and META_PUBLIC_URL from the env file (outside the repo). The key only opens that
// table's screen; it cannot mint taps.
import {readFileSync} from 'node:fs';
import {screenKey} from '../../apps/api/src/meta/screen';

const [envFile,tagId]=process.argv.slice(2);
if(!envFile||!tagId||!/^[A-Za-z0-9_-]{4,64}$/.test(tagId))throw Error('usage: screen-url.ts <env-file> <tagId>');
const env:Record<string,string>={};
for(const line of readFileSync(envFile,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
if(!/^[0-9a-fA-F]{32}$/.test(env.META_TAP_MASTER_KEY??''))throw Error('META_TAP_MASTER_KEY is required');
console.log(`${new URL(env.META_PUBLIC_URL).origin}/meta/screen/${tagId}?k=${screenKey(Buffer.from(env.META_TAP_MASTER_KEY,'hex'),tagId)}`);
