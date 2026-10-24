import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Connection,PublicKey} from '@solana/web3.js';
import {getMint,getExtensionTypes,getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {getTransferFeeConfig,getTransferHook,getDefaultAccountState,getPermanentDelegate,getMetadataPointerState,getInterestBearingMintConfigState,ExtensionType} from '@solana/spl-token';
import pg from 'pg';
const genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',chain=new Connection('https://api.devnet.solana.com',{commitment:'finalized',disableRetryOnRateLimit:true,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(12000)})});
assert.equal(await chain.getGenesisHash(),genesis);
const registry=[{assetId:'usdg-devnet',symbol:'USDG',mint:'4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7',program:TOKEN_2022_PROGRAM_ID,source:'https://faucet.paxos.com/?token=USDG&network=SOLANA'},{assetId:'usdc-devnet',symbol:'USDC',mint:'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',program:TOKEN_PROGRAM_ID,source:'https://developers.circle.com/stablecoins/usdc-contract-addresses'}];
const manifest=JSON.parse(fs.readFileSync(path.join(process.env.DEVNET_PRIVATE_DIR,'wallets.public.json'),'utf8'));
const payer=manifest.wallets.find(w=>w.id==='customer-no-sol');assert.ok(payer);
const assets=[];
for(const asset of registry){
 const address=new PublicKey(asset.mint),account=await chain.getAccountInfo(address,'finalized');assert.ok(account);assert.ok(account.owner.equals(asset.program));
 const mint=await getMint(chain,address,'finalized',asset.program),extensions=getExtensionTypes(mint.tlvData),fee=getTransferFeeConfig(mint),hook=getTransferHook(mint);
 const ata=getAssociatedTokenAddressSync(address,new PublicKey(payer.address),false,asset.program);
 const balance=(await chain.getAccountInfo(ata,'finalized'))?(await chain.getTokenAccountBalance(ata,'finalized')).value.amount:null;
 const decoded={transferFee:fee,transferHook:hook,defaultAccountState:getDefaultAccountState(mint),permanentDelegate:getPermanentDelegate(mint),metadataPointer:getMetadataPointerState(mint),interestBearing:getInterestBearingMintConfigState(mint)};
 assets.push({assetId:asset.assetId,symbol:asset.symbol,mint:asset.mint,tokenProgram:account.owner.toBase58(),decimals:mint.decimals,extensions,extensionNames:extensions.map(type=>ExtensionType[type]),decoded:JSON.parse(JSON.stringify(decoded,(_key,value)=>typeof value==='bigint'?value.toString():value)),payerRawBalance:balance,canonicalSource:asset.source});
}
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const budget=(await db.query("SELECT current_date::text AS day,coalesce((SELECT reserved_lamports::text FROM bitpos.sponsor_days WHERE day=current_date),'0') AS grossReservedLamports,(SELECT count(*)::int FROM bitpos.payment_attempts WHERE status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')) AS unresolvedAttempts")).rows[0];await db.end();
const evidence={scope:'post-submit-20261012',origin:'read_only_actual_finalized_devnet_mint_and_budget_inspection',at:new Date().toISOString(),genesis,assets,budget,transactionsSubmitted:0,mainnetUsed:false,usdt:'No issuer devnet mint in official Tether protocol source; separate clearly labeled BitPOS test mint required',tetherSource:'https://tether.to/en/supported-protocols/'};
fs.writeFileSync('.omp/work/post-submit-20261012/evidence/assets-preflight.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
