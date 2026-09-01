"""Tiny static server for local development.

Identical to `python -m http.server` except that it sends no-store, so the
browser never serves a stale cat-shapes.js while you are iterating on poses.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):        # keep the console readable
        if "304" not in (args[1] if len(args) > 1 else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
    print("serving http://localhost:%d" % port)
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
