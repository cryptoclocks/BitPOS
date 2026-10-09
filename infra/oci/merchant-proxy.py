"""Merchant HTTPS tunnel upstream; dedicated devnet demo access is server-gated."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request, urllib.error

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def do_GET(self): self.forward()
    def do_POST(self): self.forward()
    def do_PUT(self): self.forward()
    def do_PATCH(self): self.forward()
    def do_DELETE(self): self.forward()
    def forward(self):
        path = self.path.split('?')[0]
        if '..' in path or not (path == '/' or path.startswith(('/api/', '/_astro/', '/images/'))):
            self.send_error(404); return
        size = int(self.headers.get('Content-Length', '0'))
        if size > 1000000: self.send_error(413); return
        data = self.rfile.read(size) if self.command not in ('GET', 'HEAD') else None
        headers = {'Host':'pos.cashlessthailand.com', 'X-Forwarded-Host':'pos.cashlessthailand.com', 'X-Forwarded-Proto':'https'}
        for name in ('Content-Type', 'Authorization', 'Origin', 'Cookie'):
            if self.headers.get(name): headers[name] = self.headers[name]
        req = urllib.request.Request('http://127.0.0.1:4321'+self.path, data=data, headers=headers, method=self.command)
        try: res = urllib.request.urlopen(req, timeout=35)
        except urllib.error.HTTPError as error: res = error
        except Exception: self.send_error(502); return
        with res:
            body = res.read(); self.send_response(res.status)
            for name in ('Content-Type', 'Content-Encoding', 'Set-Cookie'):
                if res.headers.get(name): self.send_header(name, res.headers[name])
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers(); self.wfile.write(body)

ThreadingHTTPServer(('127.0.0.1',4324),Handler).serve_forever()
