// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Prints the BitPOS Mini Meta device key for one device (derived from META_TAP_MASTER_KEY). Pipe it straight into
// tools/meta/provision-mini.py; do not store or paste it. Usage: npx tsx tools/meta/device-key.ts <env-file> <device-id>
import {readFileSync} from 'node:fs';
import {deviceKey} from '../../apps/api/src/meta/device';

const [envFile,device]=process.argv.slice(2);
if(!envFile||!device||!/^[0-9a-f-]{36}$/.test(device))throw Error('usage: device-key.ts <env-file> <device-id>');
const env:Record<string,string>={};
for(const line of readFileSync(envFile,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
if(!/^[0-9a-fA-F]{32}$/.test(env.META_TAP_MASTER_KEY??''))throw Error('META_TAP_MASTER_KEY is required');
process.stdout.write(deviceKey(Buffer.from(env.META_TAP_MASTER_KEY,'hex'),device)+'\n');
