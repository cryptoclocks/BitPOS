import fs from 'node:fs';
import {chromium} from '../../local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import tablet from '../../apps/web/tests/tablet-browser.mjs';
import setup from '../../apps/web/tests/setup-browser.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:29347');
let exit=0;
try {
 for(const [name,run] of [['tablet',tablet],['setup',setup]]){
  const context=await browser.newContext();const page=await context.newPage();
  try {const receipt=await run(page,'http://127.0.0.1:4321');await page.screenshot({path:`.omp/work/evidence/table-${name}-browser.png`,fullPage:true});fs.writeFileSync(`.omp/work/evidence/table-${name}-browser.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({name,result:'pass',receipt}));}
  catch(error){await page.screenshot({path:`.omp/work/evidence/table-${name}-browser-failure.png`,fullPage:true});console.error(error);exit=1;break;}
  finally{await context.close();}
 }
}finally{
 // End only this client process, never close the shared native-owned Chrome.
 process.exit(exit);
}
