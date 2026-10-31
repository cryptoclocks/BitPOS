// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Hosted entry point of the PayPal edition API (infra/paypal/compose.yaml): the normal BitPOS API server, bound to
// 127.0.0.1:${BITPOS_PAYPAL_API_PORT} (3103 on OCI). Refuses to start unless PayPal is configured for the Sandbox,
// so a missing or live configuration never silently serves a PayPal shop without PayPal.
import {paypalConfig} from '../../apps/api/src/paypal/config';

const port=Number(process.env.BITPOS_PAYPAL_API_PORT??3103);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('BITPOS_PAYPAL_API_PORT must be a port number');
const cfg=paypalConfig();// throws LIVE_MODE_REFUSED / CONFIGURATION_REQUIRED
if(!process.env.BITPOS_CUSTOMER_PUBLIC_URL)throw Error('BITPOS_CUSTOMER_PUBLIC_URL (the customer pay origin) is required');
const {server}=await import('../../apps/api/src/index');
server.listen(port,'127.0.0.1',()=>console.log(`BitPOS API (PayPal Sandbox edition) on 127.0.0.1:${port} · webhook ${cfg.webhookId?'configured':'not configured'}`));
