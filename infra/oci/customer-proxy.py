from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import urllib.request,urllib.error,re,ipaddress,http.client
class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args): pass
 def do_GET(self): self.forward()
 def do_POST(self): self.forward()
 def do_PUT(self): self.forward()

 MOBILE_REQUEST_HEADERS=('Authorization','Content-Type','Idempotency-Key','Accept','Last-Event-ID','X-BitPOS-Push-Installation-Key','X-BitPOS-Push-Next-Key')
 MOBILE_RESPONSE_HEADERS=('Content-Type','Retry-After','ETag','Content-Language')
 def mobile(self,path):
  # Phone apps: /api/mobile/v1/* only, forwarded to the API on 127.0.0.1:3001 with a fixed header allowlist.
  # The API trusts x-bitpos-client-ip only from this proxy's peer address (BITPOS_MOBILE_TRUSTED_PROXIES=127.0.0.1),
  # and this proxy never forwards a caller-supplied value: it sets exactly one validated address.
  if self.command not in ('GET','POST','PUT') or '..' in path or '//' in path:self.send_error(405 if self.command not in ('GET','POST','PUT') else 404);return
  try:size=int(self.headers.get('Content-Length','0'))
  except ValueError:self.send_error(400);return
  if size<0 or size>8000000:self.send_error(413);return
  data=self.rfile.read(size) if self.command in ('POST','PUT') else None
  raw=(self.headers.get('CF-Connecting-IP') or '').strip()
  try:client=str(ipaddress.ip_address(raw))
  except ValueError:client=self.client_address[0]
  headers={k:self.headers[k] for k in self.MOBILE_REQUEST_HEADERS if self.headers.get(k)}
  headers['x-bitpos-client-ip']=client
  conn=http.client.HTTPConnection('127.0.0.1',3001,timeout=35)
  try:
   conn.request(self.command,self.path,body=data,headers=headers);res=conn.getresponse()
  except Exception:
   conn.close();self.send_error(502);return
  try:
   streaming=(res.getheader('Content-Type') or '').startswith('text/event-stream')
   payload=None if streaming else res.read()
   self.send_response(res.status)
   for key in self.MOBILE_RESPONSE_HEADERS:
    if res.getheader(key):self.send_header(key,res.getheader(key))
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
  finally:conn.close()
 def forward(self):
  path=self.path.split('?')[0]
  if path.startswith('/api/mobile/v1/'):self.mobile(path);return
  if path in ('','/') and self.command=='GET':
   self.send_response(302);self.send_header('Location','/table/6LSn6twjmnvfGpDwTWm98p8S8o4CQqlZ8CwlK_nk1CY');self.send_header('Cache-Control','no-store');self.send_header('Content-Length','0');self.end_headers();return
  table_route=bool(re.fullmatch(r'/(?:api/)?table/[A-Za-z0-9_-]{43}(?:/visit(?:/[A-Za-z0-9_-]{43}(?:/(?:quotes|orders|release|dismiss))?)?)?',path))
  allowed=(table_route or re.fullmatch(r'/pay/[A-Za-z0-9_-]+/?',path) or re.fullmatch(r'/api/pay/[A-Za-z0-9_-]+(?:/(?:challenge|bind|attempt|submit|dismiss|events))?',path) or path.startswith(('/_astro/','/images/')))
  if not allowed or '..' in path: self.send_error(404);return
  if self.command=='POST' and not path.startswith(('/api/pay/','/api/table/')): self.send_error(405);return
  size=int(self.headers.get('Content-Length','0'))
  if size>1000000:self.send_error(413);return
  data=self.rfile.read(size) if self.command=='POST' else None
  target='http://127.0.0.1:3001'+self.path if path.startswith(('/api/pay/','/api/table/')) else 'http://127.0.0.1:4321'+self.path
  req=urllib.request.Request(target,data=data,method=self.command,headers={'Content-Type':self.headers.get('Content-Type','application/json')})
  try: res=urllib.request.urlopen(req,timeout=35)
  except urllib.error.HTTPError as e:res=e
  except Exception:self.send_error(502);return
  with res:
   streaming=path.endswith('/events') and res.status==200
   payload=None if streaming else res.read()
   self.send_response(res.status)
   for key in ['Content-Type','Content-Encoding']:
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
