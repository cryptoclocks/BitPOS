// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Provenance check for judges: every file added since the pre-hackathon baseline must carry the
// "Meta hackathon work" header (or live under meta-hackathon/), and every pre-existing file changed since
// then must be declared in PROVENANCE.md. Prints a Markdown report; exits 1 when anything is undeclared.
// Usage: npx tsx tools/meta/provenance-report.ts [base-ref] > meta-hackathon/PROVENANCE_REPORT.md
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const base=process.argv[2]??'meta-hackathon-baseline';
const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8',maxBuffer:64*1024*1024});
const head=git('rev-parse','--short','HEAD').trim(),baseSha=git('rev-parse','--short',base).trim();
const rows=git('diff','--name-status','--no-renames',`${base}..HEAD`).trim().split('\n').filter(Boolean).map(l=>{const [s,...p]=l.split('\t');return {status:s[0],path:p.join('\t')};});
const provenance=readFileSync('meta-hackathon/PROVENANCE.md','utf8');
const declaredModified=new Set([...provenance.matchAll(/^\| `([^`]+)` \|/gm)].map(m=>m[1]));
const HEADER=/Meta hackathon work \(2026-10-26\.\.11-04\)/;
const exempt=(p:string)=>p.startsWith('meta-hackathon/')||/\.(png|jpe?g|webp|gif|mp4|ico|json|lock|ya?ml)$/i.test(p)&&!p.startsWith('infra/meta/');

const added=rows.filter(r=>r.status==='A'),modified=rows.filter(r=>r.status==='M'),deleted=rows.filter(r=>r.status==='D');
const missingHeader=added.filter(r=>!exempt(r.path)&&!HEADER.test(git('show',`HEAD:${r.path}`).split('\n').slice(0,4).join('\n')));
const undeclared=modified.filter(r=>!declaredModified.has(r.path));
const lines=(path:string)=>{try{return git('show',`HEAD:${path}`).split('\n').length;}catch{return 0;}};
const addedLines=added.reduce((n,r)=>n+lines(r.path),0);
const out=[`# Provenance report`,``,`Generated from \`git diff ${base}..HEAD\` (${baseSha} → ${head}). Regenerate with \`npx tsx tools/meta/provenance-report.ts\`.`,``,
 `| | Files |`,`|---|---|`,`| Added during the hackathon | ${added.length} (${addedLines.toLocaleString('en-US')} lines) |`,`| Pre-existing files modified | ${modified.length} |`,`| Deleted | ${deleted.length} |`,``,
 `## Added files`,``,...added.map(r=>`- \`${r.path}\``),``,
 `## Pre-existing files modified (each must be declared in PROVENANCE.md)`,``,...(modified.length?modified.map(r=>`- \`${r.path}\` ${declaredModified.has(r.path)?'— declared':'— **NOT DECLARED**'}`):['- none']),``,
 `## Checks`,``,`- New files without the hackathon header: ${missingHeader.length?missingHeader.map(r=>`\`${r.path}\``).join(', '):'none'}`,`- Modified files not declared: ${undeclared.length?undeclared.map(r=>`\`${r.path}\``).join(', '):'none'}`,`- Deleted pre-existing files: ${deleted.length?deleted.map(r=>`\`${r.path}\``).join(', '):'none'}`,``];
process.stdout.write(out.join('\n'));
if(missingHeader.length||undeclared.length||deleted.length)process.exitCode=1;
