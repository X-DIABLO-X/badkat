"""Recover the geometry of a three-arc anger mark from a reference image.

Each arm of the symbol is an annular segment: the set of points whose
distance from some centre C falls between rIn and rOut. So for one arm,
the correct C is the point that makes every one of its pixels the SAME
distance away -- i.e. the C that minimises the variance of those
distances. Solve that per arm and the rest falls out: the radii are the
min and max of the distances, and the angular span is the range of
bearings from C.

The one number that matters most is where C lands. A centre INSIDE the
symbol means the arm curves around the middle (a broken ring); a centre
OUTSIDE means the arm bulges toward the middle, which is the shape the
reference actually uses.

Usage:  python tools/fit-anger-arcs.py <image.png>
"""
import sys
import math
import numpy as np
from PIL import Image


def load_mask(path):
    """Red, reasonably opaque pixels -- the arcs minus their black border."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.int16)
    r, g, b, alpha = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    return (alpha > 128) & (r > 110) & (r - g > 55) & (r - b > 55)


def components(mask):
    """Flood-fill the mask into connected blobs, largest first."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            stack, blob = [(sy, sx)], []
            seen[sy, sx] = True
            while stack:
                y, x = stack.pop()
                blob.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            out.append(np.array(blob))
    out.sort(key=len, reverse=True)
    return out


def fit_centre(pts):
    """Centre minimising the variance of the distances to it.

    Coarse grid over a wide box (the answer can sit well outside the
    image), then repeatedly refine around the best cell.
    """
    ys, xs = pts[:, 0].astype(float), pts[:, 1].astype(float)
    cy, cx = ys.mean(), xs.mean()
    span = max(np.ptp(ys), np.ptp(xs)) * 3.0
    best = (cx, cy)
    for _ in range(9):
        step = span / 12.0
        grid = [(best[0] + i * step, best[1] + j * step)
                for i in range(-6, 7) for j in range(-6, 7)]
        scored = []
        for gx, gy in grid:
            d = np.hypot(xs - gx, ys - gy)
            scored.append((d.var(), gx, gy))
        _, bx, by = min(scored)
        best, span = (bx, by), span / 4.0
    return best


def describe(pts, cx, cy, ox, oy):
    xs, ys = pts[:, 1].astype(float), pts[:, 0].astype(float)
    d = np.hypot(xs - cx, ys - cy)
    # bearings from the arc's own centre, in maths convention (y flipped)
    ang = np.degrees(np.arctan2(-(ys - cy), xs - cx)) % 360.0
    # unwrap so a span crossing 0 does not read as a full turn
    srt = np.sort(ang)
    gaps = np.diff(np.concatenate([srt, srt[:1] + 360.0]))
    start = srt[(np.argmax(gaps) + 1) % len(srt)]
    rel = (ang - start) % 360.0
    return {
        "centre": (cx, cy),
        "centre_from_symbol": (cx - ox, cy - oy),
        "centre_dist": math.hypot(cx - ox, cy - oy),
        "r_in": float(d.min()),
        "r_out": float(d.max()),
        "thickness": float(d.max() - d.min()),
        "arc_start": float(start),
        "arc_span": float(rel.max()),
        "px": len(pts),
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = sys.argv[1]
    mask = load_mask(path)
    if not mask.any():
        print("no red pixels found -- check the image")
        return 1

    blobs = [b for b in components(mask) if len(b) > mask.sum() * 0.05]
    ally = np.concatenate([b[:, 0] for b in blobs]).astype(float)
    allx = np.concatenate([b[:, 1] for b in blobs]).astype(float)
    ox, oy = allx.mean(), ally.mean()          # centre of the whole symbol
    extent = max(np.ptp(allx), np.ptp(ally)) / 2.0

    print(f"image            : {path}  ({mask.shape[1]}x{mask.shape[0]})")
    print(f"arms found       : {len(blobs)}")
    print(f"symbol centre    : ({ox:.1f}, {oy:.1f})   half-extent {extent:.1f}px")
    print()

    for i, blob in enumerate(blobs):
        cx, cy = fit_centre(blob)
        info = describe(blob, cx, cy, ox, oy)
        dx, dy = info["centre_from_symbol"]
        bearing = math.degrees(math.atan2(-dy, dx)) % 360.0
        side = "OUTSIDE" if info["centre_dist"] > extent else "inside"
        print(f"arm {i}  ({info['px']} px)")
        print(f"  curvature centre : ({cx:7.1f},{cy:7.1f})  "
              f"{info['centre_dist']:6.1f}px from symbol centre  -> {side}")
        print(f"  bearing of centre: {bearing:6.1f} deg")
        print(f"  radii            : rIn {info['r_in']:.1f}  rOut {info['r_out']:.1f}  "
              f"(band {info['thickness']:.1f}px)")
        print(f"  arc span         : {info['arc_span']:.1f} deg "
              f"from {info['arc_start']:.1f}")
        # everything again, normalised so the symbol's half-extent is 10 units
        s = 10.0 / extent
        print(f"  in rig units     : centreDist {info['centre_dist']*s:.2f}  "
              f"rIn {info['r_in']*s:.2f}  rOut {info['r_out']*s:.2f}  "
              f"band {info['thickness']*s:.2f}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
