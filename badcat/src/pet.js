"use strict";

/* ------------------------------------------------------------------
   pet.js — the desktop brain
   ------------------------------------------------------------------
   cat.js knows how to *be* a cat. This file decides what the cat does:
   where it stands, when it wanders, how it reacts when the Rust side
   reports that you are watching Reels again, and what happens when you
   pick it up and let go.

   Position is driven here rather than by cat.js's own roam, because on
   the desktop the cat has a whole screen to cross, not a 300-unit
   stage. Cat.groundSpeed() is what keeps the paws from skating.

   The overlay window now covers the entire work area (not just a strip
   along the bottom) so there is room above the floor to drag the cat
   into and let gravity drop it — see fallToFloor() below.
------------------------------------------------------------------ */
(function () {
  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : async () => ({});
  const listen = T ? T.event.listen : async () => {};

  // A transparent, always-on-top webview has no devtools you can open —
  // this is the only way to see what went wrong, so keep it for real
  // failure paths (never for routine per-frame chatter).
  const log = (m) => invoke("jslog", { msg: String(m) }).catch(() => {});
  window.addEventListener("error", (e) => log("ERROR " + e.message + " @" + e.lineno));

  const pet = document.getElementById("pet");
  const bubble = document.getElementById("bubble");
  const bubbleText = document.getElementById("bubbleText");
  const bubbleCount = document.getElementById("bubbleCount");

  const EDGE = 24;             // keep this far from the left/right edges
  const TOP_MARGIN = 16;       // and this far from the top
  let unit = 1.25;             // px per design unit, from settings
  let boxW = 200 * unit;
  let boxH = 150 * unit;
  let wander = true;
  let sleepy = true;
  let baseSpeed = 1;

  gsap.registerPlugin(MorphSVGPlugin);
  CatRig.mount(document.getElementById("petScene"));
  Cat.init({ state: "sit", roam: false });   // we drive position ourselves

  /* ---------------------------------------------------------------
     position — both axes live in #pet's own x/y (GSAP transform),
     driven entirely from here; see pet.css for the top:0;left:0 anchor
  --------------------------------------------------------------- */
  let x = 0;
  let y = 0;

  const maxX = () => Math.max(EDGE, window.innerWidth - boxW - EDGE);
  // the rig's floor sits at y=137 of its 150-unit box, so the resting
  // position is (150-137) units short of the window's true bottom —
  // that gap is what puts the paws exactly on the taskbar line
  const floorY = () => window.innerHeight - (137 * unit);
  const minY = () => TOP_MARGIN;

  const clampX = (v) => Math.min(maxX(), Math.max(EDGE, v));
  const clampY = (v) => Math.min(floorY(), Math.max(minY(), v));

  function setXY(nx, ny) { x = nx; y = ny; gsap.set(pet, { x, y }); }
  function setX(nx) { setXY(nx, y); }

  function applyCat(cat) {
    if (!cat) { return; }
    unit = Number(cat.scale) || 1.25;
    boxW = 200 * unit;
    boxH = 150 * unit;
    baseSpeed = Number(cat.speed) || 1;
    wander = cat.wander !== false;
    sleepy = cat.sleepy !== false;
    document.documentElement.style.setProperty("--u", String(unit));
    Cat.setSpeed(baseSpeed);
    // a size change can move the floor line; snap back onto it unless
    // something is actively holding or dropping the cat right now
    if (!dragging && !falling) { setXY(clampX(x), floorY()); }
  }

  /* ---------------------------------------------------------------
     an interruptible-sequence helper

     Every behaviour is a chain of awaits. `epoch` is bumped whenever
     something more important happens (a bust, a drag, a pat), which
     makes every in-flight step resolve early and unwind the old chain
     instead of fighting the new one.
  --------------------------------------------------------------- */
  let epoch = 0;
  const stale = (mine) => mine !== epoch;
  const interrupt = () => ++epoch;

  function wait(seconds, mine) {
    return new Promise((resolve) => {
      const t = gsap.delayedCall(seconds, resolve);
      const poll = setInterval(() => {
        if (stale(mine)) { clearInterval(poll); t.kill(); resolve(); }
      }, 120);
      t.eventCallback("onComplete", () => { clearInterval(poll); resolve(); });
    });
  }

  function walkTo(targetX, mine) {
    return new Promise((resolve) => {
      const dest = clampX(targetX);
      const distance = Math.abs(dest - x);
      if (distance < 8) { resolve(); return; }

      Cat.setFacing(dest > x ? 1 : -1);
      if (Cat.getState() !== "walk" && Cat.getState() !== "angry") {
        Cat.setState("walk");
      }

      // px/sec derived from the gait itself, so the feet stay planted
      const pps = Math.max(12, Cat.groundSpeed() * unit);
      const tween = gsap.to(pet, {
        x: dest,
        duration: distance / pps,
        ease: "none",
        onUpdate() { x = gsap.getProperty(pet, "x"); },
        onComplete() { clearInterval(poll); x = dest; resolve(); }
      });
      const poll = setInterval(() => {
        if (stale(mine)) {
          clearInterval(poll); tween.kill();
          x = gsap.getProperty(pet, "x"); resolve();
        }
      }, 120);
    });
  }

  /* ---------------------------------------------------------------
     idle life
  --------------------------------------------------------------- */
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (a, b) => a + Math.random() * (b - a);

  async function idleLoop() {
    const mine = interrupt();
    while (!stale(mine)) {
      Cat.setSpeed(baseSpeed);
      const rests = sleepy ? ["sit", "sit", "bored", "sleep", "bored"] : ["sit", "sit", "bored"];
      Cat.setState(pick(rests));
      await wait(rand(7, 18), mine);
      if (stale(mine)) { return; }

      if (wander) {
        await walkTo(rand(EDGE, maxX()), mine);
        if (stale(mine)) { return; }
        Cat.setState("sit");
        await wait(rand(1, 3), mine);
      }
    }
  }

  /* ---------------------------------------------------------------
     bubble
  --------------------------------------------------------------- */
  let bubbleTween = null;

  function showBubble(text, count, kind) {
    bubbleText.textContent = text;
    bubbleCount.textContent = count || "";
    bubbleCount.style.display = count ? "" : "none";
    bubble.className = "bubble" + (kind ? " is-" + kind : "");
    bubble.hidden = false;
    if (bubbleTween) { bubbleTween.kill(); }
    bubbleTween = gsap.fromTo(bubble,
      { opacity: 0, y: 8, scale: 0.94 },
      { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: "back.out(2)", transformOrigin: "50% 100%" });
  }

  function updateBubble(count, kind) {
    bubbleCount.textContent = count || "";
    if (kind) { bubble.className = "bubble is-" + kind; }
  }

  function hideBubble() {
    if (bubbleTween) { bubbleTween.kill(); }
    bubbleTween = gsap.to(bubble, {
      opacity: 0, y: 6, duration: 0.22, ease: "power2.in",
      onComplete() { bubble.hidden = true; }
    });
  }

  /* ---------------------------------------------------------------
     the intervention
     ---------------------------------------------------------------
     Walk to the window on all fours, plant, glare through the
     countdown, then Cat.swipe() taps it closed. Every await below is
     gated on `mine` so a drag or a snooze click cleanly abandons the
     whole sequence instead of leaving it stuck.
  --------------------------------------------------------------- */
  let alerting = false;
  let countdownTimer = null;

  const SCOLDS = [
    "Shorts. Again.",
    "That's enough of that.",
    "Closing this one.",
    "You said you'd stop.",
    "Nope."
  ];

  function abandon() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    alerting = false;
    hideBubble();
  }

  async function onBust(payload) {
    if (alerting) { return; }
    alerting = true;
    const mine = interrupt();

    Cat.setSpeed(baseSpeed);

    // Startled notice reaction: perk upright, pop `!`, stunned pause, burst into 💢
    if (typeof Cat.alert === "function") {
      await Cat.alert();
      if (stale(mine)) { abandon(); return; }
    }

    Cat.setState("angry");                       // the fast four-beat approach

    const nagging = payload.mode !== "close";

    if (wander) {
      const targetX = typeof payload.windowCenterX === "number"
        ? payload.windowCenterX
        : (window.innerWidth - boxW) / 2 + rand(-160, 160);
      await walkTo(targetX, mine);
      if (stale(mine)) { abandon(); return; }
    }

    // arrive, plant on all fours, and hold the glare for a beat before
    // saying anything — that pause is what sells "arrived on purpose"
    Cat.setState("confront");
    await wait(0.22, mine);
    if (stale(mine)) { abandon(); return; }

    let left = nagging ? 0 : payload.countdown;
    showBubble(
      nagging ? payload.label + "?" : pick(SCOLDS),
      nagging ? "seen" : left + "s",
      nagging ? "hint" : null
    );

    if (nagging) {
      await wait(2.6, mine);
      finish(mine);
      return;
    }

    await new Promise((resolve) => {
      countdownTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) { clearInterval(countdownTimer); countdownTimer = null; resolve(); }
        else { updateBubble(left + "s"); }
      }, 1000);
    });
    if (stale(mine)) { abandon(); return; }        // snoozed mid-count

    let result = { acted: false, reason: "" };
    let actCall = null;

    // the paw tap IS the close: act() fires on the strike's contact
    // frame, so the tab goes away exactly as the paw lands
    try {
      await Cat.swipe(() => {
        if (stale(mine)) { return; }               // interrupted mid-swing — don't close
        updateBubble("", "done");
        actCall = invoke("act", { target: payload.target });
      });
    } catch (err) { log("swipe failed: " + err); }

    if (stale(mine)) { abandon(); return; }

    try {
      result = await (actCall || invoke("act", { target: payload.target }));
    } catch (err) { log("act failed: " + err); }
    if (stale(mine)) { abandon(); return; }

    if (result && result.acted) {
      updateBubble("closed", "done");
      Cat.setState("pat");                        // pleased with itself
    } else {
      updateBubble(result.reason || "let it go", "hint");
      Cat.setState("sit");
    }
    await wait(2.4, mine);
    finish(mine);
  }

  function finish(mine) {
    if (stale(mine)) { return; }
    alerting = false;
    hideBubble();
    Cat.setSpeed(baseSpeed);
    idleLoop();
  }

  async function cancelToSnooze() {
    if (!alerting) { return; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    alerting = false;
    interrupt();
    let mins = 5;
    try { mins = await invoke("snooze", {}); } catch (_) { }
    Cat.setSpeed(baseSpeed);
    Cat.setState("pat");
    showBubble("Fine. " + mins + " minutes.", "snoozed", "hint");
    setTimeout(() => { hideBubble(); idleLoop(); }, 2000);
  }

  /* ---------------------------------------------------------------
     pointer: click-through unless you are actu  /* ---------------------------------------------------------------
     pointer: accurate hit testing, full 2D drag & realistic gravity
  --------------------------------------------------------------- */
  let interactive = false;
  let dragging = false;
  let falling = false;
  let dragDx = 0, dragDy = 0;
  let moved = 0;

  function isFacingLeft() {
    if (typeof Cat.getFacing === "function") {
      return Cat.getFacing() < 0;
    }
    const catEl = document.getElementById("cat");
    if (!catEl) { return false; }
    return (gsap.getProperty(catEl, "scaleX") || 1) < 0;
  }

  function hot(cx, cy) {
    const u = unit;
    const facingLeft = isFacingLeft();
    
    // Facing left: design X spans [15, 170]. Facing right: spans [30, 185].
    // Add a 10px grab buffer for responsive clicking
    const leftPad = (facingLeft ? 15 : 30) * u - 10;
    const rightPad = (facingLeft ? 170 : 185) * u + 10;
    const topPad = 10 * u - 10;
    const bottomPad = 142 * u + 8;

    const left = x + leftPad;
    const right = x + rightPad;
    const top = y + topPad;
    const bottom = y + bottomPad;

    if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
      return true;
    }

    if (!bubble.hidden && bubble.style.display !== "none" && (gsap.getProperty(bubble, "opacity") || 1) > 0.1) {
      const b = bubble.getBoundingClientRect();
      if (cx >= b.left - 6 && cx <= b.right + 6 && cy >= b.top - 6 && cy <= b.bottom + 6) {
        return true;
      }
    }
    return false;
  }

  function setInteractive(on) {
    if (on === interactive) { return; }
    interactive = on;
    invoke("set_interactive", { on }).catch(() => {});
  }

  /* Gravity, cartoon-weight: kinematic acceleration g = 4200 px/s^2 */
  const GRAVITY_PX_S2 = 4200;

  function fallToFloor(mine) {
    return new Promise((resolve) => {
      const dest = floorY();
      const dropHeight = dest - y;

      if (dropHeight <= 2) {
        land(0.3);
        resolve();
        return;
      }

      falling = true;
      // Exact kinematic duration t = sqrt(2h / g), clamped cleanly
      const duration = Math.min(1.0, Math.max(0.05, Math.sqrt((2 * dropHeight) / GRAVITY_PX_S2)));
      const tween = gsap.to(pet, {
        y: dest,
        duration: duration,
        ease: "power2.in",
        onUpdate() { y = gsap.getProperty(pet, "y"); },
        onComplete() {
          falling = false;
          y = dest;
          land(Math.min(1, dropHeight / 240));
          resolve();
        }
      });

      const poll = setInterval(() => {
        if (stale(mine)) {
          clearInterval(poll);
          tween.kill();
          falling = false;
          y = gsap.getProperty(pet, "y");
          resolve();
        }
      }, 60);

      tween.eventCallback("onComplete", function () {
        clearInterval(poll);
        falling = false;
        y = dest;
        land(Math.min(1, dropHeight / 240));
        resolve();
      });
    });
  }

  function land(strength) {
    // 2D volume-preserving squash and elastic spring recovery
    const squashY = Math.max(0.72, 1 - 0.24 * strength);
    const squashX = Math.min(1.28, 1 + 0.20 * strength);
    gsap.killTweensOf(pet, "scaleX,scaleY");
    gsap.set(pet, { transformOrigin: "50% 100%" });
    gsap.timeline()
      .to(pet, { scaleY: squashY, scaleX: squashX, duration: 0.07, ease: "power2.out" })
      .to(pet, { scaleY: 1, scaleX: 1, duration: 0.45, ease: "elastic.out(1.2, 0.45)" });
  }

  window.addEventListener("pointermove", (e) => {
    if (dragging) {
      moved += 1;
      setXY(clampX(e.clientX - dragDx), clampY(e.clientY - dragDy));
      return;
    }
    setInteractive(hot(e.clientX, e.clientY));
  });

  window.addEventListener("pointerdown", (e) => {
    if (!hot(e.clientX, e.clientY)) {
      log("miss @" + e.clientX + "," + e.clientY + " cat x=" + Math.round(x) + " y=" + Math.round(y));
      return;
    }
    log("grabbed @" + e.clientX + "," + e.clientY);
    dragging = true;
    moved = 0;
    dragDx = e.clientX - x;
    dragDy = e.clientY - y;

    // Reset any active landing squash/stretch
    gsap.killTweensOf(pet, "scaleX,scaleY");
    gsap.to(pet, { scaleX: 1, scaleY: 1, duration: 0.1 });

    try { pet.setPointerCapture(e.pointerId); } catch (_) {}

    interrupt();
    abandon();                                    // picking it up cancels any bust in flight
    Cat.setState("bored");                        // dangling in mid-air
  });

  window.addEventListener("pointerup", (e) => {
    if (!dragging) { return; }
    dragging = false;
    try { pet.releasePointerCapture(e.pointerId); } catch (_) {}

    if (moved < 3) {
      // a click, not a drag
      if (alerting) { cancelToSnooze(); return; }
      const mine = interrupt();
      Cat.setState("pat");
      wait(3, mine).then(() => { if (!stale(mine)) { idleLoop(); } });
      return;
    }

    const mine = interrupt();
    fallToFloor(mine).then(() => {
      if (stale(mine) || alerting) { return; }
      Cat.setState("sit");
      wait(0.6, mine).then(() => { if (!stale(mine)) { idleLoop(); } });
    });
  });

  window.addEventListener("dblclick", () => { invoke("open_settings", {}).catch(() => {}); });

  window.addEventListener("resize", () => {
    if (!dragging && !falling) { setXY(clampX(x), floorY()); }
    else { setX(clampX(x)); }
  });

  /* ---------------------------------------------------------------
     wiring
  --------------------------------------------------------------- */
  listen("bust", (e) => onBust(e.payload));

  listen("status", (e) => {
    // The cat notices a few seconds before it acts: it stops what it is
    // doing and stares. That pause is the actual warning.
    const s = e.payload;
    if (alerting || dragging) { return; }
    if (s.watching && s.remaining <= 5 && Cat.getState() !== "sit") {
      const mine = interrupt();
      Cat.setState("sit");
      wait(6, mine).then(() => { if (!stale(mine)) { idleLoop(); } });
    }
  });

  listen("config-changed", (e) => applyCat(e.payload && e.payload.cat));

  // settings can drive the cat directly so you can see each pose
  listen("preview-state", (e) => {
    const mine = interrupt();
    alerting = false;
    hideBubble();
    if (e.payload === "swipe") { Cat.swipe(); }
    else if (e.payload === "alert") { Cat.alert(); }
    else { Cat.setState(e.payload); }
    wait(6, mine).then(() => { if (!stale(mine)) { idleLoop(); } });
  });

  /* ---------------------------------------------------------------
     go
  --------------------------------------------------------------- */
  setXY(Math.round((window.innerWidth - boxW) / 2), floorY());

  invoke("get_config", {})
    .then((cfg) => applyCat(cfg && cfg.cat))
    .catch(() => {});

  idleLoop();
})();
