from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote,urlsplit
ROOT=Path(__file__).resolve().parent.parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def do_GET(self):
        p=unquote(urlsplit(self.path).path).lstrip('/')
        resolved=(ROOT/p).resolve()
        allowed=p in ('','START-HERE.html','README.md') or p.split('/')[0] in ('team-guide','devnet','docs')
        if not allowed or not resolved.is_relative_to(ROOT) or any(x.startswith('.') for x in Path(p).parts):
            self.send_error(404);return
        super().do_GET()
    def do_HEAD(self):
        self.do_GET()
ThreadingHTTPServer(('127.0.0.1',8767),Handler).serve_forever()
