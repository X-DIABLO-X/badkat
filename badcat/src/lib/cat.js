/* ------------------------------------------------------------------
   cat.js — the rig controller
   ------------------------------------------------------------------
   Three layers of motion, kept deliberately separate:

     1. POSE     one MorphSVG tween per body part, fired on a state
                 change. This is the only place shapes change wholesale.
     2. LOOP     the per-state idle: the walk cycle, breathing, tail
                 waves, the pat bounce, the angry stomp.
     3. LIFE     state-agnostic touches — blinking, ear twitches, and
                 the props (Zzz, hearts).
------------------------------------------------------------------ */
(function (global) {
  "use strict";

  var S = global.CatShapes;
  var HAS_MORPH = typeof global.MorphSVGPlugin !== "undefined";
  if (HAS_MORPH) { gsap.registerPlugin(MorphSVGPlugin); }

  var $ = function (id) { return document.getElementById(id); };

  /* Element refs are resolved in init(), not at load, so this file can
     be included before the rig is mounted -- which is what lets the
     demo page and the desktop overlay share one script order. */
  var el = {};
  var heartEls = [];
  var angerEls = [];
  var zzzEls = [];
  var sparkEls = [];
  var dotEls = [];
  var streakEls = [];
  var LEG_KEYS = ["fn", "ff", "bn", "bf"];

  function collect() {
    el = {
      cat: $("cat"),
      shadow: $("shadow"),
      bodyGroup: $("bodyGroup"),
      body: $("body"),
      tail: $("tail"),
      headBob: $("headBob"),
      headGroup: $("headGroup"),
      head: $("head"),
      earL: $("earL"),
      earR: $("earR"),
      eyeL: $("eyeL"),
      eyeR: $("eyeR"),
      mouth: $("mouth"),
      zzz: $("zzz"),
      anger: $("anger"),
      pawprint: $("pawprint"),
      levelup: $("levelup"),
      lvlBadge: $("lvlBadge"),
      lvlPill: $("lvlPill"),
      lvlText: $("lvlText"),
      lvlArrow: $("lvlArrow"),
      xpFloat: $("xpFloat"),
      hearts: $("hearts"),
      legs: { fn: $("legFN"), ff: $("legFF"), bn: $("legBN"), bf: $("legBF") }
    };
    var missing = Object.keys(el).filter(function (k) { return k !== "legs" && !el[k]; });
    if (missing.length) {
      throw new Error("cat.js: rig not mounted, missing #" + missing.join(", #"));
    }
    heartEls = Array.prototype.slice.call(el.hearts.querySelectorAll(".heart"));
    angerEls = Array.prototype.slice.call(el.anger.querySelectorAll(".anger-mark"));
    zzzEls = Array.prototype.slice.call(el.zzz.querySelectorAll(".z"));
    sparkEls = Array.prototype.slice.call(el.levelup.querySelectorAll(".lvl-spark"));
    dotEls = Array.prototype.slice.call(el.levelup.querySelectorAll(".lvl-dot"));
    streakEls = Array.prototype.slice.call(el.levelup.querySelectorAll(".streak"));
  }

  /* ---------------------------------------------------------------
     morph(): the single funnel for every shape change. Without the
     plugin loaded the rig still works, it just snaps between poses.
  --------------------------------------------------------------- */
  function morph(target, d, dur, ease, position, tl) {
    if (!dur) {
      target.setAttribute("d", d);
      return;
    }
    if (HAS_MORPH) {
      var vars = { duration: dur, ease: ease || "power2.inOut", morphSVG: d };
      return tl ? tl.to(target, vars, position) : gsap.to(target, vars);
    }
    var snap = { duration: dur, onComplete: function () { target.setAttribute("d", d); } };
    return tl ? tl.to({}, snap, position) : gsap.to({}, snap);
  }

  /* ---------------------------------------------------------------
     state
  --------------------------------------------------------------- */
  var current = null;
  var loop = null;        // per-state idle timeline
  var roam = null;        // walk-across-the-floor timeline
  var props = null;       // Zzz / hearts timeline
  var poseTl = null;      // the in-flight pose morph
  var actionTl = null;    // a one-shot such as swipe()
  /* Bumped by every state change and every one-shot. Deferred callbacks
     capture it and bail if it has moved on, which is what stops a
     superseded pose from starting its idle loop late — see setState(). */
  var generation = 0;
  var blinkCall = null;
  var twitchCall = null;
  var speed = 1;
  var tempo = 1;          // per-state multiplier on top of `speed`
  var roamEnabled = true; // the desktop overlay drives position itself

  var CYCLE_STEP = 0.085;                        // seconds per walk keyframe
  var STRIDE = 2 * S.GAIT.fn.reach;              // ground covered per stride
  var UNITS_PER_SEC = STRIDE / (S.WALK_FRAMES * CYCLE_STEP);
  var ROAM_LEFT = -62;
  var ROAM_RIGHT = 62;

  /* The walking tail: one travelling wave sampled at 16 phases. Two
     strides per wave, so the tail reads slower and heavier than the
     legs instead of buzzing along with them. */
  var GAIT_TAIL = {
    walk: S.bakeWave(S.POSES.walk.tail, 16, 10, 0.3),
    angry: S.bakeWave(S.POSES.angry.tail, 16, 6, 0.34)   // stiffer, held out
  };
  var PAT_TAIL = S.bakeWave(S.POSES.pat.tail, 8, 15, 0.22);

  var BLINK_STATES = { open: 1, bored: 1 };
  var TWITCH_STATES = { walk: 1, sit: 1, bored: 1 };

  function rand(a, b) { return a + Math.random() * (b - a); }

  function clearLife() {
    if (blinkCall) { blinkCall.kill(); blinkCall = null; }
    if (twitchCall) { twitchCall.kill(); twitchCall = null; }
  }

  function clearLoops() {
    if (loop) { loop.kill(); loop = null; }
    if (roam) { roam.kill(); roam = null; }
    if (props) { props.kill(); props = null; }
    /* These two matter as much as the loops. killTweensOf() below stops
       the individual morphs, but a timeline whose children are dead
       still runs out its own duration and still fires its onComplete —
       which is how a superseded pose used to start the previous state's
       walk cycle underneath the new one's body, leaving the cat sitting
       and walking at the same time. */
    if (poseTl) { poseTl.kill(); poseTl = null; }
    if (actionTl) { actionTl.kill(); actionTl = null; }
    gsap.killTweensOf([el.body, el.tail, el.head, el.earL, el.earR,
      el.eyeL, el.eyeR, el.mouth, el.bodyGroup, el.headBob, el.shadow, el.anger, el.pawprint]);
    gsap.killTweensOf(heartEls);
    gsap.killTweensOf(angerEls);
    gsap.killTweensOf(zzzEls);
    // the celebration borrows bodyGroup/headBob, so a pose change has to
    // take them back — otherwise a stray badge is left sitting on screen
    gsap.killTweensOf(sparkEls.concat(dotEls, streakEls));
    gsap.killTweensOf([el.levelup, el.lvlBadge, el.xpFloat]);
    LEG_KEYS.forEach(function (k) { gsap.killTweensOf(el.legs[k]); });
  }

  /* ---------------------------------------------------------------
     POSE — morph every part to a named pose
  --------------------------------------------------------------- */
  function applyPose(name, dur) {
    var p = S.POSES[name];
    var ease = "power3.inOut";
    var tl = dur ? gsap.timeline({ defaults: { duration: dur, ease: ease } }) : null;

    morph(el.body, S.closedPath(p.body), dur, ease, 0, tl);
    morph(el.head, S.closedPath(p.head), dur, ease, 0, tl);
    morph(el.earL, S.closedPath(p.earL), dur, ease, 0, tl);
    morph(el.earR, S.closedPath(p.earR), dur, ease, 0, tl);
    morph(el.tail, S.openPath(p.tail), dur, "power2.inOut", 0, tl);
    morph(el.mouth, S.openPath(p.mouth), dur, ease, 0, tl);

    morph(el.eyeL, S.closedPath(S.EYES.left[p.eyes]), dur ? dur * 0.6 : 0, "power2.out", 0, tl);
    morph(el.eyeR, S.closedPath(S.EYES.right[p.eyes]), dur ? dur * 0.6 : 0, "power2.out", 0, tl);

    // legs: static pose, or the first frame of the walk cycle
    LEG_KEYS.forEach(function (k) {
      var d = p.legs ? S.openPath(p.legs[k]) : S.walkCycle[k][0];
      morph(el.legs[k], d, dur, ease, 0, tl);
    });

    var headVars = {
      x: p.headPos.x, y: p.headPos.y, rotation: p.headPos.rotation,
      scaleX: p.headPos.scaleX, scaleY: p.headPos.scaleY,
      transformOrigin: "50% 80%"
    };
    var shadowVars = { attr: { rx: p.shadow.rx, cx: p.shadow.cx }, opacity: p.shadow.opacity };
    var tailVars = { strokeWidth: p.tailWidth };

    if (tl) {
      tl.to(el.headGroup, headVars, 0);
      tl.to(el.shadow, shadowVars, 0);
      tl.to(el.tail, tailVars, 0);
      tl.to(el.headBob, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, duration: dur }, 0);
      tl.to(el.bodyGroup, { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: dur }, 0);
    } else {
      gsap.set(el.headGroup, headVars);
      gsap.set(el.shadow, shadowVars);
      gsap.set(el.tail, tailVars);
    }
    return tl;
  }

  /* ---------------------------------------------------------------
     LOOPS
  --------------------------------------------------------------- */
  /* Shared by `walk` and `angry`: same four-beat cycle, different pose
     underneath and a different timeScale on top. */
  function gaitLoop(name) {
    var step = CYCLE_STEP;
    var stride = S.WALK_FRAMES * step;
    var span = stride * 2;                      // the loop runs two strides
    var tl = gsap.timeline({ repeat: -1, defaults: { ease: "none" } });

    // chain each limb through its baked keyframes, twice; frame N wraps to 0
    LEG_KEYS.forEach(function (k) {
      for (var f = 1; f <= S.WALK_FRAMES * 2; f++) {
        morph(el.legs[k], S.walkCycle[k][f % S.WALK_FRAMES], step, "none", (f - 1) * step, tl);
      }
    });

    // two bobs per stride, plus a touch of counter-rotation in the head
    tl.to(el.bodyGroup, {
      y: -2.1, duration: stride / 4, ease: "sine.inOut", yoyo: true, repeat: 7
    }, 0);
    tl.to(el.headBob, {
      y: -2.6, rotation: -1.5, duration: stride / 4, ease: "sine.inOut",
      yoyo: true, repeat: 7, transformOrigin: "50% 100%"
    }, stride * 0.06);

    // the tail: one continuous travelling wave across the whole span.
    // Sixteen small linear steps read as a single smooth swing, where
    // two big eased ones read as a metronome.
    var frames = GAIT_TAIL[name];
    var tstep = span / frames.length;
    for (var i = 1; i <= frames.length; i++) {
      morph(el.tail, frames[i % frames.length], tstep, "none", (i - 1) * tstep, tl);
    }

    return tl;
  }

  function sitLoop() {
    var tl = gsap.timeline({ repeat: -1 });
    var base = S.POSES.sit.tail;

    // breathing
    tl.to(el.bodyGroup, {
      scaleY: 1.022, scaleX: 0.994, y: -0.8,
      duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: 1,
      svgOrigin: "108 137"
    }, 0);
    tl.to(el.headBob, {
      y: -1.6, duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: 1
    }, 0);

    // lazy tail flick: rests, then two quick swipes
    morph(el.tail, S.openPath(S.swayTail(base, -13)), 0.42, "power2.out", 1.1, tl);
    morph(el.tail, S.openPath(S.swayTail(base, 6)), 0.5, "power1.inOut", 1.55, tl);
    morph(el.tail, S.openPath(S.swayTail(base, -9)), 0.45, "power2.out", 2.1, tl);
    morph(el.tail, S.openPath(base), 0.6, "power2.inOut", 2.6, tl);
    return tl;
  }

  function sleepLoop() {
    var tl = gsap.timeline({ repeat: -1 });
    var base = S.POSES.sleep.tail;

    // slow, deep breathing — the whole loaf inflates
    tl.to(el.bodyGroup, {
      scaleY: 1.045, scaleX: 1.008, y: -1.4,
      duration: 1.9, ease: "sine.inOut", yoyo: true, repeat: 1,
      svgOrigin: "96 136"
    }, 0);
    tl.to(el.headBob, {
      y: -1.2, rotation: 0.8, duration: 1.9, ease: "sine.inOut", yoyo: true, repeat: 1,
      transformOrigin: "50% 100%"
    }, 0.15);

    // the tail-tip curls in and out with the breath
    morph(el.tail, S.openPath(S.swayTail(base, -5)), 1.9, "sine.inOut", 0, tl);
    morph(el.tail, S.openPath(base), 1.9, "sine.inOut", 1.9, tl);
    return tl;
  }

  /* being patted: the cat squashes twice under an unseen hand, the
     ears fold, and a heart comes off the top of the head each time. */
  function patLoop() {
    var p = S.POSES.pat;
    var tl = gsap.timeline({ repeat: -1 });
    var CYCLE = 2.5;
    var beats = [0.35, 1.3];                    // when each pat lands

    beats.forEach(function (t, n) {
      // the cat squashes into the pat, then springs back
      tl.to(el.headBob, {
        y: 3.4, scaleY: 0.93, scaleX: 1.04, duration: 0.14,
        ease: "power2.out", transformOrigin: "50% 100%"
      }, t);
      tl.to(el.headBob, {
        y: 0, scaleY: 1, scaleX: 1, duration: 0.62, ease: "elastic.out(1, 0.45)"
      }, t + 0.16);
      tl.to(el.bodyGroup, {
        scaleY: 0.968, scaleX: 1.02, duration: 0.14, ease: "power2.out",
        svgOrigin: "108 137"
      }, t);
      tl.to(el.bodyGroup, {
        scaleY: 1, scaleX: 1, duration: 0.6, ease: "elastic.out(1, 0.5)"
      }, t + 0.16);

      // ears fold under the palm and pop back up
      morph(el.head, S.closedPath(S.flattenEars(p.head, 6)), 0.14, "power2.out", t, tl);
      morph(el.head, S.closedPath(p.head), 0.55, "elastic.out(1, 0.5)", t + 0.16, tl);
      morph(el.earL, S.closedPath(S.flattenEars(p.earL, 4)), 0.14, "power2.out", t, tl);
      morph(el.earL, S.closedPath(p.earL), 0.55, "elastic.out(1, 0.5)", t + 0.16, tl);
      morph(el.earR, S.closedPath(S.flattenEars(p.earR, 4)), 0.14, "power2.out", t, tl);
      morph(el.earR, S.closedPath(p.earR), 0.55, "elastic.out(1, 0.5)", t + 0.16, tl);

      tl.call(popHeart, [n], t + 0.08);
    });

    // a pleased tail wag runs the whole cycle, two full wave periods
    var tstep = CYCLE / (PAT_TAIL.length * 2);
    for (var i = 1; i <= PAT_TAIL.length * 2; i++) {
      morph(el.tail, PAT_TAIL[i % PAT_TAIL.length], tstep, "none", (i - 1) * tstep, tl);
    }

    return tl;
  }

  /* angry: the fast gait plus an anger mark that pops and throbs. The
     stomp itself is gaitLoop("angry"); this only drives the mark. */
  function angerMark() {
    var tl = gsap.timeline({ repeat: -1 });
    tl.fromTo(el.anger,
      { scale: 0.3, rotation: -25, opacity: 0 },
      { scale: 1.12, rotation: 6, opacity: 1, duration: 0.22, ease: "back.out(3)" }, 0);
    tl.to(el.anger, { scale: 1, rotation: 0, duration: 0.18, ease: "power2.out" }, 0.22);
    // throb on the off-beat, then a hard blink so it re-pops
    tl.to(el.anger, {
      scale: 1.14, duration: 0.19, ease: "sine.inOut", yoyo: true, repeat: 5
    }, 0.42);
    tl.to(el.anger, { opacity: 0, scale: 0.85, duration: 0.14, ease: "power2.in" }, 1.7);
    tl.to({}, { duration: 0.12 }, 1.84);
    return tl;
  }

  /* bored: slow sigh, head nodding off and catching itself, a couple
     of listless tail thumps */
  function boredLoop() {
    var p = S.POSES.bored;
    var tl = gsap.timeline({ repeat: -1 });
    var CYCLE = 5.2;

    tl.to(el.bodyGroup, {
      scaleY: 1.03, scaleX: 1.004, y: -1,
      duration: CYCLE / 2, ease: "sine.inOut", yoyo: true, repeat: 1,
      svgOrigin: "94 136"
    }, 0);

    // the head sinks, then jerks back up — twice, the second time less
    tl.to(el.headBob, {
      y: 3.4, rotation: 3, duration: 2, ease: "sine.inOut", transformOrigin: "50% 100%"
    }, 0.4);
    tl.to(el.headBob, { y: 0, rotation: 0, duration: 0.32, ease: "back.out(2.6)" }, 2.5);
    tl.to(el.headBob, { y: 2.4, rotation: 2, duration: 1.4, ease: "sine.inOut" }, 3.2);
    tl.to(el.headBob, { y: 0, rotation: 0, duration: 0.34, ease: "back.out(2)" }, 4.7);

    // tail thumps: lift, then let it drop
    morph(el.tail, S.openPath(S.swayTail(p.tail, 13)), 0.34, "power2.out", 1.0, tl);
    morph(el.tail, S.openPath(p.tail), 0.18, "power2.in", 1.36, tl);
    morph(el.tail, S.openPath(S.swayTail(p.tail, 10)), 0.3, "power2.out", 3.6, tl);
    morph(el.tail, S.openPath(p.tail), 0.16, "power2.in", 3.92, tl);

    return tl;
  }

  /* confront: the held stance while it stares the window down and the
     countdown runs. All four paws stay planted — a fine tremble and a
     tight, held breath is what sells "loaded", not any real movement. */
  function confrontLoop() {
    var p = S.POSES.confront;
    var tl = gsap.timeline({ repeat: -1 });
    var CYCLE = 2.6;

    tl.to([el.bodyGroup, el.headBob], {
      x: 0.7, duration: CYCLE / 36, ease: "none", yoyo: true, repeat: 35
    }, 0);
    tl.to(el.bodyGroup, {
      scaleY: 1.012, duration: CYCLE / 2, ease: "sine.inOut", yoyo: true, repeat: 1,
      svgOrigin: "96 132"
    }, 0);

    // the tail lashes twice, then holds low and still for a beat
    morph(el.tail, S.openPath(S.swayTail(p.tail, 16)), 0.22, "power2.out", 0.3, tl);
    morph(el.tail, S.openPath(S.swayTail(p.tail, -14)), 0.26, "power1.inOut", 0.56, tl);
    morph(el.tail, S.openPath(p.tail), 0.3, "power2.out", 0.9, tl);
    morph(el.tail, S.openPath(S.swayTail(p.tail, 10)), 0.2, "power2.out", 1.9, tl);
    morph(el.tail, S.openPath(p.tail), 0.3, "power2.inOut", 2.15, tl);

    return tl;
  }

  /* Gait states get gaitLoop(); the rest have a bespoke idle. */
  var LOOPS = {
    sit: sitLoop, sleep: sleepLoop, pat: patLoop, bored: boredLoop, confront: confrontLoop
  };

  /* ---------------------------------------------------------------
     roaming — walk to the wall, spin around, walk back
  --------------------------------------------------------------- */
  function startRoam() {
    gsap.set(el.cat, { svgOrigin: "100 104" });
    var x = gsap.getProperty(el.cat, "x") || 0;
    var flipped = (gsap.getProperty(el.cat, "scaleX") || 1) < 0;

    var tl = gsap.timeline({ repeat: -1 });
    var legA = flipped ? ROAM_LEFT : ROAM_RIGHT;
    var legB = flipped ? ROAM_RIGHT : ROAM_LEFT;

    tl.to(el.cat, { x: legA, duration: Math.abs(legA - x) / UNITS_PER_SEC, ease: "none" })
      .to(el.cat, { scaleX: flipped ? 1 : -1, duration: 0.42, ease: "power2.inOut" })
      .to(el.cat, { x: legB, duration: Math.abs(legB - legA) / UNITS_PER_SEC, ease: "none" })
      .to(el.cat, { scaleX: flipped ? -1 : 1, duration: 0.42, ease: "power2.inOut" });
    return tl;
  }

  /* ---------------------------------------------------------------
     LIFE — blinks and ear twitches on a loose random timer
  --------------------------------------------------------------- */
  function blink() {
    var pose = S.POSES[current];
    if (pose && BLINK_STATES[pose.eyes]) {
      var shutL = S.closedPath(S.EYES.left.closed);
      var shutR = S.closedPath(S.EYES.right.closed);
      var backL = S.closedPath(S.EYES.left[pose.eyes]);
      var backR = S.closedPath(S.EYES.right[pose.eyes]);
      var slow = pose.eyes === "bored";
      var down = slow ? 0.16 : 0.07;
      var up = slow ? 0.3 : 0.11;
      var tl = gsap.timeline();
      morph(el.eyeL, shutL, down, "power2.in", 0, tl);
      morph(el.eyeR, shutR, down, "power2.in", 0, tl);
      morph(el.eyeL, backL, up, "power2.out", down + (slow ? 0.14 : 0.06), tl);
      morph(el.eyeR, backR, up, "power2.out", down + (slow ? 0.14 : 0.06), tl);
      if (!slow && Math.random() < 0.25) {              // the occasional double blink
        morph(el.eyeL, shutL, 0.07, "power2.in", 0.32, tl);
        morph(el.eyeR, shutR, 0.07, "power2.in", 0.32, tl);
        morph(el.eyeL, backL, 0.11, "power2.out", 0.44, tl);
        morph(el.eyeR, backR, 0.11, "power2.out", 0.44, tl);
      }
      blinkCall = gsap.delayedCall(slow ? rand(3.5, 8) : rand(2.4, 6.5), blink);
      return;
    }
    blinkCall = gsap.delayedCall(rand(2.4, 6.5), blink);
  }

  function twitch() {
    var pose = S.POSES[current];
    if (pose && TWITCH_STATES[current]) {
      var tl = gsap.timeline();
      morph(el.head, S.closedPath(S.flickEars(pose.head)), 0.09, "power2.out", 0, tl);
      morph(el.head, S.closedPath(pose.head), 0.22, "elastic.out(1, 0.55)", 0.11, tl);
    }
    twitchCall = gsap.delayedCall(rand(4, 11), twitch);
  }

  /* ---------------------------------------------------------------
     props
  --------------------------------------------------------------- */
  /* Which way the rig is currently mirrored, as a sign. Read from the
     live transform so it is right even mid-turn. */
  function facingSign() {
    return (gsap.getProperty(el.cat, "scaleX") || 1) < 0 ? -1 : 1;
  }

  /* The Zzz are the only GLYPHS in the rig, and glyphs are the only
     thing a mirror breaks: turning the cat left sets scaleX -1 on #cat,
     which is exactly right for every body part but renders the "z"
     backwards. So each z carries a counter-flip of its own — scaleX
     scaled by the facing sign, which multiplies out to +1 on screen —
     and scaleY is animated separately so the pop-in still grows.
     Counter-flipping per glyph rather than on the #zzz group keeps the
     drift heading away from the head in both directions. */
  function startZzz(dir) {
    var tl = gsap.timeline({ repeat: -1 });
    zzzEls.forEach(function (z, i) {
      gsap.set(z, { attr: { x: 172, y: 84 }, transformOrigin: "50% 50%" });
      tl.fromTo(z,
        { x: 0, y: 0, opacity: 0, scaleX: 0.55 * dir, scaleY: 0.55, rotation: -8 },
        {
          x: 16, y: -30, opacity: 0, scaleX: 1.25 * dir, scaleY: 1.25, rotation: 10,
          duration: 2.6,
          ease: "sine.out", keyframes: { opacity: [0, 0.85, 0.85, 0] }
        },
        i * 0.85);
    });
    tl.to({}, { duration: 0.6 });
    return tl;
  }

  /* ---------------------------------------------------------------
     level up — a one-shot celebration, on top of whatever pose is
     running rather than replacing it, so it can fire mid-pat or
     mid-walk without stealing the state machine. Returns the timeline
     so callers can await the end of the moment.
  --------------------------------------------------------------- */
  /* Sparkle and dot placements, in units around the badge's centre.
     Hand-placed rather than spaced evenly on a ring: an even ring reads
     as a machine-made halo, where a scatter reads as a sprinkle. */
  var LVL_SPARKS = [
    { x: -15, y: 5.5, s: 1.0 }, { x: 14.5, y: 4.5, s: 0.78 },
    { x: 7.5, y: -12.5, s: 1.05 }, { x: -9, y: -10, s: 0.66 }
  ];
  var LVL_DOTS = [
    { x: -19.5, y: -6.5, s: 1 }, { x: 18.5, y: -3, s: 0.82 },
    { x: -12.5, y: 13, s: 0.72 }, { x: 11, y: 12.5, s: 0.62 }
  ];
  var LVL_STREAKS = [
    { x: -13, h: 1.35, d: 0 }, { x: -4.5, h: 1.75, d: 0.06 },
    { x: 6, h: 1.15, d: 0.12 }, { x: 15, h: 1.5, d: 0.04 }
  ];

  /* Lays out the pill so it fits whatever the level number is: the text
     is measured, then the pill and the arrow are placed around it. A
     fixed-width pill would sit loose around "Lv. 5" and clip "Lv. 12". */
  function fitBadge(level) {
    var PAD = 6.5, GAP = 3.6, ARROW = 7;
    el.lvlText.textContent = "Lv. " + level;
    var w = 26;
    try { w = el.lvlText.getComputedTextLength() || w; } catch (_) {}
    var content = w + GAP + ARROW;
    var left = -content / 2;
    gsap.set(el.lvlText, { attr: { x: left + w / 2, y: 0 } });
    gsap.set(el.lvlArrow, { x: left + w + GAP + ARROW / 2, y: 0 });
    gsap.set(el.lvlPill, {
      attr: { x: left - PAD, width: content + PAD * 2, y: -7.6, height: 15.2, rx: 7.6 }
    });
  }

  /* "+25 XP" drifting up off the cat's shoulder. Most XP never levels
     anything, so this is the ordinary feedback and levelUp() is the
     rare one — they are placed apart (shoulder vs. well above the head)
     so that on the award that does both, neither sits on the other. */
  function gainXp(amount) {
    if (!el.xpFloat || !amount) { return gsap.timeline(); }
    var pose = S.POSES[current] || S.POSES.sit;
    var dir = facingSign();
    var x = pose.headPos.x + 24;
    var y = pose.headPos.y - 16;

    gsap.killTweensOf(el.xpFloat);
    el.xpFloat.textContent = "+" + amount + " XP";
    // counter-flip, or the text comes out backwards facing left
    gsap.set(el.xpFloat, { x: x, y: y, scaleX: dir, transformOrigin: "50% 50%" });

    var tl = gsap.timeline();
    tl.fromTo(el.xpFloat,
      { y: y + 4, scaleY: 0.7, opacity: 0 },
      { y: y - 2, scaleY: 1, opacity: 1, duration: 0.26, ease: "back.out(2.6)" }, 0);
    tl.to(el.xpFloat, { y: y - 20, duration: 1.5, ease: "power1.out" }, 0.26);
    tl.to(el.xpFloat, { opacity: 0, duration: 0.5, ease: "power2.in" }, 1.3);
    return tl;
  }

  function levelUp(level) {
    if (!el.levelup) { return gsap.timeline(); }
    var pose = S.POSES[current] || S.POSES.sit;
    /* Clear of the ears, which reach to about -35 from headPos: any
       closer and the pill sits on the cat's head instead of floating
       over it. This does put the badge above the 150-unit design box in
       the shorter poses, which is fine — #petScene is overflow:visible
       and the overlay window is the whole work area, so there is real
       screen above the cat to render into. */
    var cx = pose.headPos.x;
    var cy = pose.headPos.y - 52;
    var dir = facingSign();

    gsap.killTweensOf(sparkEls.concat(dotEls, streakEls));
    gsap.killTweensOf([el.levelup, el.lvlBadge]);
    // the group rides inside #cat, which is mirrored when facing left —
    // undo that here or the badge text comes out backwards
    gsap.set(el.levelup, { x: cx, y: cy, scaleX: dir, opacity: 1, transformOrigin: "50% 50%" });
    fitBadge(level === undefined ? "?" : level);

    var tl = gsap.timeline({
      onComplete: function () { gsap.set(el.levelup, { opacity: 0 }); }
    });

    // streaks first, rising and gone before the badge has finished
    // arriving — they read as the lift that carried it up
    streakEls.forEach(function (s, i) {
      var cfg = LVL_STREAKS[i % LVL_STREAKS.length];
      tl.fromTo(s,
        { x: cfg.x, y: 10, scaleY: cfg.h * 0.5, opacity: 0, transformOrigin: "50% 50%" },
        {
          y: -12, scaleY: cfg.h, duration: 0.5, ease: "power2.out",
          keyframes: { opacity: [0, 0.35, 0] }
        }, cfg.d);
    });

    /* The badge comes in fast and then STAYS, because it is the one
       thing here carrying information: a pop that is gone in under two
       seconds reads as a glitch rather than as news. It holds on a slow
       breath so the hold is alive rather than frozen, and only leaves
       at HOLD_OUT. */
    var HOLD_OUT = 4.1;
    tl.fromTo(el.lvlBadge,
      { y: 7, scale: 0.55, opacity: 0, transformOrigin: "50% 50%" },
      { y: 0, scale: 1, opacity: 1, duration: 0.38, ease: "back.out(2.4)" }, 0.05);
    tl.to(el.lvlBadge, {
      y: -1.6, duration: 1.15, ease: "sine.inOut", yoyo: true, repeat: 2
    }, 0.5);
    tl.to(el.lvlBadge, {
      y: -9, scale: 0.94, opacity: 0, duration: 0.5, ease: "power2.in"
    }, HOLD_OUT);

    /* Two waves of sparkles rather than one longer set: a single wave
       fades out and leaves the badge sitting alone for the rest of the
       hold, where a second wave keeps the moment going the whole way. */
    [0, 1].forEach(function (wave) {
      var at = 0.16 + wave * 1.75;
      sparkEls.forEach(function (s, i) {
        var cfg = LVL_SPARKS[(i + wave) % LVL_SPARKS.length];
        tl.fromTo(s,
          { x: cfg.x, y: cfg.y + 3, scale: 0, rotation: -35, opacity: 0, transformOrigin: "50% 50%" },
          {
            y: cfg.y, scale: cfg.s, rotation: 0, duration: 1.35, ease: "power2.out",
            keyframes: { opacity: [0, 1, 1, 0] }
          }, at + i * 0.11);
      });

      dotEls.forEach(function (d, i) {
        var cfg = LVL_DOTS[(i + wave) % LVL_DOTS.length];
        tl.fromTo(d,
          { x: cfg.x, y: cfg.y + 4, scale: 0, opacity: 0, transformOrigin: "50% 50%" },
          {
            y: cfg.y - 2, scale: cfg.s, duration: 1.45, ease: "power2.out",
            keyframes: { opacity: [0, 0.95, 0.95, 0] }
          }, at + 0.06 + i * 0.1);
      });
    });

    // and the cat itself pops — the badge alone reads as a screen
    // effect, the hop is what makes it the cat's moment
    tl.to(el.bodyGroup, {
      y: -7, scaleY: 1.06, scaleX: 0.96, duration: 0.17, ease: "power2.out",
      svgOrigin: "100 137"
    }, 0.05);
    tl.to(el.bodyGroup, {
      y: 0, scaleY: 1, scaleX: 1, duration: 0.72, ease: "elastic.out(1, 0.45)"
    }, 0.22);
    tl.to(el.headBob, {
      y: -4, rotation: -3, duration: 0.17, ease: "power2.out", transformOrigin: "50% 100%"
    }, 0.05);
    tl.to(el.headBob, {
      y: 0, rotation: 0, duration: 0.72, ease: "elastic.out(1, 0.5)"
    }, 0.22);

    /* Deliberately NOT scaled by `speed`. That setting is about how the
       cat moves; the badge is a notice, and at 2x it would be on screen
       for barely two seconds — which is the thing this hold exists to
       fix. Reading time should not depend on the animation slider. */
    return tl;
  }

  var heartTurn = 0;
  function popHeart(variant) {
    var z = heartEls[heartTurn % heartEls.length];
    heartTurn++;
    var drift = variant ? 20 : -18;
    gsap.fromTo(z,
      { x: 158, y: 30, opacity: 0, scale: 0.3, rotation: drift > 0 ? -14 : 14,
        transformOrigin: "50% 50%" },
      {
        x: 158 + drift, y: -6, opacity: 0, scale: 1.1, rotation: drift > 0 ? 16 : -16,
        duration: 1.25, ease: "sine.out",
        keyframes: { opacity: [0, 1, 1, 0] }
      });
  }

  /* ---------------------------------------------------------------
     swipe — a one-shot paw strike at the screen
     ---------------------------------------------------------------
     The cat stays on all fours throughout — only the near foreleg ever
     leaves the ground. It draws straight up, holds for a beat, then
     whips forward and down onto the target. `onImpact` fires on the
     exact contact frame — the desktop overlay closes the window there,
     so the tap reads as the thing that did it. Returns the GSAP
     timeline (await-able; resolves once the cat has settled back into
     `confront`).
  --------------------------------------------------------------- */
  function impactBurst(paw) {
    var tl = gsap.timeline();
    tl.set(el.pawprint, {
      x: paw[0] + 2, y: paw[1] - 4, opacity: 0,
      scale: 0.4, rotation: 18, transformOrigin: "50% 50%"
    }, 0);
    tl.to(el.pawprint, { opacity: 0.85, scale: 1.15, rotation: 6, duration: 0.09, ease: "back.out(3)" }, 0);
    tl.to(el.pawprint, { opacity: 0, scale: 1.4, duration: 0.26, ease: "power2.in" }, 0.11);
    return tl;
  }

  function swipe(onImpact) {
    if (!el.cat) { return gsap.timeline(); }

    clearLoops();
    clearLife();
    gsap.set(el.zzz, { opacity: 0 });
    gsap.set(heartEls, { opacity: 0 });

    current = "swiping";                        // not a real pose key — see onComplete
    tempo = 1;
    var mine = ++generation;                    // supersede any pose still morphing

    var p = S.POSES.confront;
    var restFn = p.legs.fn;

    // near foreleg keyframes: hip -> knee -> paw, in scene coordinates.
    // Small numbers throughout on purpose: a real swat is a quick, close
    // motion, not a big wind-up — the other three legs, the body and the
    // head barely move, which is what sells "one paw did this" instead
    // of a whole-body lunge.
    //
    // The head is painted after the legs (it has to sit in front of the
    // chest at rest), which means any part of this leg's path that
    // strays into the head's footprint — roughly x 125..180, y 58..117 —
    // renders hidden behind it. COCK is routed left of that box (tucked
    // back near the chest) and STRIKE's paw lands below it (under the
    // chin) so the anticipation and the contact frame are both actually
    // visible instead of vanishing mid-swing.
    var COCK = [[126, 90], [112, 82], [100, 72]];      // drawn back and up, clear of the head
    var STRIKE = [[128, 98], [155, 108], [182, 126]];  // whipped forward, landing well past the chin
    var TRAIL = [[132, 108], [140, 118], [148, 127]];  // raked back down to the floor

    var tl = gsap.timeline({
      onComplete: function () {
        // something grabbed the cat mid-swing (a drag, a snooze click);
        // whatever it switched to is the current pose, don't stomp it
        if (mine !== generation) { return; }
        actionTl = null;
        gsap.set(el.pawprint, { opacity: 0 });
        current = null;                          // let setState re-enter cleanly
        setState("confront", true);
      }
    });
    actionTl = tl;

    // 0.00 — sync onto the confront stance. Always, even if `current` already
    // says "confront": that flag flips the instant setState() is called, not
    // when its tween finishes, so with a short enough countdown this can
    // fire while the previous pose is still mid-morph. A 0.1s blend is cheap
    // and imperceptible when already there, and guarantees the eyes, mouth
    // and body are actually where the strike below assumes they are.
    var poseTl = applyPose("confront", 0.1);
    if (poseTl) { tl.add(poseTl, 0); }
    var t0 = 0.1;

    // anticipation — paw draws straight up, weight settles back a hair,
    // tail winds up. The hold afterward is the "about to" beat.
    morph(el.legs.fn, S.openPath(COCK), 0.16, "power2.out", t0, tl);
    tl.to(el.bodyGroup, { y: -1.4, rotation: -2.5, duration: 0.16, ease: "power2.out" }, t0);
    tl.to(el.headBob, { y: -1.8, rotation: -3, duration: 0.16, ease: "power2.out" }, t0);
    morph(el.tail, S.openPath(S.swayTail(p.tail, -22)), 0.16, "power2.out", t0, tl);
    tl.to({}, { duration: 0.09 }, t0 + 0.16);

    // the strike — fast, and everything commits to the same instant
    var tStrike = t0 + 0.25;
    morph(el.legs.fn, S.openPath(STRIKE), 0.1, "power3.in", tStrike, tl);
    tl.to(el.bodyGroup, { y: 0.6, rotation: 3, duration: 0.1, ease: "power3.in" }, tStrike);
    tl.to(el.headBob, { y: 2.6, rotation: 5, duration: 0.1, ease: "power3.in" }, tStrike);
    morph(el.tail, S.openPath(S.swayTail(p.tail, 26)), 0.1, "power3.in", tStrike, tl);

    // CONTACT — fire the close on this exact frame
    var tHit = tStrike + 0.1;
    tl.call(function () {
      if (typeof onImpact === "function") { onImpact(); }
    }, null, tHit);
    tl.add(impactBurst(STRIKE[2]), tHit);
    tl.to(el.bodyGroup, {
      scaleY: 0.94, scaleX: 1.04, duration: 0.06, ease: "power2.out", svgOrigin: "100 132"
    }, tHit);
    tl.to(el.shadow, {
      attr: { rx: p.shadow.rx + 4 }, opacity: p.shadow.opacity + 0.05, duration: 0.06
    }, tHit);

    // recover — paw rakes back to the ground, cat settles back into confront
    morph(el.legs.fn, S.openPath(TRAIL), 0.13, "power1.in", tHit + 0.06, tl);
    morph(el.legs.fn, S.openPath(restFn), 0.42, "back.out(1.6)", tHit + 0.19, tl);
    tl.to(el.bodyGroup, {
      y: 0, rotation: 0, scaleY: 1, scaleX: 1, duration: 0.42, ease: "back.out(1.6)"
    }, tHit + 0.1);
    tl.to(el.headBob, { y: 0, rotation: 0, duration: 0.42, ease: "back.out(1.6)" }, tHit + 0.1);
    tl.to(el.shadow, {
      attr: { rx: p.shadow.rx }, opacity: p.shadow.opacity, duration: 0.3
    }, tHit + 0.1);
    morph(el.tail, S.openPath(p.tail), 0.4, "power2.inOut", tHit + 0.12, tl);

    tl.timeScale(speed || 1);
    return tl;
  }

  /* ---------------------------------------------------------------
     public API
  --------------------------------------------------------------- */
  function setState(name, immediate) {
    if (!S.POSES[name] || name === current) { return; }
    var pose = S.POSES[name];
    var previous = current;
    var previousPose = previous ? S.POSES[previous] : null;
    current = name;
    tempo = pose.tempo || 1;

    clearLoops();
    gsap.set(el.zzz, { opacity: 0 });
    gsap.set(el.anger, { opacity: 0 });
    gsap.set(el.pawprint, { opacity: 0 });
    gsap.set(el.levelup, { opacity: 0 });
    gsap.set(el.xpFloat, { opacity: 0 });
    gsap.set(heartEls, { opacity: 0 });

    var mine = ++generation;
    var dur = immediate ? 0 : 0.62;
    var tl = applyPose(name, dur);
    poseTl = tl;

    // coming to a halt: glide back to centre and turn to face front-right
    if (previousPose && previousPose.gait && !pose.gait && tl && roamEnabled) {
      tl.to(el.cat, { x: 0, scaleX: 1, duration: 0.62, ease: "power2.inOut" }, 0);
    }

    var begin = function () {
      // a newer state (or a swipe) claimed the rig while this pose was
      // still morphing — that one owns the loops now, so stay out of it
      if (mine !== generation) { return; }
      poseTl = null;
      loop = pose.gait ? gaitLoop(name) : LOOPS[name]();
      loop.timeScale(speed * tempo);

      if (pose.gait && roamEnabled) {
        roam = startRoam();
        roam.timeScale(speed * tempo);
      }
      if (pose.anger) {
        gsap.set(el.anger, { x: pose.anger.x, y: pose.anger.y, transformOrigin: "50% 50%" });
        props = angerMark();
        props.timeScale(speed);
      }
      if (name === "sleep") {
        props = startZzz(facingSign());
        props.timeScale(speed);
        gsap.to(el.zzz, { opacity: 1, duration: 0.5 });
      }
    };

    if (tl) { tl.eventCallback("onComplete", begin); } else { begin(); }

    clearLife();
    blinkCall = gsap.delayedCall(rand(1.2, 3), blink);
    twitchCall = gsap.delayedCall(rand(3, 7), twitch);
  }

  function setSpeed(v) {
    speed = v;
    if (loop) { loop.timeScale(v * tempo); }
    if (roam) { roam.timeScale(v * tempo); }
    if (props) { props.timeScale(v); }
  }

  /* Which way the cat faces: 1 = right, -1 = left. */
  function setFacing(dir, dur) {
    var sign = dir < 0 ? -1 : 1;
    var turning = sign !== facingSign();
    gsap.to(el.cat, {
      scaleX: sign,
      duration: dur === undefined ? 0.42 : dur,
      ease: "power2.inOut"
    });
    // the Zzz bake the facing into their own counter-flip, so a cat that
    // turns over in its sleep needs them rebuilt against the new side
    if (turning && current === "sleep" && props) {
      props.kill();
      props = startZzz(sign);
      props.timeScale(speed);
    }
  }

  function init(opts) {
    if (typeof opts === "string") { opts = { state: opts }; }
    opts = opts || {};
    if (opts.roam === false) { roamEnabled = false; }

    collect();
    gsap.set(el.cat, { svgOrigin: "100 104" });
    S.ANGER.forEach(function (d, i) { angerEls[i].setAttribute("d", d); });
    gsap.set(el.anger, { opacity: 0 });
    el.pawprint.setAttribute("d", S.PAWPRINT);
    gsap.set(el.pawprint, { opacity: 0 });
    sparkEls.forEach(function (s) { s.setAttribute("d", S.SPARK); });
    gsap.set(el.levelup, { opacity: 0 });
    gsap.set(el.xpFloat, { opacity: 0 });
    gsap.set(sparkEls.concat(dotEls, streakEls), { opacity: 0 });
    heartEls.forEach(function (h) { h.setAttribute("d", S.HEART); });
    gsap.set(heartEls, { opacity: 0 });
    current = null;
    setState(opts.state || "sit", true);
  }

  global.Cat = {
    init: init,
    setState: setState,
    setSpeed: setSpeed,
    setFacing: setFacing,
    /* One-shot paw strike. `onImpact` fires on the contact frame;
       returns the timeline (await it to know when the cat has settled). */
    swipe: swipe,
    /* One-shot level-up celebration. Plays over the current pose
       instead of replacing it, so it never disturbs the state machine.
       Returns the timeline. */
    levelUp: levelUp,
    /* "+N XP" floating off the cat. Independent of levelUp() — most
       awards never level anything. Returns the timeline. */
    gainXp: gainXp,
    /* Design units per second the paws are currently covering. The
       desktop overlay multiplies this by its px-per-unit scale to move
       the cat across the screen without the feet skating. */
    groundSpeed: function () { return UNITS_PER_SEC * speed * tempo; },
    getState: function () { return current; },
    states: Object.keys(S.POSES),
    hasMorph: HAS_MORPH
  };
})(window);
