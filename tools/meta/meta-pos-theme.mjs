// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Build step for the meta-pos image only: recolours the POS web sources from BitPOS purple to Meta blue in a build
// copy (never the repository). Every hex or rgb() colour whose hue is purple/violet/magenta (250°–335°) gets the
// Meta blue hue (217°) with its lightness and saturation kept, so tints, borders and dark text keep their contrast.
// Usage: node tools/meta/meta-pos-theme.mjs <apps/web/src directory of the build copy>
import {readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const META_HUE=217;
const toHsl=(r,g,b)=>{r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;let h=0,s=0;
 if(max!==min){const d=max-min;s=l>.5?d/(2-max-min):d/(max+min);h=max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4;h*=60;}return [h,s,l];};
const toRgb=(h,s,l)=>{const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));return [f(0),f(8),f(4)].map(v=>Math.round(v*255));};
const purple=(h,s)=>s>0.04&&h>=250&&h<=335;
const recolour=(r,g,b)=>{const [h,s,l]=toHsl(r,g,b);if(!purple(h,s))return null;return toRgb(META_HUE,Math.min(1,s*1.05),l);};
const hex=v=>v.toString(16).padStart(2,'0');
export function themeText(text){
 return text
  .replace(/#([0-9a-fA-F]{6})\b/g,(m,x)=>{const c=recolour(...[0,2,4].map(i=>parseInt(x.slice(i,i+2),16)));return c?'#'+c.map(hex).join(''):m;})
  .replace(/#([0-9a-fA-F]{3})\b(?![0-9a-fA-F])/g,(m,x)=>{const c=recolour(...[...x].map(d=>parseInt(d+d,16)));return c?'#'+c.map(hex).join(''):m;})
  .replace(/rgba?\((\s*\d{1,3}\s*),(\s*\d{1,3}\s*),(\s*\d{1,3}\s*)(,[^)]*)?\)/g,(m,r,g,b,a)=>{const c=recolour(+r,+g,+b);return c?`${a?'rgba':'rgb'}(${c.join(',')}${a??''})`:m;});
}
function walk(dir){for(const n of readdirSync(dir)){const p=join(dir,n);if(statSync(p).isDirectory())walk(p);else if(/\.(css|tsx|ts|astro)$/.test(n)){const t=readFileSync(p,'utf8'),u=themeText(t);if(u!==t)writeFileSync(p,u);}}}
if(process.argv[2])walk(process.argv[2]);
