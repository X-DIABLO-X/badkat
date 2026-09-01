"use strict";

/* ------------------------------------------------------------------
   pet.js — the desktop brain
   ------------------------------------------------------------------
   cat.js knows how to *be* a cat. This file decides what the cat does:
   where it stands, when it wanders, and how it reacts when the Rust
   side reports that you are watching Reels again.

   Position is driven here rather than by cat.js's own roam, because on
   the desktop the cat has a whole screen to cross, not a 300-unit
   stage. Cat.groundSpeed() is what keeps the paws from skating.
------------------------------------------------------------------ */
(function () {
  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : async () => ({});
  const listen = T ? T.event.listen : async () => {};

  // the OS window title is a channel that works even when nothing else does
  document.title = "BadCat " + (T ? "tauri" : "NO-TAURI");
  const log = (m) => invoke("jslog", { msg: String(m) }).catch(() => {});
  window.addEventListener("error", (e) => log("ERROR " + e.message + " @" + e.lineno));

  const pet = document.getElementById("pet");
  const bubble = document.getElementById("bubble");
  const bubbleText = document.getElementById("bubbleText");
  const bubbleCount = document.getElementById("bubbleCount");

  const EDGE = 24;
  let unit = 1.25;                    // px per design unit, from settings
  let boxW = 200 * unit;
  let wander = true;
  let sleepy = true;
  let baseSpeed = 1;

  gsap.registerPlugin(MorphSVGPlugin);
  CatRig.mount(document.getElementById("petScene"));
  Cat.init({ state: "sit", roam: false });   // we drive position ourselves

  /* ---------------------------------------------------------------
     position
  --------------------------------------------------------------- */
  let x = Math.round((window.innerWidth - boxW) / 2);
  gsap.set(pet, { x });

  const maxX = () => Math.max(EDGE, window.innerWidth - boxW - EDGE);
  const clamp = (v) => Math.min(maxX(), Math.max(EDGE, v));
  const setX = (v) => { x = v; gsap.set(pet, { x }); };

  function applyCat(cat) {
    if (!cat) { return; }
    unit = Number(cat.scale) || 1.25;
    boxW = 200 * unit;
    baseSpeed = Number(cat.speed) || 1;
    wander = cat.wander !== false;
    sleepy = cat.sleepy !== false;
    document.documentElement.style.setProperty("--u", String(unit));
    Cat.setSpeed(baseSpeed);
    setX(clamp(x));
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
      const dest = clamp(targetX);
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

  async function onBust(payload) {
    log("bust received, alerting=" + alerting + " mode=" + payload.mode + " countdown=" + payload.countdown);
    if (alerting) { return; }
    alerting = true;
    const mine = interrupt();

    Cat.setSpeed(baseSpeed * 1.5);
    Cat.setState("angry");

    const nagging = payload.mode !== "close";
    let left = nagging ? 0 : payload.countdown;

    showBubble(
      nagging ? payload.label + "?" : pick(SCOLDS),
      nagging ? "seen" : left + "s",
      nagging ? "hint" : null
    );

    if (wander) {
      walkTo((window.innerWidth - boxW) / 2 + rand(-160, 160), mine);   // not awaited
    }

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

    if (stale(mine)) { return; }                 // snoozed mid-count

    let result = { acted: false, reason: "" };
    log("countdown done, calling act");
    try {
      result = await invoke("act", { target: payload.target });
    } catch (err) { log("act failed: " + err); }
    if (stale(mine)) { return; }

    Cat.setSpeed(baseSpeed);
    if (result && result.acted) {
      updateBubble("closed", "done");
      Cat.setState("pat");                       // pleased with itself
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
     pointer: click-through unless you are actually on the cat
  --------------------------------------------------------------- */
  let interactive = false;
  let dragging = false;
  let dragDx = 0;
  let moved = 0;

  function hot(cx, cy) {
    // the cat occupies roughly x 30..185, y 20..137 of its design box
    const left = x + 30 * unit;
    const right = x + 185 * unit;
    const top = window.innerHeight - 130 * unit;
    if (cx >= left && cx <= right && cy >= top && cy <= window.innerHeight) { return true; }
    if (!bubble.hidden) {
      const b = bubble.getBoundingClientRect();
      if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) { return true; }
    }
    return false;
  }

  function setInteractive(on) {
    if (on === interactive) { return; }
    interactive = on;
    invoke("set_interactive", { on }).catch(() => {});
  }

  window.addEventListener("mousemove", (e) => {
    if (dragging) {
      moved += 1;
      setX(clamp(e.clientX - dragDx));
      return;
    }
    setInteractive(hot(e.clientX, e.clientY));
  });

  window.addEventListener("mousedown", (e) => {
    if (!hot(e.clientX, e.clientY)) { return; }
    dragging = true;
    moved = 0;
    dragDx = e.clientX - x;
    interrupt();
    Cat.setState("bored");                       // dangling in mid-air
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) { return; }
    dragging = false;
    if (moved < 3) {
      if (alerting) { cancelToSnooze(); return; }
      const mine = interrupt();
      Cat.setState("pat");
      wait(3, mine).then(() => { if (!stale(mine)) { idleLoop(); } });
      return;
    }
    if (!alerting) { idleLoop(); }
  });

  window.addEventListener("dblclick", () => { invoke("open_settings", {}).catch(() => {}); });
  window.addEventListener("resize", () => setX(clamp(x)));

  /* ---------------------------------------------------------------
     wiring
  --------------------------------------------------------------- */
  listen("bust", (e) => onBust(e.payload)).then(() => {
    document.title += " listening";
    log("listening for bust");
  });

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
    Cat.setState(e.payload);
    wait(6, mine).then(() => { if (!stale(mine)) { idleLoop(); } });
  });

  invoke("get_config", {})
    .then((cfg) => applyCat(cfg && cfg.cat))
    .catch(() => {});

  idleLoop();
})();
