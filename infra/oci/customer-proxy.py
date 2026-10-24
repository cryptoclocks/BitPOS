from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import urllib.request,urllib.error,re
class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args): pass
 def do_GET(self): self.forward()
 def do_POST(self): self.forward()
 def forward(self):
  path=self.path.split('?')[0]
  table_route=bool(re.fullmatch(r'/(?:api/)?table/[A-Za-z0-9_-]{43}(?:/visit(?:/[A-Za-z0-9_-]{43}(?:/(?:quotes|orders|release|dismiss|repeat-quotes|copilot(?:/[0-9a-f-]{36})?|transcribe|grants/(?:challenge|session|prepare|authorize|pause|revoke|reconcile|history|checkout)))?)?)?',path))
  media_route=bool(re.fullmatch(r'/api/promotions/media/[A-Za-z0-9_-]{43}/(?:image\.rgb565|preview\.png)',path))
  x402_route=bool(re.fullmatch(r'/api/pay/[A-Za-z0-9_-]+/x402',path))
  customer_auth_route=bool(re.fullmatch(r'/api/pay/[A-Za-z0-9_-]+/customer/(?:challenge|verify|session|use|revoke)',path))
  menu_route=bool(re.fullmatch(r'/(?:api/)?pay/[A-Za-z0-9_-]+/menu',path))
  supported_route=path=='/api/x402/supported'
  allowed=(table_route or media_route or supported_route or customer_auth_route or menu_route or re.fullmatch(r'/pay/[A-Za-z0-9_-]+/?',path) or re.fullmatch(r'/api/pay/[A-Za-z0-9_-]+(?:/(?:challenge|bind|attempt|submit|dismiss|events|assets|asset|x402))?',path) or path.startswith(('/_astro/','/images/')))
  if not allowed or '..' in path: self.send_error(404);return
  if self.command=='POST' and not path.startswith(('/api/pay/','/api/table/')): self.send_error(405);return
  if menu_route and self.command!='GET':self.send_error(405);return
  try:size=int(self.headers.get('Content-Length','0'))
  except ValueError:self.send_error(400);return
  audio_route=bool(re.fullmatch(r'/api/table/[A-Za-z0-9_-]{43}/visit/[A-Za-z0-9_-]{43}/transcribe',path))
  if size<0 or size>(2900000 if audio_route else 1000000):self.send_error(413);return
  data=self.rfile.read(size) if self.command=='POST' else None
  target='http://127.0.0.1:3001'+self.path if media_route or supported_route or path.startswith(('/api/pay/','/api/table/')) else 'http://127.0.0.1:4321'+self.path
  headers={'Content-Type':self.headers.get('Content-Type','application/json')}
  if customer_auth_route:
   if self.command!='POST':self.send_error(405);return
   origin=self.headers.get('Origin')
   if not origin or len(origin)>600:self.send_error(403);return
   headers['Origin']=origin
  if x402_route and self.headers.get('PAYMENT-SIGNATURE'):
   signature=self.headers['PAYMENT-SIGNATURE']
   if len(signature)>16384:self.send_error(413);return
   headers['PAYMENT-SIGNATURE']=signature
  req=urllib.request.Request(target,data=data,method=self.command,headers=headers)
  try: res=urllib.request.urlopen(req,timeout=35)
  except urllib.error.HTTPError as e:res=e
  except Exception:self.send_error(502);return
  with res:
   streaming=path.endswith('/events') and res.status==200
   payload=None if streaming else res.read()
   self.send_response(res.status)
   for key in ['Content-Type','Content-Encoding','X-Content-SHA256']+(['PAYMENT-REQUIRED','PAYMENT-RESPONSE'] if x402_route else []):
    if res.headers.get(key):self.send_header(key,res.headers[key])
   self.send_header('Cache-Control','no-store, no-transform');self.send_header('X-Content-Type-Options','nosniff')
   if streaming:self.send_header('Transfer-Encoding','chunked');self.send_header('X-Accel-Buffering','no')
   else:self.send_header('Content-Length',str(len(payload)))
   self.end_headers()
   if streaming:
    try:
     while True:
      line=res.readline()
      if not line:break
      self.wfile.write(('%x\r\n'%len(line)).encode()+line+b'\r\n');self.wfile.flush()
     self.wfile.write(b'0\r\n\r\n');self.wfile.flush()
    except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
   else:self.wfile.write(payload)
ThreadingHTTPServer(('127.0.0.1',4323),Handler).serve_forever()
