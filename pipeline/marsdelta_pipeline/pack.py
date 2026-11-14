"""Build demo-pack/: the built static site + a tiny server + instructions, zipped."""
from __future__ import annotations

import shutil
import zipfile

from .common import ROOT

README = """MarsDelta offline demo pack
===========================
1. Unzip anywhere.
2. Start a local web server in this folder (needed for the offline cache; file:// will not register it):
     python3 serve.py            (or: python -m http.server 8080)
3. Open http://localhost:8080/ once while the server runs. The service worker caches the
   whole app and every evidence bundle (status pill shows "cached for offline").
4. Airplane mode: the app keeps working from the cache; reload works too.
Contents are historical NASA/USGS/LMD data plus precomputed MarsDelta evidence; see Sources in the app.
"""
SERVE = """import http.server, socketserver, os
os.chdir(os.path.dirname(os.path.abspath(__file__)) + '/site')
h = http.server.SimpleHTTPRequestHandler
h.extensions_map.update({'.webmanifest': 'application/manifest+json', '.js': 'text/javascript'})
with socketserver.TCPServer(('127.0.0.1', 8080), h) as s:
    print('MarsDelta at http://localhost:8080/  (Ctrl+C to stop)'); s.serve_forever()
"""


def main():
    dist = ROOT / "web" / "dist"
    if not (dist / "index.html").exists():
        raise SystemExit("run `npm run build` in web/ first")
    out = ROOT / "demo-pack"
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(dist, out / "site")
    (out / "README.txt").write_text(README)
    (out / "serve.py").write_text(SERVE)
    z = ROOT / "demo-pack.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in out.rglob("*"):
            zf.write(f, f.relative_to(out.parent))
    print(f"demo pack: {z} ({z.stat().st_size / 1e6:.1f} MB)")
