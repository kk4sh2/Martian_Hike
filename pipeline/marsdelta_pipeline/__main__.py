"""CLI: python -m marsdelta_pipeline <command>

Commands
  fetch            download every source listed in the manifest plan (large: ~2.3 GB HiRISE)
  nili             Nili Patera change pipeline (fetch + process)
  nili-process     re-run processing only on already downloaded observations
  jezero           Jezero terrain/ortho corridor extraction, waypoints, photos
  meda             parse MEDA CSV + label files placed in data/raw/meda
  routes           compute route options / metrics for both areas
  validate         run data and provenance checks
  pack             build the limited-size offline demo pack
  all              everything in order
"""
import sys


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "all"
    if cmd in ("nili", "fetch", "all"):
        from . import nili
        nili.main("all")
    if cmd == "nili-process":
        from . import nili
        nili.main("process")
    if cmd in ("jezero", "fetch", "all"):
        from . import jezero
        jezero.main()
    if cmd in ("meda", "all"):
        from . import meda
        meda.main()
    if cmd in ("routes", "all"):
        from . import routes
        routes.main()
    if cmd in ("validate", "all"):
        from . import validate
        sys.exit(validate.main())
    if cmd == "pack":
        from . import pack
        pack.main()


if __name__ == "__main__":
    main(sys.argv)
