import {readFile,writeFile} from 'node:fs/promises';
const path='packages/openapi/mobile-v1.json',document=JSON.parse(await readFile(path,'utf8'));
const route=document.paths['/branches'].get;
route.parameters=[{name:'cursor',in:'query',schema:{type:'string',format:'uuid'}},{name:'search',in:'query',description:'Trimmed literal case-insensitive merchant, branch or address substring; no wildcard semantics.',schema:{type:'string',maxLength:100}},{name:'serving',in:'query',description:'Enabled branch mode, not opening-hours or delivery-area authority.',schema:{type:'string',enum:['all','pickup','delivery'],default:'all'}}];
route.responses['200'].description='Enabled public profiles filtered before UUID keyset pagination. Keep search and serving unchanged between pages; refresh to observe concurrent additions.';
await writeFile(path,JSON.stringify(document,null,2)+'\n');
