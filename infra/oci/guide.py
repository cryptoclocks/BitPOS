"""Serve only offline team-guide public assets; never repository/private files."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, unquote
import mimetypes, re
ROOT = Path(__file__).resolve().parents[2] / 'team-guide'
ALLOWED = {'.html','.css','.js','.svg','.png','.webp','.jpg','.jpeg','.gif','.ttf','.woff','.woff2','.ico'}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self): self.serve()
    def do_HEAD(self): self.serve(head=True)
    def serve(self,head=False):
        path=unquote(urlsplit(self.path).path)
        if any(part.startswith('.') or part=='..' for part in path.split('/') if part): self.send_error(404); return
        candidate=ROOT / path.lstrip('/')
        if path.endswith('/'): candidate=candidate/'index.html'
        target=candidate.resolve()
        if not target.is_relative_to(ROOT.resolve()) or not target.is_file() or target.suffix.lower() not in ALLOWED: self.send_error(404); return
        data=target.read_bytes()
        if target.suffix=='.html':
            text=data.decode('utf-8')
            # Source documentation/devnet are intentionally not exposed by this host.
            text=re.sub(r'href="\.\./(?:docs|devnet)/[^"]+"', 'aria-disabled="true" title="Available in the offline project folder"', text)
            data=text.encode('utf-8')
        mime=mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        self.send_response(200);self.send_header('Content-Type',mime+('; charset=utf-8' if target.suffix in {'.html','.css','.js','.svg'} else ''))
        self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-cache');self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
        if not head:self.wfile.write(data)
ThreadingHTTPServer(('127.0.0.1',4325),Handler).serve_forever()
