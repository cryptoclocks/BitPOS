'use strict';
// Mechanical host signer used by browser automation; stdin/stdout contain public bytes only.
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const raw=fs.readFileSync(0,'utf8');assert.ok(raw.length<=20000);const input=JSON.parse(raw);
 assert.ok(['address','signMessage','signTransaction'].includes(input.operation));
 const callbacks={};const page={exposeFunction:async(name,fn)=>{callbacks[name]=fn;},evaluate:async()=>{}};
 const fixture=await require('./browser-fixture.cjs')(page,input.orderId);
 const result=input.operation==='address'?fixture.address:await callbacks[input.operation==='signMessage'?'bitposFixtureSignMessage':'bitposFixtureSignTransaction'](input.bytes);
 process.stdout.write(JSON.stringify(result));
})().catch(()=>{process.stderr.write('Constrained browser fixture signing refused\n');process.exitCode=1;});
