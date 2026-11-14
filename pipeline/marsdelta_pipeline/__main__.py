"""CLI: python -m marsdelta_pipeline <command>

  fetch-process   everything below in order (downloads ~2.6 GB on first run; later runs reuse files)
  nili            Nili Patera: download HiRISE pair + NASA PIA products, run change pipeline
  nili-process    re-run Nili processing only (observations already downloaded)
  jezero          Jezero corridor: DTM/ortho range reads, waypoints, geology, ground photos
  dust            LMD regional dust cells for both areas
  meda            parse MEDA CSV + PDS4 labels from data/raw/meda (writes 'unavailable' status if none)
  validate        provenance and data-integrity checks (non-zero exit on failure)
  pack            build the offline demo pack (needs `npm run build` in web/ first)
"""
import sys


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "fetch-process"
    if cmd in ("nili", "fetch-process"):
        from . import nili; nili.main("all")
    if cmd == "nili-process":
        from . import nili; nili.main("process")
    if cmd in ("jezero", "fetch-process"):
        from . import jezero, photos; jezero.main(); photos.main()
    if cmd in ("dust", "fetch-process"):
        from . import dust; dust.main()
    if cmd in ("meda", "fetch-process"):
        from . import meda; meda.main()
    if cmd in ("validate", "fetch-process"):
        from . import validate; rc = validate.main()
        if rc:
            sys.exit(rc)
    if cmd == "pack":
        from . import pack; pack.main()
    if cmd in ("-h", "--help", "help"):
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv)
