// Admin script: create the Token-2022 "Regulars" mint for each configured tier of one shop that has none yet, on Solana DEVNET.
//   pnpm exec tsx tools/devnet/loyalty-create-mints.ts <merchant-uuid>
// Needs the API database env (DATABASE_URL etc.) and the private key directory outside the repo (BITPOS_DEVNET_KEY_DIR).
import os from 'node:os';
import path from 'node:path';
import {Connection} from '@solana/web3.js';
import {tenant} from '../../apps/api/src/db';
import {createTierMint,loadRoleKeypair} from '../../apps/api/src/loyalty-chain';
const merchant=process.argv[2];
if(!merchant||!/^[0-9a-f-]{36}$/.test(merchant))throw new Error('usage: loyalty-create-mints.ts <merchant-uuid>');
const dir=process.env.BITPOS_DEVNET_KEY_DIR??path.join(os.homedir(),'Desktop','BitPOS-Devnet-Private');
const signers={connection:new Connection('https://api.devnet.solana.com','confirmed'),payer:loadRoleKeypair(dir,'fee-sponsor'),issuer:loadRoleKeypair(dir,'reward-issuer')};
const tiers=await tenant(merchant,async db=>(await db.query('SELECT bitpos.loyalty180_tier_list() AS v')).rows[0].v as {slot:number;nameEn:string;mintAddress:string|null}[]);
for(const tier of tiers.filter(t=>!t.mintAddress)){
 const {mint,signature}=await createTierMint(signers,{name:`Regulars ${tier.nameEn}`.slice(0,32),symbol:`REG${tier.slot}`,uri:`https://pay.cashlessthailand.com/loyalty/badge-${tier.slot}.json`});
 await tenant(merchant,db=>db.query('SELECT bitpos.loyalty180_set_mint($1,$2,$3)',[tier.slot,mint,signature]));
 console.log(JSON.stringify({merchant,slot:tier.slot,mint,signature}));
}
process.exit(0);
