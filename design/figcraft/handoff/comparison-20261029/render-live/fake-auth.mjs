// Local-only stand-in for the Supabase auth /token endpoint used by POST /api/session (apps/api/src/index.ts login()).
// Accepts only the throwaway render password and maps an email to a stable user id from users.json written by seed.
// Binds 127.0.0.1 only. No real credential is involved.
import http from 'node:http';
import {readFileSync} from 'node:fs';
const users=JSON.parse(readFileSync(new URL('./.users.json',import.meta.url)));
const PASSWORD='render-local-only';
http.createServer((req,res)=>{
 let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  try{const {email,password}=JSON.parse(body||'{}');const id=users[String(email).toLowerCase()];
   if(req.url.startsWith('/token')&&id&&password===PASSWORD){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({user:{id},access_token:'x'}));return;}}catch{}
  res.writeHead(400,{'content-type':'application/json'});res.end('{"error":"invalid_grant"}');
 });
}).listen(Number(process.env.RENDER_AUTH_PORT||3091),'127.0.0.1');
