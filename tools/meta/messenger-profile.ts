// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Sets the Page's Messenger profile: Get Started, greeting and the persistent menu (the always-visible menu
// next to the composer, like a LINE rich menu): Menu cards, My orders, Book a table, voice ordering, Forget me.
// Server to server with the Page token from the private env file; prints only the Graph result.
// Usage: npx tsx tools/meta/messenger-profile.ts <env-file> [--dry-run] [--with-booking]
import {readFileSync} from 'node:fs';

const [envFile]=process.argv.slice(2);
if(!envFile)throw Error('usage: messenger-profile.ts <env-file> [--dry-run]');
const env:Record<string,string>={};
for(const line of readFileSync(envFile,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
const origin=new URL(env.META_PUBLIC_URL).origin,graph=env.META_GRAPH_VERSION??'v24.0';

export const profile={
 get_started:{payload:'BITPOS_GET_STARTED'},
 greeting:[{locale:'default',text:'BitPOS Muse Demo (hackathon test page). แตะมือถือที่เครื่องในร้านเพื่อเชื่อมต่อ แล้วสั่งผ่านแชทได้ · Tap your phone on the device in the shop to connect, then order by chat.'}],
 persistent_menu:[{locale:'default',composer_input_disabled:false,call_to_actions:[
  {type:'postback',title:'📋 เมนู / Menu',payload:'BITPOS_MENU'},
  {type:'postback',title:'🧾 ออเดอร์ของฉัน / My orders',payload:'BITPOS_MY_ORDERS'},
  ...(process.argv.includes('--with-booking')?[{type:'postback',title:'🗓️ จองโต๊ะ / Book a table',payload:'BITPOS_BOOK'}]:[]),
  {type:'web_url',title:'🎙️ สั่งด้วยเสียง / Voice order',url:`${origin}/meta/order`,webview_height_ratio:'full'},
  {type:'postback',title:'🔌 เลิกเชื่อมต่อ / Forget me',payload:'BITPOS_REVOKE'},
 ]}],
};

if(process.argv.includes('--dry-run')){console.log(JSON.stringify(profile,null,1));process.exit(0);}
if(!env.META_MESSENGER_PAGE_TOKEN)throw Error('META_MESSENGER_PAGE_TOKEN is required');
const res=await fetch(`https://graph.facebook.com/${graph}/me/messenger_profile`,{method:'POST',headers:{Authorization:`Bearer ${env.META_MESSENGER_PAGE_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(profile)});
console.log('messenger_profile',res.status,JSON.stringify(await res.json()));
