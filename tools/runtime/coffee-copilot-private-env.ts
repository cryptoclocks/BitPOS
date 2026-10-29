import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {z} from 'zod';
import {config} from '../../apps/api/src/config';
const root=fs.realpathSync(process.cwd()),privateRoot=fs.realpathSync(config.DEVNET_PRIVATE_DIR);
if(privateRoot===root||privateRoot.startsWith(root+path.sep))throw Error('Private proof config must remain outside repository');
const result=spawnSync('ssh',['-o','BatchMode=yes','-i',process.env.BITPOS_OCI_SSH_KEY??'',process.env.BITPOS_OCI_SSH_TARGET??'','cat /home/ubuntu/bitpos-private/proof/coffee-provider-env.json'],{encoding:'utf8',timeout:30000,maxBuffer:16384});
if(result.status!==0)throw Error('Existing private provider export unavailable; credentials withheld');
let provider:Record<string,string>;
try{provider=z.object({BITPOS_AI_PROVIDER_URL:z.string().url().refine(value=>{const u=new URL(value);return u.origin==='https://generativelanguage.googleapis.com'&&!u.username&&!u.password&&!u.search&&!u.hash;}),BITPOS_AI_MODEL:z.string().regex(/^gemini-[a-z0-9.-]+$/),BITPOS_AI_API_KEY:z.string().min(1).max(2048),BITPOS_AI_FALLBACK_API_KEY:z.string().min(1).max(2048).optional()}).strict().parse(JSON.parse(result.stdout));}catch{throw Error('Existing Free provider configuration invalid; credentials withheld');}
const directory=path.join(privateRoot,'proof');fs.mkdirSync(directory,{recursive:true,mode:0o700});if(fs.lstatSync(directory).isSymbolicLink()||(fs.statSync(directory).mode&0o777)!==0o700||fs.realpathSync(directory)!==directory)throw Error('Unsafe private proof directory');
const file=path.join(directory,'coffee-provider.env');if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Private proof config cannot be a symlink');
const keys=['DATABASE_URL','ADMIN_DATABASE_URL','AUTH_URL','AUTH_ANON_KEY','APP_SECRET','PUBLIC_URL','SOLANA_RPC','DEVNET_PRIVATE_DIR','BITPOS_CUSTOMER_PUBLIC_URL','BITPOS_DEMO_QUICK_SIGNIN'];
const values=Object.fromEntries(keys.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!]));
const body=Object.entries({...values,...provider}).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n';
const temp=file+'.next',fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);fs.chmodSync(file,0o600);
console.log(JSON.stringify({result:'private_existing_Free_provider_ready',provider:'Gemini',model:provider.BITPOS_AI_MODEL,keyConfigured:true,privateConfig:file,mode:'600',providerCalls:0,secretValuesPrinted:false}));
