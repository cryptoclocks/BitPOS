// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// NEAR configuration. Testnet only: any other network is refused outright until the owner authorises mainnet.
import {z} from 'zod';
import type {NearSettings} from './chain';

export type NearConfigErrorCode='CONFIGURATION_REQUIRED'|'MAINNET_REFUSED';
export class NearConfigError extends Error {constructor(readonly code:NearConfigErrorCode){super(code);}}
export interface NearConfig extends NearSettings {
 /** Testnet accounts whose keys the server holds so a judge without a wallet can pay. Shown as "Demo wallet (testnet)". */
 demoWallets:string[];
}
const account=z.string().regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/).min(2).max(64);
const schema=z.object({
 NEAR_NETWORK:z.literal('testnet'),
 NEAR_RPC_URLS:z.string().default('https://test.rpc.fastnear.com,https://near-testnet.drpc.org').transform(v=>v.split(',').map(s=>s.trim()).filter(Boolean)).pipe(z.array(z.string().url().startsWith('https://')).min(1).max(4)),
 NEAR_BILLS_CONTRACT:account.refine(v=>v.endsWith('.testnet')),
 NEAR_RELAYER_ACCOUNT:account.refine(v=>v.endsWith('.testnet')),
 NEAR_PRIVATE_DIR:z.string().min(1),
 NEAR_DEMO_WALLETS:z.string().default('').transform(v=>v.split(',').map(s=>s.trim()).filter(Boolean)).pipe(z.array(account.refine(v=>v.endsWith('.testnet'))).max(4)),
 NEAR_EXPLORER_TX:z.literal('https://testnet.nearblocks.io/txns/').default('https://testnet.nearblocks.io/txns/')
});
/** Throws MAINNET_REFUSED for any network other than testnet, CONFIGURATION_REQUIRED for anything missing or malformed. */
export function nearConfig(env:NodeJS.ProcessEnv=process.env):NearConfig{
 if(env.NEAR_NETWORK&&env.NEAR_NETWORK!=='testnet')throw new NearConfigError('MAINNET_REFUSED');
 const c=schema.safeParse({...env,NEAR_RPC_URLS:env.NEAR_RPC_URLS||undefined,NEAR_DEMO_WALLETS:env.NEAR_DEMO_WALLETS||undefined,NEAR_EXPLORER_TX:env.NEAR_EXPLORER_TX||undefined});
 if(!c.success)throw new NearConfigError('CONFIGURATION_REQUIRED');
 return {network:'testnet',rpcUrls:c.data.NEAR_RPC_URLS,billsContract:c.data.NEAR_BILLS_CONTRACT,relayerAccount:c.data.NEAR_RELAYER_ACCOUNT,privateDir:c.data.NEAR_PRIVATE_DIR,explorerTx:c.data.NEAR_EXPLORER_TX,demoWallets:c.data.NEAR_DEMO_WALLETS};
}
