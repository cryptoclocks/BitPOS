import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
// The on-chain tier mints (tools/devnet/loyalty-create-mints.ts) point at /loyalty/badge-N.json; wallets show nothing if these files are missing or wrong.
const dir=new URL('../apps/web/public/loyalty/',import.meta.url);
for(const n of [1,2,3])test(`tier ${n} metadata, card art and mint URI agree`,()=>{
 const meta=JSON.parse(fs.readFileSync(new URL(`badge-${n}.json`,dir),'utf8'));
 assert.equal(meta.symbol,`REG${n}`);
 assert.equal(meta.image,`https://pay.cashlessthailand.com/loyalty/card-${n}.png`);
 assert.equal(meta.properties.files[0].uri,meta.image);assert.equal(meta.properties.files[0].type,'image/png');
 const traits=Object.fromEntries(meta.attributes.map((a:{trait_type:string;value:unknown})=>[a.trait_type,a.value]));
 assert.deepEqual([traits.Transferable,traits['Monetary value'],traits.Network],['No','None','Solana devnet']);
 assert.match(meta.description,/cannot be transferred.*no monetary value/s);
 const png=fs.readFileSync(new URL(`card-${n}.png`,dir));
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10],'a real PNG');
 assert.equal(png.readUInt32BE(16),1000);assert.equal(png.readUInt32BE(20),1400);
 assert.ok(png.length<2_000_000,'small enough for wallets to load');
 assert.ok(fs.existsSync(new URL(`card-${n}.svg`,dir)));
 // the admin script builds exactly this URI
 const script=fs.readFileSync(new URL('../tools/devnet/loyalty-create-mints.ts',import.meta.url),'utf8');
 assert.ok(script.includes('https://pay.cashlessthailand.com/loyalty/badge-${tier.slot}.json'));
});
