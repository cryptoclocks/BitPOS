// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Adapted from the PayPal edition (tools/paypal/server.ts).
// Hosted entry point of the NEAR edition API (infra/near/compose.yaml): the normal BitPOS API server on
// 127.0.0.1:${BITPOS_NEAR_API_PORT} (3106 on OCI) plus the NEAR reconcile lane in the same process (the shared
// bitpos-runtime worker runs older code without NEAR). Refuses to start unless NEAR is configured for testnet.
import {nearConfig} from '../../apps/api/src/near/config';

const port=Number(process.env.BITPOS_NEAR_API_PORT??3106);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('BITPOS_NEAR_API_PORT must be a port number');
const cfg=nearConfig();// throws MAINNET_REFUSED / CONFIGURATION_REQUIRED
if(!process.env.BITPOS_CUSTOMER_PUBLIC_URL)throw Error('BITPOS_CUSTOMER_PUBLIC_URL (the customer pay origin) is required');
const {server}=await import('../../apps/api/src/index');
const {nearDeps}=await import('../../apps/api/src/near/bills');
const {tickNear}=await import('../../apps/api/src/near/reconcile');
const deps=nearDeps();if(!deps)throw Error('NEAR dependencies did not start');
let busy=false;
setInterval(async()=>{if(busy)return;busy=true;try{await tickNear(deps);}catch(error){console.error('NEAR reconcile unavailable; durable state retained',(error as Error).message);}finally{busy=false;}},2000);
server.listen(port,'127.0.0.1',()=>console.log(`BitPOS API (NEAR testnet edition) on 127.0.0.1:${port} · contract ${cfg.billsContract} · agent ${cfg.agentAccount??'off'}`));
