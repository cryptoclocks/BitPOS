// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Issues (rotates) the credential of one PayPal demo shop screen and writes the private device JSON that the firmware
// provisioning helper reads: {ws_url, merchant, terminal}. The Mini then connects to the PayPal edition API, whose
// CONFIG carries the PayPal pay origin, so its QR codes open the PayPal pay page.
// Uses the existing registry credential route (revokes the previous credential of that device).
//   node --import tsx tools/paypal/device-credential.ts ["Terminal Table 2"] > <private file>
// The JSON contains a bearer token: it is only written to a redirected stdout (refused on a terminal) and never logged.
// Fixture DB locally; on OCI only inside the bitpos-paypal api container with BITPOS_PAYPAL_SEED_TARGET=oci.
import 'dotenv/config';
import {existsSync} from 'node:fs';

const SHOP='70707070-7070-4070-8070-707070707070',OWNER='70707070-7070-4070-8070-0000000000a1';
const label=process.argv[2]??'Terminal Table 2';
if(process.stdout.isTTY)throw Error('refusing to print a device token to a terminal; redirect stdout to a private file');
const db=new URL(process.env.DATABASE_URL??'');
const oci=process.env.BITPOS_PAYPAL_SEED_TARGET==='oci';
if(oci?!existsSync('/.dockerenv'):db.hostname!=='127.0.0.1'||db.port!=='55466')throw Error('fixture database locally, or inside the bitpos-paypal api container on OCI');
const origin=process.env.BITPOS_PAYPAL_DEVICE_ORIGIN??(oci?'wss://paypal-pos.cashlessthailand.com':'ws://127.0.0.1:3061');
if(!/^wss:\/\/[a-z0-9.-]+$/.test(origin)&&!(!oci&&origin==='ws://127.0.0.1:3061'))throw Error('device origin must be wss://<host>');
const {pool,tenant}=await import('../../apps/api/src/db');
const {registry}=await import('../../apps/api/src/registry');
try{
 const device=(await tenant(SHOP,d=>d.query('SELECT id FROM devices WHERE merchant_id=$1 AND label=$2 AND revoked_at IS NULL',[SHOP,label]))).rows[0] as {id:string}|undefined;
 if(!device)throw Error(`no active device "${label}" in the PayPal demo shop (run seed-demo.ts shop first)`);
 const issued=await tenant(SHOP,d=>registry(d,SHOP,OWNER,'owner',`/api/devices/${device.id}/credential`,'POST',{})) as {deviceId:string;deviceToken:string};
 // provision.py requires terminalId to equal the terminal; the firmware moves the token into the Authorization header.
 process.stdout.write(JSON.stringify({ws_url:`${origin}/api/device?terminalId=${issued.deviceId}&token=${issued.deviceToken}`,merchant:SHOP,terminal:issued.deviceId})+'\n');
 console.error(`issued a new credential for "${label}" (${issued.deviceId}); previous credential revoked`);
}finally{await pool.end();}
