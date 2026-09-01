/* ------------------------------------------------------------------
   cat-shapes.js — geometry layer
   ------------------------------------------------------------------
   Every pose of every body part is authored as an array of points
   [x, y, tension] and converted to a cubic path with a Catmull-Rom
   spline. Because each pose of a given part uses the SAME number of
   points in the SAME order, MorphSVG gets a perfect 1:1 point
   correspondence — no shapeIndex hunting, no rotation artifacts.

   tension: 1 = fully smooth, 0 = hard corner (ear tips, angry hackles).
------------------------------------------------------------------ */
(function (global) {
  "use strict";

  var R = function (n) { return Math.round(n * 100) / 100; };
  var RAD = Math.PI / 180;

  /* Catmull-Rom -> cubic bezier. `closed` wraps the point list. */
  function buildPath(points, closed) {
    var n = points.length;
    if (n < 2) { return "M0,0"; }
    var at = function (i) {
      return closed
        ? points[(i % n + n) % n]
        : points[Math.min(n - 1, Math.max(0, i))];
    };
    var ten = function (p) { return p.length > 2 ? p[2] : 1; };

    var d = "M" + R(points[0][0]) + "," + R(points[0][1]);
    var segs = closed ? n : n - 1;

    for (var i = 0; i < segs; i++) {
      var p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      var k1 = ten(p1) / 6, k2 = ten(p2) / 6;
      d += "C" +
        R(p1[0] + (p2[0] - p0[0]) * k1) + "," + R(p1[1] + (p2[1] - p0[1]) * k1) + " " +
        R(p2[0] - (p3[0] - p1[0]) * k2) + "," + R(p2[1] - (p3[1] - p1[1]) * k2) + " " +
        R(p2[0]) + "," + R(p2[1]);
    }
    return closed ? d + "Z" : d;
  }

  var closedPath = function (pts) { return buildPath(pts, true); };
  var openPath = function (pts) { return buildPath(pts, false); };

  /* rotate a point list about an arbitrary centre, keeping tensions */
  function rotate(pts, deg, cx, cy) {
    var a = deg * RAD, cos = Math.cos(a), sin = Math.sin(a);
    return pts.map(function (p) {
      var dx = p[0] - cx, dy = p[1] - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos, p.length > 2 ? p[2] : 1];
    });
  }

  /* ---------- eyes ------------------------------------------------ */
  /* Every eye state is a 6-point ring sampled the same way, so any
     expression can melt into any other without popping.             */
  function ring(cx, cy, rx, ry, n) {
    n = n || 6;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a), 1]);
    }
    return pts;
  }

  /* ring indices: 0 top · 1,2 right edge · 3 bottom · 4,5 left edge */
  function bowEnds(pts, amount) {
    [1, 2, 4, 5].forEach(function (i) { pts[i][1] += amount; });
    return pts;
  }

  function eyeOpen(cx, cy) { return ring(cx, cy, 3.7, 4.5); }
  function eyeClosed(cx, cy) { return bowEnds(ring(cx, cy + 1.1, 5.2, 1.0), 2.0); }
  function eyeHappy(cx, cy) { return bowEnds(ring(cx, cy + 1.8, 5.6, 1.0), 3.6); }

  /* angry: a narrow lens tilted so the inner corner drives downward */
  function eyeAngry(cx, cy, inward) {
    return rotate(ring(cx, cy + 0.4, 4.3, 2.5), 19 * inward, cx, cy);
  }

  /* bored: lid dropped over the top half, leaving a flat-topped dome */
  function eyeBored(cx, cy) {
    var p = ring(cx, cy + 1.4, 3.7, 2.6);
    p[0][1] += 1.5; p[1][1] += 0.7; p[5][1] += 0.7;
    return p;
  }

  /* ---------- mouths (open 5-point strokes) ----------------------- */
  var MOUTH = {
    smile: [[-5, 10], [-2.5, 13], [0, 10.6], [2.5, 13], [5, 10]],
    grin: [[-6.5, 9.4], [-3, 14.4], [0, 10.4], [3, 14.4], [6.5, 9.4]],
    soft: [[-4, 11.4], [-2, 12.4], [0, 12.7], [2, 12.4], [4, 11.4]],
    frown: [[-5.5, 13.6], [-2.6, 9.9], [0, 9.3], [2.6, 9.9], [5.5, 13.6]],
    snarl: [[-6.5, 14.6], [-3, 9.6], [0, 8.8], [3, 9.6], [6.5, 14.6]],
    flat: [[-5, 11.6], [-2.5, 11.9], [0, 12], [2.5, 11.9], [5, 11.6]]
  };

  /* ---------- procedural walk cycle ------------------------------- */
  /* A leg is a 3-point open stroke: hip -> knee -> paw. The paw
     traces a "D": a straight push along the floor, then an arc back
     through the air. `phase` is 0..1 through one stride.            */
  var STANCE = 0.62;

  function legFrame(cfg, phase) {
    var ph = ((phase % 1) + 1) % 1;
    var hx = cfg.hip[0], hy = cfg.hip[1];
    var px, py, t, s;

    if (ph < STANCE) {                       // planted, sliding backwards
      t = ph / STANCE;
      px = cfg.reach * (1 - 2 * t);
      py = cfg.len;
    } else {                                 // lifted, swinging forwards
      t = (ph - STANCE) / (1 - STANCE);
      s = t * t * (3 - 2 * t);               // smoothstep so the swing eases
      px = -cfg.reach + 2 * cfg.reach * s;
      py = cfg.len - cfg.lift * Math.sin(Math.PI * t);
    }

    // knee bends most when the leg is vertical, straightens at the extremes
    var straight = 1 - Math.min(1, Math.abs(px) / (cfg.reach || 1));
    var bend = cfg.bend * (0.55 + 0.75 * straight);

    return [
      [hx, hy],
      [hx + px * 0.45 + bend, hy + py * 0.5],
      [hx + px, hy + py]
    ];
  }

  /* 4-beat gait: the four limbs are evenly offset through one stride */
  var GAIT = {
    fn: { hip: [124, 94], reach: 9, len: 36, lift: 8, bend: 2.8, offset: 0.00 },
    ff: { hip: [114, 95], reach: 9, len: 36, lift: 8, bend: 2.8, offset: 0.50 },
    bn: { hip: [68, 94], reach: 10, len: 36, lift: 8, bend: -3.4, offset: 0.25 },
    bf: { hip: [58, 95], reach: 10, len: 36, lift: 8, bend: -3.4, offset: 0.75 }
  };

  var WALK_FRAMES = 8;

  /* pre-bake every frame of every leg once at load */
  var walkCycle = {};
  Object.keys(GAIT).forEach(function (key) {
    var cfg = GAIT[key];
    var frames = [];
    for (var i = 0; i < WALK_FRAMES; i++) {
      frames.push(openPath(legFrame(cfg, i / WALK_FRAMES + cfg.offset)));
    }
    walkCycle[key] = frames;
  });

  /* ---------- tail motion ----------------------------------------- */
  /* swayTail: one rigid rotation about the root. Fine for a flick.   */
  function swayTail(pts, deg) {
    var ox = pts[0][0], oy = pts[0][1];
    return pts.map(function (p, i) {
      var w = i / (pts.length - 1);          // root stays put, tip moves most
      var a = deg * w * w * RAD;
      var dx = p[0] - ox, dy = p[1] - oy;
      return [
        ox + dx * Math.cos(a) - dy * Math.sin(a),
        oy + dx * Math.sin(a) + dy * Math.cos(a)
      ];
    });
  }

  /* tailWave: a travelling wave down the tail. Every point rides the
     same sine but delayed by `lag` per unit length, so the tip trails
     the base instead of swinging with it — that delay is what reads
     as weight. Sampling it at N phases gives frames that chain
     end-to-end under linear easing with no seam at the wrap.        */
  function tailWave(pts, phase, amp, lag) {
    var ox = pts[0][0], oy = pts[0][1];
    return pts.map(function (p, i) {
      var w = i / (pts.length - 1);
      var a = amp * w * w * Math.sin(2 * Math.PI * (phase - lag * w)) * RAD;
      var dx = p[0] - ox, dy = p[1] - oy;
      return [
        ox + dx * Math.cos(a) - dy * Math.sin(a),
        oy + dx * Math.sin(a) + dy * Math.cos(a)
      ];
    });
  }

  /* bake one full wave cycle to path strings */
  function bakeWave(pts, frames, amp, lag) {
    var out = [];
    for (var i = 0; i < frames; i++) {
      out.push(openPath(tailWave(pts, i / frames, amp, lag)));
    }
    return out;
  }

  /* ---------- head tweaks reused across states -------------------- */
  /* Nudge the ear tips for a twitch, reusing the current head pose. */
  function flickEars(headPts) {
    var out = headPts.map(function (p) { return p.slice(); });
    out[2][0] += 2.5; out[2][1] -= 3.5;      // right ear tip perks
    out[0][1] += 1.2;                        // left ear settles
    return out;
  }

  /* Press the ears down and out — used while the cat is being patted. */
  function flattenEars(headPts, amt) {
    var out = headPts.map(function (p) { return p.slice(); });
    out[0][1] += amt; out[0][0] -= amt * 0.5;
    out[2][1] += amt; out[2][0] += amt * 0.5;
    out[1][1] += amt * 0.25;
    return out;
  }

  /* ---------- poses ------------------------------------------------
     body / tail / legs live in scene coordinates.
     head, ears, eyes and mouth live in head-local coordinates and are
     placed by the #headGroup transform, so the head can bob and tilt
     without touching its morph data.

     The head silhouette is 10 points. Points 9-0-1 form the left ear
     and 1-2-3 the right ear; both ears share the valley (point 1) as
     an inner base, so the valley sits near x=0 to keep the two ears
     the same width. Each tip is offset ~3.5 outward from the middle
     of its own base — that offset is the whole of the outward lean.
  ------------------------------------------------------------------ */

  var HEAD_AWAKE = [
    [-20, -38, 0.16],   // 0  left ear tip
    [-2, -19, 0.85],    // 1  valley / skull top, shared ear base
    [17, -38, 0.16],    // 2  right ear tip
    [29, -13, 0.80],    // 3  right ear base
    [32, 5, 1.00],      // 4  right cheek
    [22, 22, 1.00],     // 5  right jaw
    [0, 28, 1.00],      // 6  chin
    [-21, 22, 1.00],    // 7  left jaw
    [-32, 5, 1.00],     // 8  left cheek
    [-31, -13, 0.80]    // 9  left ear base
  ];

  var HEAD_SLEEP = [
    [-24, -30, 0.18],
    [-2, -16, 0.85],
    [12, -31, 0.18],
    [28, -11, 0.80],
    [33, 6, 1.00],
    [23, 22, 1.00],
    [0, 28, 1.00],
    [-21, 22, 1.00],
    [-33, 6, 1.00],
    [-32, -11, 0.80]
  ];

  var HEAD_ANGRY = [                   // ears pinned flat against the skull
    [-30, -22, 0.20],
    [-2, -22, 0.85],
    [24, -24, 0.20],
    [30, -12, 0.80],
    [32, 5, 1.00],
    [22, 22, 1.00],
    [0, 28, 1.00],
    [-21, 22, 1.00],
    [-32, 5, 1.00],
    [-32, -12, 0.80]
  ];

  var HEAD_BORED = [                   // ears at half mast
    [-22, -33, 0.17],
    [-2, -17, 0.85],
    [15, -34, 0.17],
    [29, -12, 0.80],
    [32, 5, 1.00],
    [22, 22, 1.00],
    [0, 28, 1.00],
    [-21, 22, 1.00],
    [-32, 5, 1.00],
    [-31, -12, 0.80]
  ];

  var HEAD_ALERT = [                   // startled: ears perked straight up, head high
    [-21, -44, 0.16],
    [-2, -21, 0.85],
    [18, -44, 0.16],
    [29, -14, 0.80],
    [32, 4, 1.00],
    [22, 21, 1.00],
    [0, 27, 1.00],
    [-21, 21, 1.00],
    [-32, 4, 1.00],
    [-31, -14, 0.80]
  ];

  /* Inner ears: each is its own outer ear triangle inset 35% toward
     that triangle's centroid, so it always sits square inside the ear. */
  var EAR_L_AWAKE = [[-19.5, -33, 0.20], [-7.5, -20.5, 0.90], [-26, -17, 0.80]];
  var EAR_R_AWAKE = [[16.2, -33, 0.20], [24, -16.6, 0.80], [3.9, -20.5, 0.90]];
  var EAR_L_SLEEP = [[-22.4, -26, 0.20], [-8, -17, 0.90], [-27.6, -14, 0.80]];
  var EAR_R_SLEEP = [[12.2, -27, 0.20], [22.6, -14, 0.80], [3.1, -17, 0.90]];
  var EAR_L_ANGRY = [[-27, -20.8, 0.20], [-8.8, -20.8, 0.90], [-28.2, -14.3, 0.80]];
  var EAR_R_ANGRY = [[21.7, -22.4, 0.20], [25.6, -14.6, 0.80], [4.8, -21.1, 0.90]];
  var EAR_L_BORED = [[-20.8, -28.8, 0.20], [-7.8, -19, 0.90], [-26.2, -16, 0.80]];
  var EAR_R_BORED = [[14.8, -29.4, 0.20], [24.2, -15.6, 0.80], [4, -19, 0.90]];
  var EAR_L_ALERT = [[-20.5, -39, 0.20], [-7.5, -22, 0.90], [-27, -18.5, 0.80]];
  var EAR_R_ALERT = [[17.2, -39, 0.20], [25, -17.5, 0.80], [3.9, -22, 0.90]];

  function eyeAlert(cx, cy) { return ring(cx, cy - 0.2, 4.4, 5.2); }

  var POSES = {
    walk: {
      body: [
        [136, 68, 1], [112, 59, 1], [84, 59, 1], [60, 70, 1], [46, 90, 1],
        [56, 111, 1], [86, 117, 1], [114, 115, 1], [136, 105, 1], [144, 84, 1]
      ],
      head: HEAD_AWAKE, earL: EAR_L_AWAKE, earR: EAR_R_AWAKE,
      eyes: "open", mouth: MOUTH.smile,
      tail: [[58, 98], [42, 92], [31, 79], [32, 63], [42, 56]],
      tailWidth: 9,
      headPos: { x: 152, y: 72, rotation: 0, scaleX: 0.95, scaleY: 0.95 },
      shadow: { rx: 50, cx: 94, opacity: 0.28 },
      gait: true,
      tempo: 1,
      legs: null                                  // supplied by the walk cycle
    },

    sit: {
      body: [
        [124, 62, 1], [110, 55, 1], [95, 64, 1], [82, 88, 1], [76, 112, 1],
        [82, 130, 1], [108, 136, 1], [132, 135, 1], [145, 113, 1], [141, 84, 1]
      ],
      head: HEAD_AWAKE, earL: EAR_L_AWAKE, earR: EAR_R_AWAKE,
      eyes: "open", mouth: MOUTH.smile,
      tail: [[86, 124], [64, 128], [48, 132], [36, 130], [30, 121]],
      tailWidth: 9,
      headPos: { x: 136, y: 57, rotation: -3, scaleX: 1, scaleY: 1 },
      shadow: { rx: 36, cx: 108, opacity: 0.24 },
      legs: {
        fn: [[130, 120], [138, 127], [148, 130]],
        ff: [[122, 122], [130, 128], [140, 131]],
        bn: [[95, 119], [99, 122], [103, 124]],
        bf: [[89, 120], [93, 123], [97, 125]]
      }
    },

    sleep: {
      body: [
        [134, 98, 1], [110, 90, 1], [84, 88, 1], [60, 96, 1], [48, 110, 1],
        [54, 126, 1], [84, 134, 1], [112, 134, 1], [136, 128, 1], [144, 112, 1]
      ],
      head: HEAD_SLEEP, earL: EAR_L_SLEEP, earR: EAR_R_SLEEP,
      eyes: "closed", mouth: MOUTH.soft,
      tail: [[60, 114], [44, 121], [37, 130], [50, 135], [76, 134]],
      tailWidth: 9,
      headPos: { x: 142, y: 105, rotation: 9, scaleX: 1.02, scaleY: 0.97 },
      shadow: { rx: 54, cx: 96, opacity: 0.26 },
      legs: {
        fn: [[119, 121], [126, 126], [135, 128]],
        ff: [[110, 120], [116, 123], [122, 124]],
        bn: [[76, 119], [82, 122], [88, 123]],
        bf: [[70, 119], [76, 122], [82, 123]]
      }
    },

    /* being patted: sitting, squashed a little, tail up and pleased */
    pat: {
      body: [
        [124, 66, 1], [110, 60, 1], [93, 69, 1], [80, 92, 1], [74, 115, 1],
        [81, 131, 1], [108, 137, 1], [133, 136, 1], [147, 115, 1], [142, 88, 1]
      ],
      head: HEAD_AWAKE, earL: EAR_L_AWAKE, earR: EAR_R_AWAKE,
      eyes: "happy", mouth: MOUTH.grin,
      tail: [[86, 124], [66, 124], [52, 116], [48, 102], [54, 94]],
      tailWidth: 9,
      headPos: { x: 136, y: 62, rotation: -2, scaleX: 1.01, scaleY: 0.99 },
      shadow: { rx: 38, cx: 108, opacity: 0.26 },
      legs: {
        fn: [[130, 122], [138, 128], [148, 131]],
        ff: [[122, 124], [130, 129], [140, 132]],
        bn: [[95, 120], [99, 123], [103, 125]],
        bf: [[89, 121], [93, 124], [97, 126]]
      }
    },

    /* angry: the same four-beat cycle as `walk`, driven ~1.8x faster,
       with the head dropped, the ears pinned, the tail held out stiff
       and an anger mark over the brow. `gait: true` is what tells the
       controller to run the walk cycle and roam instead of a static
       pose. */
    angry: {
      body: [
        [136, 72, 1], [112, 63, 1], [84, 62, 1], [60, 72, 1], [46, 91, 1],
        [56, 112, 1], [86, 118, 1], [114, 116, 1], [136, 107, 1], [144, 87, 1]
      ],
      head: HEAD_ANGRY, earL: EAR_L_ANGRY, earR: EAR_R_ANGRY,
      eyes: "angry", mouth: MOUTH.frown,
      tail: [[58, 100], [43, 97], [29, 95], [17, 94], [7, 95]],
      tailWidth: 10,
      headPos: { x: 152, y: 78, rotation: 5, scaleX: 0.95, scaleY: 0.95 },
      shadow: { rx: 50, cx: 94, opacity: 0.3 },
      anger: { x: 176, y: 34 },
      gait: true,
      tempo: 1.8,
      legs: null
    },

    /* confront: planted on all four, weight low and forward, coiled to
       strike. This is the stance the cat holds while it stares down the
       window and counts down — and the base cat.js's one-shot swipe()
       strikes from. Only the near foreleg ever leaves the ground; the
       other three stay planted through the whole sequence, which is
       what keeps the tap reading as a cat batting at something rather
       than a kangaroo rearing up. */
    confront: {
      body: [
        [136, 76, 1], [112, 66, 1], [84, 65, 1], [60, 75, 1], [46, 93, 1],
        [56, 113, 1], [86, 119, 1], [114, 117, 1], [136, 109, 1], [144, 90, 1]
      ],
      head: HEAD_ANGRY, earL: EAR_L_ANGRY, earR: EAR_R_ANGRY,
      eyes: "angry", mouth: MOUTH.snarl,
      tail: [[58, 112], [42, 116], [28, 122], [16, 126], [8, 124]],
      tailWidth: 10,
      headPos: { x: 150, y: 85, rotation: 8, scaleX: 0.96, scaleY: 0.96 },
      shadow: { rx: 51, cx: 95, opacity: 0.3 },
      anger: { x: 174, y: 42 },
      legs: {
        fn: [[126, 96], [130, 110], [133, 124]],   // near foreleg — driven live by swipe()
        ff: [[116, 97], [119, 111], [122, 125]],
        bn: [[72, 94], [78, 110], [82, 127]],       // haunch compressed, loaded to spring
        bf: [[62, 95], [68, 111], [72, 128]]
      }
    },

    /* bored: slumped flat, front legs shoved out, chin nearly down */
    bored: {
      body: [
        [128, 88, 1], [106, 80, 1], [82, 80, 1], [60, 88, 1], [50, 104, 1],
        [56, 122, 1], [86, 130, 1], [112, 130, 1], [134, 124, 1], [142, 106, 1]
      ],
      head: HEAD_BORED, earL: EAR_L_BORED, earR: EAR_R_BORED,
      eyes: "bored", mouth: MOUTH.flat,
      tail: [[58, 114], [42, 121], [26, 127], [14, 131], [6, 129]],
      tailWidth: 8,
      headPos: { x: 144, y: 98, rotation: 5, scaleX: 1, scaleY: 1 },
      shadow: { rx: 52, cx: 94, opacity: 0.26 },
      legs: {
        fn: [[122, 116], [132, 124], [146, 128]],
        ff: [[114, 118], [124, 126], [138, 130]],
        bn: [[76, 116], [82, 121], [88, 123]],
        bf: [[70, 117], [76, 122], [82, 124]]
      }
    },

    /* alert: startled upright, ears high, eyes wide, noticing doomscrolling */
    alert: {
      body: [
        [124, 62, 1], [110, 55, 1], [95, 64, 1], [82, 88, 1], [76, 112, 1],
        [82, 130, 1], [108, 136, 1], [132, 135, 1], [145, 113, 1], [141, 84, 1]
      ],
      head: HEAD_ALERT, earL: EAR_L_ALERT, earR: EAR_R_ALERT,
      eyes: "alert", mouth: MOUTH.flat,
      tail: [[86, 124], [64, 126], [46, 122], [32, 112], [26, 98]],
      tailWidth: 9,
      headPos: { x: 136, y: 53, rotation: -4, scaleX: 1, scaleY: 1.02 },
      shadow: { rx: 36, cx: 108, opacity: 0.26 },
      alert: { x: 172, y: 32 },
      legs: {
        fn: [[130, 120], [138, 127], [148, 130]],
        ff: [[122, 122], [130, 128], [140, 131]],
        bn: [[95, 119], [99, 122], [103, 124]],
        bf: [[89, 120], [93, 123], [97, 125]]
      }
    }
  };

  var EYES = {
    left: {
      open: eyeOpen(-11, -1),
      closed: eyeClosed(-11, -1),
      happy: eyeHappy(-11, -1),
      angry: eyeAngry(-11, -1, 1),
      bored: eyeBored(-11, -1),
      alert: eyeAlert(-11, -1)
    },
    right: {
      open: eyeOpen(11, -1),
      closed: eyeClosed(11, -1),
      happy: eyeHappy(11, -1),
      angry: eyeAngry(11, -1, -1),
      bored: eyeBored(11, -1),
      alert: eyeAlert(11, -1)
    }
  };

  /* ---------- props ------------------------------------------------ */
  var HEART = "M0,4.2 C-5.4,-1.2 -4.2,-7.4 0,-3.6 C4.2,-7.4 5.4,-1.2 0,4.2 Z";

  /* Alert exclamation stem: tapered manga pill/wedge */
  var ALERT_STEM = "M-2.6,-22 C-2.6,-24.5 2.6,-24.5 2.6,-22 L1.6,-6.5 C1.6,-5.2 -1.6,-5.2 -1.6,-6.5 Z";

  /* LEGACY ANGER MARK (PRESERVED FOR REVERTIBILITY):
  var ANGER_LEGACY = [
    [[-3.5, -6.5, 0], [0, -11, 0], [3.5, -6.5, 0]],
    [[6.5, -3.5, 0], [11, 0, 0], [6.5, 3.5, 0]],
    [[3.5, 6.5, 0], [0, 11, 0], [-3.5, 6.5, 0]],
    [[-6.5, 3.5, 0], [-11, 0, 0], [-6.5, -3.5, 0]]
  ];
  */
  var ANGER_LEGACY = [
    [[-3.5, -6.5, 0], [0, -11, 0], [3.5, -6.5, 0]],
    [[6.5, -3.5, 0], [11, 0, 0], [6.5, 3.5, 0]],
    [[3.5, 6.5, 0], [0, 11, 0], [-3.5, 6.5, 0]],
    [[-6.5, 3.5, 0], [-11, 0, 0], [-6.5, -3.5, 0]]
  ];

  /* Authentic Japanese manga/anime anger vein mark 💢 (ikari mark):
     Four curved, bulging lobes radiating from a pinched central waist.
     Each lobe features convex bulging flanks [tension 1.0] and a crisp apex
     [tension 0.25], modeling subcutaneous blood vessels swelling under tension. */
  var ANGER = [
    // North lobe
    [[-2.2, -2.5, 1], [-4.6, -6.8, 1], [0, -10.8, 0.25], [4.6, -6.8, 1], [2.2, -2.5, 1]],
    // East lobe
    [[2.5, -2.2, 1], [6.8, -4.6, 1], [10.8, 0, 0.25], [6.8, 4.6, 1], [2.5, 2.2, 1]],
    // South lobe
    [[2.2, 2.5, 1], [4.6, 6.8, 1], [0, 10.8, 0.25], [-4.6, 6.8, 1], [-2.2, 2.5, 1]],
    // West lobe
    [[-2.5, 2.2, 1], [-6.8, 4.6, 1], [-10.8, 0, 0.25], [-6.8, -4.6, 1], [-2.5, -2.2, 1]]
  ];

  global.CatShapes = {
    buildPath: buildPath,
    closedPath: closedPath,
    openPath: openPath,
    rotate: rotate,
    POSES: POSES,
    EYES: EYES,
    MOUTH: MOUTH,
    GAIT: GAIT,
    WALK_FRAMES: WALK_FRAMES,
    walkCycle: walkCycle,
    legFrame: legFrame,
    swayTail: swayTail,
    tailWave: tailWave,
    bakeWave: bakeWave,
    flickEars: flickEars,
    flattenEars: flattenEars,
    HEART: HEART,
    ALERT_STEM: ALERT_STEM,
    ANGER: ANGER,
    ANGER_LEGACY: ANGER_LEGACY
  };
})(window);
