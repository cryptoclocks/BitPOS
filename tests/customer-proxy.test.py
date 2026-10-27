"""Real HTTP allowlist regression; disposable upstreams, no product data."""
import http.server
import pathlib
import threading
import unittest
import urllib.error
import urllib.request


class CustomerProxyTest(unittest.TestCase):
    def test_menu_read_only_and_explicit_session_use_origin(self):
        seen = []

        class Upstream(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.respond()

            def do_POST(self):
                self.respond()

            def respond(self):
                seen.append((self.path, self.command, self.headers.get('Origin')))
                body = b'{}'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        source = (pathlib.Path(__file__).resolve().parents[1] / 'infra/oci/customer-proxy.py').read_text()
        # Only redirect network endpoints; execute the actual production Handler.
        source = source.rsplit('ThreadingHTTPServer(', 1)[0]
        for port in (3001, 4321):
            source = source.replace(f'127.0.0.1:{port}', f'127.0.0.1:{upstream.server_port}')
        namespace = {}
        exec(compile(source, 'customer-proxy.py', 'exec'), namespace)
        proxy = http.server.ThreadingHTTPServer(('127.0.0.1', 0), namespace['Handler'])
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (upstream, proxy)]
        for thread in threads:
            thread.start()
        token = 'x' * 43
        cases = [
            (f'/pay/{token}/menu', 'GET', None, 200),
            (f'/api/pay/{token}/menu', 'GET', None, 200),
            (f'/pay/{token}/menu', 'POST', None, 405),
            (f'/api/pay/{token}/menu', 'POST', None, 405),
            (f'/api/pay/{token}/customer/use', 'GET', None, 405),
            (f'/api/pay/{token}/customer/use', 'POST', None, 403),
            (f'/api/pay/{token}/customer/use', 'POST', 'https://customer.example', 200),
            (f'/api/pay/{token}/customer/use-more', 'POST', 'https://customer.example', 404),
        ]
        try:
            for path, method, origin, expected in cases:
                with self.subTest(path=path, method=method, origin=origin):
                    request = urllib.request.Request(
                        f'http://127.0.0.1:{proxy.server_port}' + path,
                        data=b'{}' if method == 'POST' else None,
                        method=method, headers={'Origin': origin} if origin else {})
                    try:
                        with urllib.request.urlopen(request, timeout=5) as response:
                            status = response.status
                    except urllib.error.HTTPError as error:
                        status = error.code
                    self.assertEqual(status, expected)
            self.assertEqual(seen, [(cases[i][0], cases[i][1], cases[i][2]) for i in (0, 1, 6)])
        finally:
            for server in (proxy, upstream):
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
