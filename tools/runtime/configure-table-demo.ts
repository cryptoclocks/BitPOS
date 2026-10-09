import 'dotenv/config';
import fs from 'node:fs';
import {MERCHANT_A} from '../../apps/api/src/config';
import {pool,tenant,audit} from '../../apps/api/src/db';
import {registry} from '../../apps/api/src/registry';
import {publishPrices,pricingView} from '../../apps/api/src/catalog';
import {hash,MINT,TOKEN_PROGRAM} from '../../packages/domain/src/index';
const token=process.env.DEVICE_TOKEN;
if(!token||!/^[A-Za-z0-9_-]{16,192}$/.test(token))throw new Error('Private existing device credential required; no value disclosed');
try {
 const receipt=await tenant(MERCHANT_A,async db=>{
  const actor=(await db.query("SELECT user_id FROM members WHERE merchant_id=$1 AND role='owner' ORDER BY user_id LIMIT 1",[MERCHANT_A])).rows[0]?.user_id;
  if(!actor)throw new Error('Existing merchant owner required');
  const labels={table:'Devnet demo table 1',device:'BitPOSClock demo 14:c1:9f:4e:62:48',register:'Devnet demo Tablet counter'};
  const ids:Record<string,string>={};
  for(const [kind,table] of [['tables','merchant_tables'],['devices','devices'],['registers','registers']] as const){
   const key=kind==='tables'?'table':kind==='devices'?'device':'register';
   const existing=await db.query(`SELECT id FROM ${table} WHERE merchant_id=$1 AND label=$2`,[MERCHANT_A,labels[key]]);
   if(existing.rowCount!>1)throw new Error('Duplicate demo registry label; refusing ambiguous cutover');
   ids[key]=existing.rows[0]?.id??(await registry(db,MERCHANT_A,actor,'owner','/api/'+kind,'POST',{label:labels[key],...(kind==='devices'?{tableId:ids.table}:{})})).id;
  }
  const device=(await db.query('SELECT * FROM devices WHERE id=$1',[ids.device])).rows[0];
  if(device.table_id!==ids.table||device.revoked_at)throw new Error('Existing demo device assignment differs; no automatic retarget');
  const credential=(await db.query('SELECT merchant_id,device_id,auth_generation,revoked_at FROM device_credentials WHERE token_hash=$1',[hash(token)])).rows[0];
  if(credential&&(credential.merchant_id!==MERCHANT_A||credential.device_id!==ids.device||String(credential.auth_generation)!==String(device.auth_generation)||credential.revoked_at))throw new Error('Credential already belongs elsewhere or is revoked');
  if(!credential){if((await db.query('SELECT 1 FROM device_credentials WHERE merchant_id=$1 AND device_id=$2 AND revoked_at IS NULL',[MERCHANT_A,ids.device])).rowCount)throw new Error('Device already has a different live credential');await db.query('INSERT INTO device_credentials(token_hash,merchant_id,device_id,auth_generation) VALUES($1,$2,$3,$4)',[hash(token),MERCHANT_A,ids.device,device.auth_generation]);await audit(db,MERCHANT_A,actor,'device.private_existing_credential_cutover',ids.device);}
  const register=(await db.query('SELECT * FROM registers WHERE id=$1',[ids.register])).rows[0];
  if(register.paired_device_id&&register.paired_device_id!==ids.device)throw new Error('Existing register pairing differs; no automatic retarget');
  await registry(db,MERCHANT_A,actor,'owner','/api/registers/'+ids.register+'/pairing','PUT',{deviceId:ids.device,expectedPairingGeneration:String(register.pairing_generation)});
  let pricing=await pricingView(db,MERCHANT_A);
  if(!pricing.configured){const products=(await db.query('SELECT id FROM products WHERE merchant_id=$1 ORDER BY id',[MERCHANT_A])).rows;await publishPrices(db,MERCHANT_A,actor,'owner',{expectedRevision:pricing.revision,catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'SCRIPTED DEVNET ONLY: USD 0.10 per item, not retail prices or FX'},prices:products.map(p=>({productId:p.id,unitMinor:'10'})),settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});pricing=await pricingView(db,MERCHANT_A);}
  return {origin:'authorized_explicit_demo_configuration',merchantId:MERCHANT_A,ids,labels,pricing,credential:'existing_private_token_hash_bound_no_token_export',physicalClaim:false};
 });
 fs.writeFileSync('.omp/work/evidence/table-demo-configuration.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){console.error('Demo configuration refused; no private credential or raw database error disclosed');process.exitCode=1;}finally{await pool.end();}
