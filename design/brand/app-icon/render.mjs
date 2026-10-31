import {chromium} from '/Users/cryptoclock/Desktop/BitPOS/local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import {readFileSync} from 'node:fs';
const dir=new URL('./',import.meta.url).pathname;const svg=readFileSync(dir+'bitpos-app-icon.svg','utf8');
const fg=svg.replace(/<rect width="1024" height="1024" fill="url\(#bg\)"\/><rect width="1024" height="1024" fill="url\(#glow\)"\/>/,'');
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage({viewport:{width:1024,height:1024}});
for(const [name,body,omit] of [['icon-1024.png',svg,false],['foreground-1024.png',fg,true]]){
 await p.setContent(`<body style="margin:0;background:transparent">${body}</body>`);await p.screenshot({path:dir+name,omitBackground:omit});}
await b.close();
