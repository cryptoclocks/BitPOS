// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Adapted from the PayPal edition's dev tool.
// Local NEAR preview API: the normal BitPOS API server on 127.0.0.1:3001 with the NEAR testnet settings from .env,
// plus the NEAR reconcile lane in this process (the full worker is not needed for the preview). Fixture database only.
//   pnpm exec tsx tools/near/dev-api.ts
import 'dotenv/config';

const db=new URL(process.env.DATABASE_URL??'');
if(db.hostname!=='127.0.0.1'||db.port!=='55477')throw Error('dev-api only runs against the local NEAR fixture database (127.0.0.1:55477)');
process.env.BITPOS_DEMO_SHOP??='near';
const port=Number(process.env.BITPOS_NEAR_DEV_API_PORT??3001);
const {server}=await import('../../apps/api/src/index');
const {nearDeps}=await import('../../apps/api/src/near/bills');
const {tickNear}=await import('../../apps/api/src/near/reconcile');
const deps=nearDeps();
if(!deps)console.error('NEAR is not configured (see near-hackathon/local.env.example): the NEAR tab and pay page will say so');
let busy=false;
if(deps)setInterval(async()=>{if(busy)return;busy=true;try{await tickNear(deps);}catch(error){console.error('NEAR reconcile unavailable; durable state retained',(error as Error).message);}finally{busy=false;}},2000);
server.listen(port,'127.0.0.1',()=>console.log(`BitPOS API (NEAR preview) on http://127.0.0.1:${port}${deps?` · contract ${deps.config.billsContract}`:''}`));
