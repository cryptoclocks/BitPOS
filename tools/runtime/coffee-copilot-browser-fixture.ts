import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {tableFixture} from '../../tests/backend-table-fixture';
import {config} from '../../apps/api/src/config';
import {pool} from '../../apps/api/src/db';
const privateRoot=fs.realpathSync(config.DEVNET_PRIVATE_DIR),root=fs.realpathSync(process.cwd());if(privateRoot===root||privateRoot.startsWith(root+path.sep))throw Error('Browser fixture state must remain private outside repository');
try{
 const f=await tableFixture(12);const entry=(await f.tenant(f.merchant,db=>db.query('SELECT entry_token FROM table_entries WHERE merchant_id=$1 AND device_id=$2 ORDER BY auth_generation DESC LIMIT 1',[f.merchant,f.b.id]))).rows[0].entry_token;
 await f.tenant(f.merchant,db=>db.query("UPDATE merchants SET name='Coffee Copilot browser FIXTURE' WHERE id=$1",[f.merchant]));
 const directory=path.join(privateRoot,'proof');fs.mkdirSync(directory,{recursive:true,mode:0o700});if(fs.lstatSync(directory).isSymbolicLink()||(fs.statSync(directory).mode&0o777)!==0o700)throw Error('Unsafe private proof directory');
 const state={origin:'actual_built_web_private_visit_with_virtual_DB_device_presence',merchant:f.merchant,entry,product:f.product,device:f.b.id,physicalDisplay:false,physicalMicrophone:false,providerCalls:0,payments:0};
 const file=path.join(directory,'coffee-browser-fixture.json');if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Unsafe private fixture path');fs.writeFileSync(file,JSON.stringify(state)+'\n',{mode:0o600});fs.chmodSync(file,0o600);
 console.log(JSON.stringify({result:'browser_fixture_ready',privateState:file,tableUrl:'http://127.0.0.1:4325/table/'+entry,physicalDisplay:false,providerCalls:0,payments:0}));
}finally{await pool.end();}
