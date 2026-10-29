import {chromium} from '/Users/cryptoclock/Desktop/BitPOS/local/toolchains/browser-contract/node_modules/playwright/index.mjs';
import {readFileSync,mkdirSync} from 'node:fs';
export const ORIGIN='http://127.0.0.1:4482';
export const here=new URL('.',import.meta.url).pathname;
export const fixture=()=>JSON.parse(readFileSync(here+'.fixture.json','utf8'));
export const MERCHANT='7e0d0c0e-0000-4000-8000-00000000f001';
export const PASSWORD='render-local-only';
export const launch=()=>chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
export function shotDir(name){const d=here+'shots/'+name+'/';mkdirSync(d,{recursive:true});return d;}
/** Sign in through the real form (fake local auth). role: owner|manager|staff. */
export async function login(page,role='owner',merchantId=''){
 await page.goto(ORIGIN+'/');
 if(merchantId){await page.locator('summary').click();await page.locator('input[name=merchantId]').fill(merchantId);}
 await page.locator('input[name=email]').fill(role+'@render.invalid');
 await page.locator('input[name=password]').fill(PASSWORD);
 await page.getByRole('button',{name:/^(Sign in|เข้าสู่ระบบ)$/}).click();
 await page.locator('header, .workspace-nav, nav').first().waitFor({timeout:15000});
 await page.waitForTimeout(1200);
}
/** Click a nav/tab/button by visible name (regex, first visible match); at narrow width the workspace menu is opened if needed. */
export async function click(page,name,{timeout=2000}={}){
 const re=name instanceof RegExp?name:new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
 let loc=page.getByRole('button',{name:re}).filter({visible:true}).first();
 if(!(await loc.isVisible().catch(()=>false))){await page.getByRole('button',{name:/Workspace navigation|เมนู/i}).first().click({timeout:800}).catch(()=>{});await page.waitForTimeout(250);loc=page.getByRole('button',{name:re}).filter({visible:true}).first();}
 await loc.click({timeout});await page.waitForTimeout(450);
}
export const toggleLang=async page=>{await page.locator('button.language-toggle').click().catch(()=>{});await page.waitForTimeout(300);};
export const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
/** Collect page errors and failed API calls (status >= 400 except 401 on sign-in probes) for the report. */
export function watch(page,log){
 page.on('pageerror',e=>log.push('pageerror: '+e.message.slice(0,200)));
 page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/')&&r.status()>=400)log.push(`${r.request().method()} ${u.pathname} -> ${r.status()}`);});
}
