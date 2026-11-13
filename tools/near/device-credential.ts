// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Copied from the PayPal edition (tools/near/device-credential.ts).
// Issues (rotates) the credential of one NEAR demo shop screen and writes the private device JSON that the firmware
// provisioning helper reads: {ws_url, merchant, terminal}. The Mini then connects to the NEAR edition API, whose
// CONFIG carries the NEAR pay origin, so its QR codes open the NEAR pay page.
// Uses the existing registry credential route (revokes the previous credential of that device).
//   node --import tsx tools/near/device-credential.ts ["Terminal Table 2"] [--simulated] > <private file>
// --simulated (for tools/near/sim-screen.ts) also renames the device to "<label> (simulated)" so the owner screens
// say it is not a physical screen; issuing without it (a real BitPOS Mini taking over) renames it back.
// The JSON contains a bearer token: it is only written to a redirected stdout (refused on a terminal) and never logged.
// Fixture DB locally; on OCI only inside the bitpos-near api container with BITPOS_NEAR_SEED_TARGET=oci.
import 'dotenv/config';
import {existsSync} from 'node:fs';

const SHOP='4e454152-4e45-4152-8e45-415200000001',OWNER='4e454152-4e45-4152-8e45-0000000000a1';
const args=process.argv.slice(2);const simulated=args.includes('--simulated');
const label=args.find(a=>a!=='--simulated')??'Terminal Table 2';const SIM=' (simulated)';
if(process.stdout.isTTY)throw Error('refusing to print a device token to a terminal; redirect stdout to a private file');
const db=new URL(process.env.DATABASE_URL??'');
const oci=process.env.BITPOS_NEAR_SEED_TARGET==='oci';
if(oci?!existsSync('/.dockerenv'):db.hostname!=='127.0.0.1'||db.port!=='55477')throw Error('fixture database locally, or inside the bitpos-near api container on OCI');
const origin=process.env.BITPOS_NEAR_DEVICE_ORIGIN??(oci?'wss://near-pos.cashlessthailand.com':'ws://127.0.0.1:3001');
if(!/^wss:\/\/[a-z0-9.-]+$/.test(origin)&&!(!oci&&origin==='ws://127.0.0.1:3001'))throw Error('device origin must be wss://<host>');
const {pool,tenant}=await import('../../apps/api/src/db');
const {registry}=await import('../../apps/api/src/registry');
try{
 const device=(await tenant(SHOP,d=>d.query('SELECT id FROM devices WHERE merchant_id=$1 AND label IN ($2,$3) AND revoked_at IS NULL',[SHOP,label,label+SIM]))).rows[0] as {id:string}|undefined;
 if(!device)throw Error(`no active device "${label}" in the NEAR demo shop (run seed-demo.ts shop first)`);
 const shown=simulated?label+SIM:label;await tenant(SHOP,d=>registry(d,SHOP,OWNER,'owner',`/api/devices/${device.id}`,'PATCH',{label:shown}));
 const issued=await tenant(SHOP,d=>registry(d,SHOP,OWNER,'owner',`/api/devices/${device.id}/credential`,'POST',{})) as {deviceId:string;deviceToken:string};
 // provision.py requires terminalId to equal the terminal; the firmware moves the token into the Authorization header.
 process.stdout.write(JSON.stringify({ws_url:`${origin}/api/device?terminalId=${issued.deviceId}&token=${issued.deviceToken}`,merchant:SHOP,terminal:issued.deviceId})+'\n');
 console.error(`issued a new credential for "${shown}" (${issued.deviceId}); previous credential revoked`);
}finally{await pool.end();}
