"""Render a three-arc mark with KNOWN geometry, to check the fitter.

Draws the centres-outside construction directly into a pixel mask, so
fit-anger-arcs.py can be run against it and its answers compared with
the numbers fed in here.

Usage:  python tools/make-test-arcs.py <out.png>
"""
import sys
import math
import numpy as np
from PIL import Image

SIZE = 400
ORIGIN = SIZE / 2.0

# the construction under test: each arm's centre of curvature sits
# OUTSIDE the symbol, on the arm's own bearing, so the arm bulges inward
CENTRE_DIST = 150.0     # how far out each arm's centre of curvature sits
R_IN = 65.0             # radius from that centre to the arm's far edge
R_OUT = 115.0           # radius to the arm's near edge (closest to middle)
HALF_SPAN = 48.0        # degrees either side of the inward direction
ARMS = [150.0, 270.0, 30.0]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "test-arcs.png"
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(float)
    mask = np.zeros((SIZE, SIZE), dtype=bool)

    for bearing in ARMS:
        a = math.radians(bearing)
        cx = ORIGIN + CENTRE_DIST * math.cos(a)
        cy = ORIGIN - CENTRE_DIST * math.sin(a)
        d = np.hypot(xs - cx, ys - cy)
        ang = np.degrees(np.arctan2(-(ys - cy), xs - cx))
        inward = (bearing + 180.0) % 360.0
        off = (ang - inward + 180.0) % 360.0 - 180.0
        mask |= (d >= R_IN) & (d <= R_OUT) & (np.abs(off) <= HALF_SPAN)

    rgba = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    rgba[mask] = (226, 88, 79, 255)
    Image.fromarray(rgba, "RGBA").save(out)

    print(f"wrote {out}")
    print(f"  expected centre distance : {CENTRE_DIST}")
    print(f"  expected radii           : rIn {R_IN}  rOut {R_OUT}")
    print(f"  expected arc span        : {HALF_SPAN * 2}")
    print(f"  expected centre bearings : {ARMS}")


if __name__ == "__main__":
    main()
