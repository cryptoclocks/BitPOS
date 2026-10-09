import {writeFile} from 'node:fs/promises';
import {pool,tenant,audit} from '../../apps/api/src/db';
import {MERCHANT_A,MERCHANT_B} from '../../apps/api/src/config';
import {routingLock} from '../../apps/api/src/authority';
import {hash} from '../../packages/domain/src/index';

const operation='human-demo-cafe-replenishment-20261009';
const apply=process.argv.includes('--write');
try {
 const otherBefore=await tenant(MERCHANT_B,async db=>hash(JSON.stringify((await db.query('SELECT * FROM products WHERE merchant_id=$1 ORDER BY id',[MERCHANT_B])).rows)));
 const result=await tenant(MERCHANT_A,async db=>{
  await routingLock(db,MERCHANT_A);
  const before=(await db.query("SELECT * FROM products WHERE merchant_id=$1 AND catalog_key LIKE 'cafe.%' ORDER BY id FOR UPDATE",[MERCHANT_A])).rows;
  if(before.length!==12)throw new Error('Expected exactly the authorized twelve cafe products');
  const prior=(await db.query("SELECT id FROM audit_logs WHERE merchant_id=$1 AND action='inventory.demo_replenishment' AND subject=$2",[MERCHANT_A,operation])).rows.length>0;
  const history=async()=>hash(JSON.stringify((await db.query('SELECT to_jsonb(o) AS state FROM orders o WHERE merchant_id=$1 ORDER BY id',[MERCHANT_A])).rows));
  const historyBefore=await history();
  if(apply&&!prior){
   await db.query("UPDATE products SET stock=greatest(stock,reserved+200) WHERE merchant_id=$1 AND catalog_key LIKE 'cafe.%' AND stock-reserved<200",[MERCHANT_A]);
   await audit(db,MERCHANT_A,'coordinator:human-authorized-demo-operations','inventory.demo_replenishment',operation);
  }
  const after=(await db.query("SELECT * FROM products WHERE merchant_id=$1 AND catalog_key LIKE 'cafe.%' ORDER BY id",[MERCHANT_A])).rows;
  const preserved=before.every((p,i)=>JSON.stringify({...p,stock:0})===JSON.stringify({...after[i],stock:0}));
  if(!preserved||historyBefore!==await history())throw new Error('Inventory adjustment changed non-stock product fields or order history');
  const view=(rows:typeof before)=>rows.map(p=>({id:p.id,name:p.name_en,stock:p.stock,reserved:p.reserved,available:p.stock-p.reserved}));
  return {operation,apply,already_applied:prior,merchantId:MERCHANT_A,minimum_available:200,changed_products:before.filter((p,i)=>p.stock!==after[i].stock).length,before:view(before),after:view(after),reservations_prices_product_fields_preserved:preserved,order_history_preserved:true,financial_budget_reset:false,chain_transactions:0};
 });
 const otherAfter=await tenant(MERCHANT_B,async db=>hash(JSON.stringify((await db.query('SELECT * FROM products WHERE merchant_id=$1 ORDER BY id',[MERCHANT_B])).rows)));
 const evidence={...result,other_tenant_inventory_preserved:otherBefore===otherAfter};
 if(apply&&!result.already_applied)await writeFile('.omp/work/evidence/demo-stock-replenishment-20261009.json',JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(evidence));
} finally {await pool.end();}
