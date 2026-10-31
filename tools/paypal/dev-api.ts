// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Local PayPal preview API: the normal BitPOS API server on 127.0.0.1:3061 (3001 may belong to another checkout),
// with the PayPal Sandbox credentials loaded from the private env file. Local fixture database only.
//   pnpm exec tsx tools/paypal/dev-api.ts
import 'dotenv/config';
import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const db=new URL(process.env.DATABASE_URL??'');
if(db.hostname!=='127.0.0.1'||db.port!=='55466')throw Error('dev-api only runs against the local PayPal fixture database (127.0.0.1:55466)');
for(const line of readFileSync(process.env.PAYPAL_ENV_FILE??join(homedir(),'.bitpos-paypal/paypal-sandbox.env'),'utf8').split('\n')){
 const m=line.match(/^(PAYPAL_[A-Z_]+)=(.*)$/);if(m&&m[2].trim())process.env[m[1]]=m[2].trim();
}
// Optional Gemini key for Café Copilot (private file; without it Copilot reports "AI not configured" and the form still works).
if(existsSync(join(homedir(),'.bitpos-paypal/gemini.env')))for(const line of readFileSync(join(homedir(),'.bitpos-paypal/gemini.env'),'utf8').split('\n')){const m=line.match(/^(BITPOS_AI_[A-Z_]+)=(.*)$/);if(m&&m[2].trim())process.env[m[1]]=m[2].trim();}
const port=Number(process.env.BITPOS_PAYPAL_DEV_API_PORT??3061);
const {server}=await import('../../apps/api/src/index');
server.listen(port,'127.0.0.1',()=>console.log(`BitPOS API (PayPal preview) on http://127.0.0.1:${port}`));
