import type http from 'node:http';
import fs from 'node:fs';
import {z} from 'zod';
import {config,MERCHANT_A} from './config';
import {pool} from './db';
import {hash} from '../../../packages/domain/src/index';
import {fail} from './authority';
export const demoRoles=['owner','manager','staff'] as const;
export type DemoRole=typeof demoRoles[number];
export function allowedDemoOrigins(){
 const origins=[config.PUBLIC_URL,'http://localhost:4321','http://127.0.0.1:4321'];
 // Explicitly authorized public devnet demo; no arbitrary Origin or merchant input.
 if(process.env.BITPOS_DEMO_PUBLIC_ORIGIN==='https://pos.cashlessthailand.com')origins.push('https://pos.cashlessthailand.com');
 return origins;
}
export function demoAccessEnabled(){
 const url=new URL(config.PUBLIC_URL);const h=url.hostname;
 const privateHost=h==='localhost'||h==='127.0.0.1'||h==='[::1]'||/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)||/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)||/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h);
 const localOrigin=url.protocol==='http:'&&url.port==='4321'&&privateHost;
 const authorizedPublicDevnet=url.origin==='https://pos.cashlessthailand.com'&&process.env.BITPOS_DEMO_PUBLIC_ORIGIN===url.origin;
 return config.BITPOS_DEMO_QUICK_SIGNIN==='1'&&process.env.NODE_ENV!=='production'&&(localOrigin||authorizedPublicDevnet);
}
export async function demoCredentials(req:http.IncomingMessage,input:unknown){
 if(!demoAccessEnabled())fail('RESOURCE_NOT_FOUND',404);
 const role=z.object({role:z.enum(demoRoles)}).strict().parse(input).role;
 const origin=req.headers.origin;const remote=req.socket.remoteAddress;
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote??'')||typeof origin!=='string'||!allowedDemoOrigins().includes(origin))fail('AUTH_REQUIRED',403);
 const bucket=hash(origin+':'+remote);
 const permitted=await pool.query(`INSERT INTO demo_login_buckets(bucket,window_start,hits) VALUES($1,clock_timestamp(),1)
 ON CONFLICT(bucket) DO UPDATE SET window_start=CASE WHEN demo_login_buckets.window_start<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE demo_login_buckets.window_start END,
 hits=CASE WHEN demo_login_buckets.window_start<clock_timestamp()-interval '1 minute' THEN 1 ELSE demo_login_buckets.hits+1 END
 WHERE demo_login_buckets.window_start<clock_timestamp()-interval '1 minute' OR demo_login_buckets.hits<12 RETURNING hits`,[bucket]);
 if(!permitted.rowCount)fail('AUTH_REQUIRED',429);
 const path='local/private/demo-login.json';const stat=fs.lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)fail('AUTH_REQUIRED',503);
 const credentials=z.array(z.object({email:z.string().email(),password:z.string().min(1),role:z.string()})).parse(JSON.parse(fs.readFileSync(path,'utf8')));
 const email={owner:'owner@bitpos.test',manager:'manager@bitpos.test',staff:'staff@bitpos.test'}[role];const selected=credentials.find(c=>c.email===email&&c.role===role);if(!selected)fail('AUTH_REQUIRED',503);
 return {credentials:{email:selected.email,password:selected.password,merchantId:MERCHANT_A},role};
}
