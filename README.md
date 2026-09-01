# Bad Cat

**A desktop cat that closes your doomscrolling.**

[badkat.cypherion.tech](https://badkat.cypherion.tech) · [Download](https://github.com/X-DIABLO-X/badcat/releases/latest) · [Report a bug](https://github.com/X-DIABLO-X/badcat/issues)

Bad Cat lives along the bottom of your screen. It watches whatever window is in
front of you, and when Shorts, Reels, TikTok or a streaming site holds the
foreground for longer than you allowed it, the cat gets up, walks over, and taps
the window closed with one paw.

Click it during the countdown and it relents. Pick it up and it dangles, then
falls when you let go. Close enough windows and it levels up.

Windows 10 and 11. Installs to your user folder, so it needs no admin rights,
and it updates itself from inside the app.

---

## Install

Download the installer from the [latest release](https://github.com/X-DIABLO-X/badcat/releases/latest)
and run it.

Windows SmartScreen will warn you the first time, because the installer is not
code-signed — a certificate costs more than this project has. Choose
*More info → Run anyway*, or build it yourself from the source below.

Once installed it checks for its own updates and installs them from the
**Updates** panel in settings; you should not need to come back here.

## Build from source

Needs [Rust](https://rustup.rs) and [Node](https://nodejs.org) 20+, plus the
Visual Studio C++ build tools that Tauri requires on Windows.

```bash
cd badcat
npm install
npm start          # run it
npm run build      # produce the installer in src-tauri/target/release/bundle
```

## What it actually does

Every second it reads the foreground window's **URL**, **title** and **process
name**. Nothing leaves your machine — there is no account, no telemetry and no
network call except the update check.

Each rule gets its own leash, because not all of it is the same problem:

| Rule | Grace |
| --- | --- |
| YouTube Shorts, Instagram Reels, TikTok | 6s |
| Facebook Reels | 10s |
| Streaming sites | 20s |
| Instagram proper | 45s |
| Reddit | 90s |
| Ordinary YouTube | 240s |

A browser only ever exposes the site's own title, so Reels reads as just
"Instagram" and a Short as "*name* - YouTube" — the words `reels` and `shorts`
exist only in the URL. But a browser playing fullscreen video drops its address
bar entirely, so the URL goes blank exactly while you watch a film. Both are
matched for that reason. The **Live view** panel shows the exact text your
patterns run against, which is the only honest answer to "why didn't it fire?"

Anything on the **Never touch** list is left alone whatever else it matches.

## Levels

Closing a window earns 25 XP; a pat earns 5, rate-limited so leaning on the cat
does not farm it. Each level costs more than the last (50, 65, 80, 105, 135, …),
so level 2 arrives after two closes and level 10 after about seventy.

Progress is stored in its own `progress.json`, separate from settings, so
changing a slider or restoring defaults can never cost the cat its levels.

## Repository layout

| Path | What lives there |
| --- | --- |
| `badcat/` | the Tauri app — Rust backend in `src-tauri/`, dashboard in `src/` |
| `site/` | the landing page at badkat.cypherion.tech |
| `js/`, `css/` | the canonical cat rig, copied into the app and the site by `sync-assets.mjs` |
| `index.html` | a demo stage for looking at the character on its own |
| `tools/` | small analysis scripts (see `fit-anger-arcs.py`) |
| `desktop/` | the original Electron prototype, superseded by `badcat/` |

The rig lives at the repo root and is **copied** into both surfaces by
`badcat/scripts/sync-assets.mjs` rather than referenced, so the cat on the
website cannot quietly fall a version behind the cat in the product.

---

# The animation rig

The rest of this is about how the character is built. One rig drives every
surface: each state is a full set of path keyframes, and every transition is a
real shape morph — nothing is swapped out or cross-faded.

Run the demo stage with any static server:

```bash
python -m http.server 5178
```

Controls: the six buttons or keys `1`–`6`. Clicking the cat pats it — except a
sleeping cat, which wakes up cross.

## How the rig is put together

```
#cat
  #shadow                     soft ellipse, scaled per pose
  #legBF #legFF               far legs — a darker cream, so they read as depth
  #bodyGroup                  bobs and breathes
    #tail  #body
  #legBN #legFN               near legs
  #headBob > #headGroup       bob offset outside, pose transform inside
    #head #earL #earR #eyeL #eyeR #mouth
  #anger #pawprint #levelup #xpFloat #hearts #zzz
                              props, only shown by the states that use them
```

The head is a separate shape drawn over the body in the same fill, so the two
read as one silhouette while staying independently animatable. `#headBob` exists
purely so the idle bob (`y`) never fights the pose placement (`x`/`y`/`rotation`)
on `#headGroup` — two translate channels on one element would overwrite each
other.

Element ids are defined in exactly one place (`js/cat-rig.js`) and resolved in
`init()` rather than at load, so script order does not matter. It also means the
rig can only be mounted **once per page**: mount it twice and the controller has
two `#cat` elements to choose between and will drive the wrong one.

## Why the poses are point arrays, not path strings

Hand-written path data makes morphing fragile: mismatched segment counts force
MorphSVG to redistribute points, and mismatched start points make shapes spin
on their way across.

So each pose is authored as a list of `[x, y, tension]` anchors and converted to
cubics by a Catmull-Rom spline in `buildPath()`:

```js
walk: {
  body: [[136, 68, 1], [112, 59, 1], [84, 59, 1], ...],
  ...
}
```

Every pose of a given part uses the **same number of anchors in the same order**,
so point *n* of the sitting body is point *n* of the sleeping body. MorphSVG then
gets a clean 1:1 correspondence and needs no `shapeIndex` at all.

`tension` is the per-point smoothing factor: `1` rounds the corner, `0` makes it
sharp. Ear tips sit at `0.16`, which is what gives them a point while the rest of
the head stays soft. The angry pose reuses the same dial on three spine anchors
(`0.26`–`0.30`) so the back corners into hackles instead of rounding.

Coordinates: body, tail and legs are in scene space; head, ears, eyes and mouth
are in head-local space (origin at the head's centre) and get positioned by the
`#headGroup` transform.

### Ear construction

The head silhouette is 10 points. Points 9-0-1 form the left ear and 1-2-3 the
right, and **both ears share point 1 (the valley) as an inner base**. That shared
point is what makes ears easy to get wrong: park the valley off-centre and one
ear ends up materially wider than the other, with mismatched lean. So the valley
sits at `x = -2`, near the head's centreline, which gives the two ears bases of
29 and 31 units. Each tip is then placed ~3.5 units outboard of the middle of its
own base — that single offset is the entire outward lean, and it is equal on both
sides.

Inner ears are not drawn freehand. Each is its own outer-ear triangle inset 35%
toward that triangle's centroid, so it stays square inside the ear in every pose.

## The walk cycle

Legs are 3-point open strokes (hip → knee → paw) with round caps, so a leg is
just a thick line and its "shape" is trivial to keyframe.

`legFrame(cfg, phase)` computes one frame from a phase 0–1: for the first 62% of
the stride the paw slides straight backwards along the floor, then it arcs
forward through the air on a smoothstep, lifting by `lift`. The knee is placed
along the hip→paw line with a perpendicular offset that peaks when the leg is
vertical, which is what makes it look jointed rather than rubbery.

Eight frames per limb are baked to path strings once at load. Each limb reads the
same table at a different `offset` — `0`, `0.25`, `0.5`, `0.75` — which is a
four-beat gait, the diagonal sequence a real cat uses at a walk.

The loop timeline runs **two** strides — sixteen chained morphs per limb at
`ease: "none"`, with frame 8 wrapping back to frame 0 so there is no seam. It
also adds two body bobs per stride and counter-rotates the head slightly. The
two-stride span exists for the tail, below.

Ground speed is derived from the gait rather than guessed:

```js
UNITS_PER_SEC = (2 * reach) / (WALK_FRAMES * CYCLE_STEP)
```

so the paws stay planted instead of ice-skating. The legs deliberately do **not**
bob with the body — only `#bodyGroup` and `#headBob` move — which keeps the
planted paws pinned to the floor. The hips stay covered by the body silhouette,
so the offset never shows.

## The tail

A rigid rotation about the tail root — swing the whole thing one way, then the
other — reads as a metronome: it stalls at each extreme and the tip moves in
lockstep with the base. `tailWave()` fixes both problems at once. Every point
rides the same sine, but delayed by `lag` per unit of length:

```js
a = amp * w * w * Math.sin(2 * Math.PI * (phase - lag * w))
```

The `w²` term keeps the root planted and lets the tip travel furthest; the
`- lag * w` term is the delay that makes the tip trail the base, which is what
reads as weight. Sampling it at 16 phases gives frames that chain end-to-end
under `ease: "none"`, and because phase 1 is phase 0 the loop has no seam. The
walking tail runs one wave per **two** strides, so it reads slower and heavier
than the legs rather than buzzing along with them.

`swayTail()` — the old rigid rotation — is still used where a tail genuinely
should snap: the sit flick, the angry lash, the bored thump.

## The states

**sit** — upright teardrop body, tail sweeping out to the side with the tip
lifting, front paws just clearing the chest. The idle is a slow breath plus a
lazy two-beat tail flick.

**sleep** — a flat loaf, ears dropped, tail wrapped around the front, eyes
morphed to closed lids, and the back legs tucked inside the silhouette. The
breath is deeper and slower, and three `z`s drift up from the head. The `z`s are
the only glyphs in the rig, so they are the only thing a mirror breaks: facing
left sets `scaleX: -1` on `#cat`, which is right for every body part and
backwards for text, so each `z` carries a counter-flip of its own.

**pat** — the cat squashes twice a cycle under an unseen hand. The head
compresses and springs back on `elastic.out`, the ears fold and pop up, the body
gives, and a heart lifts off on each contact while the tail wags two full wave
periods. There is no hand drawn: the rhythm of the squash carries it, and a grey
mitten in this flat style read as a hat sitting on the cat's head.

**angry** — the same four-beat gait as `walk` run ~1.8× faster, with the head
dropped, the ears pinned flat, eyes narrowed to slits rotated 19° so the inner
corners drive down, the tail held out stiff behind, and a 💢 anger mark popping
and throbbing over the brow.

The 💢 is three arc bands. The thing that makes it read correctly is that each
arc's **centre of curvature sits outside the symbol**, on that arm's own bearing,
so the arms bow *inward* and their tips splay out — the three gaps between them
then form a three-way junction. Concentric arcs sharing one centre in the middle
curve the other way and just read as a broken ring.
[`tools/fit-anger-arcs.py`](tools/fit-anger-arcs.py) recovers that geometry from
a reference image by fitting, per arm, the centre that makes its pixels
equidistant — and reports whether that centre lands inside or outside, which is
the one measurement that separates the two constructions.

**bored** — slumped flat, front legs shoved forward, ears at half mast, eyes
half-lidded. The head sinks and jerks back up twice a cycle on `back.out`, and the
tail lifts and drops in two listless thumps.

**confront / swipe** — the close animation. The cat plants on all fours, holds
the glare through the countdown, then one foreleg cocks, whips forward and lands.
The window is closed on the exact contact frame, so the tap reads as the thing
that did it, and a pale paw print pops where it struck.

Every eye state is the same 6-point ring sampled the same way — open, closed,
happy, angry, bored — so any expression melts into any other with no popping, and
a blink is one morph to `closed` and back to whatever the current pose asks for.

## Details worth knowing

- **Blinks** fire on a random 2.4–6.5s timer and occasionally double up — but
  only in states whose eyes are `open` or `bored` (a bored blink is slower). An
  angry cat does not blink. **Ear twitches** reuse the current head pose with the
  right ear tip nudged, then spring back on `elastic.out`, so they work in any
  state without extra art.
- **Turning around**: at the end of a lap the cat tweens `scaleX` from `1` to
  `-1`, passing through zero. It reads as a 2D sprite pivoting in place.
- **State changes kill their own timelines.** A pose morph is a timeline, and
  killing its child tweens still leaves the timeline to run out its duration and
  fire `onComplete` — which is how a superseded pose used to start the *previous*
  state's walk cycle underneath the new one's body, leaving the cat sitting and
  walking at once. Pose and one-shot timelines are tracked and killed, and a
  generation counter makes late callbacks bail.
- **Layering**: the tail sits inside `#bodyGroup` *before* `#body`, so it is
  always behind the cat. Poses route the tail outside the body silhouette on
  purpose — a tail hidden under the body just reads as a missing tail.
- **Graceful degradation**: if `MorphSVGPlugin` fails to load, `morph()` falls
  back to setting `d` directly at the end of each tween. Poses snap instead of
  flowing, but nothing breaks, and the page says so in the corner of the stage.

## Adding a state

1. Add an entry to `POSES` in `js/cat-shapes.js`. Copy the closest existing pose
   and move the anchors — keep the count and the order identical.
2. Add a loop function in `js/cat.js` and register it in `LOOPS`.
3. Add a button with `data-state="yourstate"` in `index.html`, and a key in the
   `map` in `js/main.js`.

A pose with `gait: true` reuses the walk cycle and the roam instead of a static
leg pose, with `tempo` scaling both together — that is all `angry` is.

Nothing else needs to change; the pose morphs are driven entirely off the table.

## Licence

MIT — see [LICENSE](LICENSE).
