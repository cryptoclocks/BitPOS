import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
const adb='/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',serial='emulator-5554';
const out='.omp/work/flutter-delivery-20261016/evidence/rider-offer-ui-20261021';
await mkdir(out,{recursive:true});
const captured=new Set<string>();let captures=Promise.resolve();let output='';
try{
 execFileSync(adb,['-s',serial,'shell','wm','size','1024x2216']);execFileSync(adb,['-s',serial,'shell','wm','density','420']);
 await new Promise(resolve=>setTimeout(resolve,1500));
 const child=spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/food_offer_ui_test.dart','-d',serial,'--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-driver',stdio:['ignore','pipe','pipe']});
 const observe=(bytes:Buffer)=>{const text=bytes.toString();process.stdout.write(text);output=(output+text).slice(-16000);
  for(const match of output.matchAll(/BITPOS_(R07)_UI_VISIBLE/g)){
   const id=match[1];if(captured.has(id))continue;captured.add(id);
   captures=captures.then(async()=>{const screen=spawn(adb,['-s',serial,'exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']});const chunks:Buffer[]=[];screen.stdout.on('data',part=>chunks.push(part));assert.equal((await once(screen,'exit'))[0],0);await writeFile(`${out}/${id}.png`,Buffer.concat(chunks));});
  }};
 child.stdout.on('data',observe);child.stderr.on('data',observe);const [code]=await once(child,'exit');await captures;
 assert.equal(code,0,output);assert.equal(captured.size,1);
 await writeFile(`${out}/receipt.json`,JSON.stringify({status:'PASS_NATIVE_R07_COMPONENT_RENDER_AND_CALLBACK',screens:[...captured],fixture:'Presentation only; no API, payment, dispatch or real GPS',limits:['Manual screenshot review required','Not production route integration or full pixel parity']},null,2)+'\n');
}finally{execFileSync(adb,['-s',serial,'shell','wm','size','reset']);execFileSync(adb,['-s',serial,'shell','wm','density','reset']);}
