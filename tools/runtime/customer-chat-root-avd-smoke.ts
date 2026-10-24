import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';

const evidence='.omp/work/flutter-delivery-20261016/evidence';
const date='20261021';
const adb='/Users/cryptoclock/Library/Android/sdk/platform-tools/adb';
execFileSync(adb,['-s','emulator-5554','shell','wm','size','1024x2216']);
execFileSync(adb,['-s','emulator-5554','shell','wm','density','420']);
const flutter=spawn('/Users/cryptoclock/development/flutter/bin/flutter',[
 'test','integration_test/customer_chat_root_test.dart','-d','emulator-5554',
 '--no-enable-impeller','--no-uninstall',
],{cwd:'apps/mobile-customer',stdio:['ignore','pipe','pipe']});
let output='',geometryLine='',messageGeometryLine='',captured=false;
let screenshot=Promise.resolve();
const observe=(chunk:Buffer)=>{
 const text=chunk.toString();process.stdout.write(text);output=(output+text).slice(-12000);
 const match=/BITPOS_U29_ROOT_AVD_GEOMETRY:([^\r\n]+)/.exec(output);if(match)geometryLine=match[1];
 const messageMatch=/BITPOS_U29_MESSAGE_GEOMETRY:([^\r\n]+)/.exec(output);if(messageMatch)messageGeometryLine=messageMatch[1];
 if(captured||!text.includes('BITPOS_U29_ROOT_AVD_VISIBLE'))return;
 captured=true;
 screenshot=(async()=>{
  const image=spawn(adb,['-s','emulator-5554','exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']});
  const chunks:Buffer[]=[];image.stdout.on('data',part=>chunks.push(part));
  const [code]=await once(image,'exit');assert.equal(code,0);
  await writeFile(`${evidence}/customer-u29-root-avd-direct-${date}.png`,Buffer.concat(chunks));
 })();
 void screenshot.catch(error=>{throw error;});
};
flutter.stdout.on('data',observe);flutter.stderr.on('data',observe);
const [exitCode]=await once(flutter,'exit');await screenshot;
execFileSync(adb,['-s','emulator-5554','shell','wm','size','reset']);
execFileSync(adb,['-s','emulator-5554','shell','wm','density','reset']);
assert.equal(exitCode,0,output);assert.ok(captured,'U29 AVD screenshot marker missing');assert.ok(geometryLine,'U29 AVD geometry receipt missing');assert.ok(messageGeometryLine,'U29 AVD message geometry receipt missing');
await writeFile(`${evidence}/customer-u29-root-avd-direct-${date}.json`,JSON.stringify({
 date:'2026-10-21',status:'PASS_CUSTOMER_TRACKING_TO_CHAT_ROOT_AVD_FIGCRAFT_GEOMETRY',
 native:{device:'emulator-5554',integration:'customer_chat_root_test.dart',result:'PASS',screenshot:`customer-u29-root-avd-direct-${date}.png`,geometry:geometryLine,messageGeometry:messageGeometryLine},
 fixture:'In-memory RootChatApi fixture for screen/navigation geometry only. Actual chat HTTP/SSE/text/photo/read/logout acceptance is separately evidenced in food-chat105-multi-gallery-actual-avd-20261020.json.',
 limits:['This AVD run uses the actual Customer order-history → order detail → tracking → chat widget route, but its order/assignment/message data are in-memory fixture data.','No API/SQL, provider, chain, or production claim is made by this screenshot.','Full-page automated pixel diff and physical/field testing remain open.'],
 physicalTesting:'deferred_by_user_2026-10-16'
},null,2)+'\n');
console.log(`PASS_U29_ROOT_AVD ${geometryLine}`);
