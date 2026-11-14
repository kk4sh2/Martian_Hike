"""Global Mars basemap for the 3D globe: Viking MDIM 2.1 colour mosaic from NASA Mars Trek, stitched at zoom 3.

Trek's equirectangular tile matrix has 2^(z+1) columns x 2^z rows of 256 px tiles, so zoom 3 gives 4096 x 2048 px
(about 5.3 km per pixel at the equator). Simple cylindrical, planetocentric, 180 W to 180 E, 90 N to 90 S.
"""
from __future__ import annotations

from PIL import Image

from .common import RAW, WEB_DATA, download, record_source, sha256, now_iso

LAYER = "Mars_Viking_MDIM21_ClrMosaic_global_232m"
TILE = f"https://trek.nasa.gov/tiles/Mars/EQ/{LAYER}/1.0.0/default/default028mm/{{z}}/{{row}}/{{col}}.jpg"
Z = 3


def main():
    cols, rows = 2 ** (Z + 1), 2 ** Z
    out = Image.new("RGB", (cols * 256, rows * 256))
    for r in range(rows):
        for c in range(cols):
            dest = RAW / "globe" / f"z{Z}_{r}_{c}.jpg"
            download(TILE.format(z=Z, row=r, col=c), dest)
            out.paste(Image.open(dest).convert("RGB"), (c * 256, r * 256))
    path = WEB_DATA / "globe" / "mars_viking_color_4k.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, quality=86, optimize=True)
    record_source("globe_viking_mdim21", url=TILE.replace("{z}", str(Z)), resolved_url="https://trek.nasa.gov/mars/",
                  local_path=str(path.relative_to(RAW.parent.parent)), bytes=path.stat().st_size, sha256=sha256(path),
                  retrieved=now_iso(), credit="NASA/JPL-Caltech/USGS (Viking MDIM 2.1), via NASA Mars Trek",
                  product_id=LAYER, purpose=f"Global basemap for the 3D globe ({cols}x{rows} tiles at zoom {Z}, stitched)")
    print(f"globe: {path} {out.size} {path.stat().st_size/1e6:.1f} MB")


if __name__ == "__main__":
    main()
