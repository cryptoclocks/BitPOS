from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import urllib.request,urllib.error,re
class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args): pass
 def do_GET(self): self.forward()
 def do_POST(self): self.forward()
 def forward(self):
  path=self.path.split('?')[0]
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
