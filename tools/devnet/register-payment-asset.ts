// Coordinator-only registry provisioning. No chain signing, funding or key reads.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {z} from 'zod';
import {config} from '../../apps/api/src/config';
import {assertCluster,mintPolicy} from '../../apps/api/src/payments';
import {USDG_ASSET,USDC_DEVNET_MINT,SPL_TOKEN_PROGRAM,assertAssetDescriptor} from '../../packages/domain/src/payment-assets';
import type {PaymentAsset} from '../../packages/contracts/src/index';
const mode=process.argv[2];
const descriptorSchema=z.object({assetId:z.string(),symbol:z.enum(['USDG','USDC','USDT']),displayLabel:z.string(),cluster:z.literal('devnet'),genesisHash:z.string(),mint:z.string(),tokenProgram:z.string(),decimals:z.literal(6),instructionPolicy:z.enum(['token2022_zero_fee','spl_checked']),issuerTestAsset:z.boolean()}).strict();
async function run(){
 let asset:PaymentAsset;
 if(mode==='--usdc'&&process.argv.length===3)asset={...USDG_ASSET,assetId:'usdc-devnet',symbol:'USDC',displayLabel:'USDC devnet (Circle)',mint:USDC_DEVNET_MINT,tokenProgram:SPL_TOKEN_PROGRAM,instructionPolicy:'spl_checked'};
 else if(mode==='--usdt-test'&&process.argv.length===3){
  const privateDir=fs.realpathSync(config.DEVNET_PRIVATE_DIR),repo=fs.realpathSync(fileURLToPath(new URL('../..',import.meta.url)));
  if(privateDir===repo||privateDir.startsWith(repo+path.sep))throw Error('Private manifest must be outside repository');
  const manifest=path.join(privateDir,'usdt-test-asset.public.json');
  if(fs.lstatSync(manifest).isSymbolicLink())throw Error('Manifest must not be a symlink');
  asset=descriptorSchema.parse(JSON.parse(fs.readFileSync(manifest,'utf8')));
  if(asset.assetId!=='usdt-test-devnet')throw Error('Unexpected test asset identity');
 }else throw Error('Usage: pnpm exec tsx tools/devnet/register-payment-asset.ts --usdc|--usdt-test');
 assertAssetDescriptor(asset);await assertCluster();const mint=await mintPolicy(asset);
 if(asset.assetId==='usdt-test-devnet'&&(mint.mintAuthority!==null||mint.freezeAuthority!==null||mint.supply!==100000000n))throw Error('Test mint setup policy mismatch');
 const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
 try{await db.query('BEGIN');const old=(await db.query('SELECT descriptor FROM bitpos.payment_assets WHERE asset_id=$1 FOR UPDATE',[asset.assetId])).rows[0];
  if(old&&JSON.stringify(Object.entries(old.descriptor).sort())!==JSON.stringify(Object.entries(asset).sort()))throw Error('Canonical registry identity cannot change');
  await db.query('INSERT INTO bitpos.payment_assets(asset_id,descriptor,enabled,verified_at) VALUES($1,$2,true,clock_timestamp()) ON CONFLICT(asset_id) DO UPDATE SET enabled=true,verified_at=excluded.verified_at',[asset.assetId,asset]);
  await db.query('COMMIT');console.log(JSON.stringify({asset,registryVerified:true,merchantEnableRequired:true,chainTransactions:false}));
 }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
void run().catch(()=>{console.error('Registry provisioning rejected; inspect private prerequisites and devnet mint policy');process.exitCode=1;});
