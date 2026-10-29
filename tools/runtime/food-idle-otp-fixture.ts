import http from 'node:http';
// Explicit loopback-only sandbox identity, no SMS or production-provider fallback.
const phone='+66900000711';
http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');let raw='';for await(const bytes of req){raw+=bytes;if(raw.length>8192){res.writeHead(413);res.end('{}');return;}}
 let body:Record<string,unknown>;try{body=JSON.parse(raw||'{}');}catch{res.writeHead(400);res.end('{}');return;}
 if(req.url==='/otp'&&body.phone===phone){res.end('{"fixture":true}');return;}
 if(req.url==='/verify'&&body.phone===phone&&body.token==='123456'){res.end(JSON.stringify({user:{id:'fa000000-0000-4000-8000-000000000711',phone,phone_confirmed_at:'2026-10-16T00:00:00Z'}}));return;}
 res.writeHead(401);res.end('{}');
}).listen(3999,'127.0.0.1',()=>console.log('Idle071 dedicated synthetic OTP fixture ready; no SMS'));
