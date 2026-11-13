// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md. Copied from the PayPal edition (tools/paypal/oci-preflight.ts).
// Runs inside the pinned runtime image with the uploaded source mounted (no network, no env, no database): checks that
// every bare package the NEAR edition imports resolves from the image's node_modules, and reports versions of the
// packages the prebuilt web needs. Exit 1 lists what is missing, so a deploy stops before swapping anything.
//   node --import tsx tools/near/oci-preflight.ts <source dir> <web dir>
import {createRequire} from 'node:module';
import {readdirSync,readFileSync,statSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const [src,web]=process.argv.slice(2);
if(!src||!web)throw Error('usage: oci-preflight.ts <source dir> <web dir>');
const files:string[]=[];
const walk=(d:string)=>{for(const n of readdirSync(d)){const p=join(d,n);if(n==='node_modules')continue;const s=statSync(p);if(s.isDirectory())walk(p);else if(/\.(ts|mjs|js)$/.test(n))files.push(p);}};
for(const d of ['apps/api/src','apps/worker/src','packages','tools/near'])if(existsSync(join(src,d)))walk(join(src,d));
walk(join(web,'server'));
const missing=new Map<string,string>();let checked=0;
for(const f of files){
 const text=readFileSync(f,'utf8');const req=createRequire(f);
 for(const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"./][^'"]*)['"]/g)){
  const spec=m[1];if(spec.startsWith('node:')||/[$\s{}]/.test(spec))continue;checked++;
  try{req.resolve(spec);}catch{try{import.meta.resolve(spec,'file://'+f);}catch{missing.set(spec,f);}}
 }
}
const version=(name:string)=>{try{return JSON.parse(readFileSync(createRequire(join(web,'server/entry.mjs')).resolve(name+'/package.json'),'utf8')).version;}catch{return 'missing';}};
console.log(JSON.stringify({files:files.length,imports:checked,missing:[...missing].map(([spec,file])=>({spec,file})),web:{react:version('react'),'react-dom':version('react-dom'),zod:version('zod'),astro:version('astro')}}));
if(missing.size)process.exit(1);
