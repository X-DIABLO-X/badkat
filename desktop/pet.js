"use strict";

/* ------------------------------------------------------------------
   pet.js — the desktop brain
   ------------------------------------------------------------------
   cat.js knows how to *be* a cat. This file decides what the cat does:
   where it stands, when it wanders, and how it reacts when the main
   process reports that you are watching Reels again.

   Position is driven here rather than by cat.js's own roam, because on
   the desktop the cat has a whole screen to cross, not a 300-unit
   stage. Cat.groundSpeed() is what keeps the paws from skating.
------------------------------------------------------------------ */
(function () {
  /* Outside Electron (opening pet.html straight in a browser) there is
     no preload bridge. Stub it so the character and its behaviour can
     be developed and eyeballed without launching the whole app;
     window.__morphcatTest.bust() fakes an interception. */
  const api = window.morphcat || {
    onBust: (cb) => { window.__bustCb = cb; },
    onStatus: (cb) => { window.__statusCb = cb; },
    act: async () => ({ acted: true, mode: "tab" }),
    snooze: async () => ({ until: Date.now() + 300000 }),
    setInteractive: () => {}
  };

  const PX_PER_UNIT = 1.25;          // must match #pet's size in pet.css
  const BOX_W = 200 * PX_PER_UNIT;   // the rig's design box is 200 units wide
  const EDGE = 24;                   // keep this far from the screen edges

  const pet = document.getElementById("pet");
  const bubble = document.getElementById("bubble");
  const bubbleText = document.getElementById("bubbleText");
  const bubbleCount = document.getElementById("bubbleCount");

  gsap.registerPlugin(MorphSVGPlugin);
  CatRig.mount(document.getElementById("petScene"));
  Cat.init({ state: "sit", roam: false });      // we drive position ourselves

  /* ---------------------------------------------------------------
     position
  --------------------------------------------------------------- */
  let x = Math.round((window.innerWidth - BOX_W) / 2);
  gsap.set(pet, { x });

  const maxX = () => Math.max(EDGE, window.innerWidth - BOX_W - EDGE);
  const clamp = (v) => Math.min(maxX(), Math.max(EDGE, v));

  function setX(v) { x = v; gsap.set(pet, { x }); }

  /* ---------------------------------------------------------------
     a tiny interruptible-sequence helper

     Every behaviour is a chain of awaits. `epoch` is bumped whenever
     something more important happens (a bust, a drag, a pat), which
     makes every in-flight step resolve early and unwind the old chain
     instead of fighting the new one.
  --------------------------------------------------------------- */
  let epoch = 0;
  const stale = (mine) => mine !== epoch;

  function interrupt() { epoch++; return epoch; }

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
      const pps = Math.max(12, Cat.groundSpeed() * PX_PER_UNIT);
      const tween = gsap.to(pet, {
        x: dest,
        duration: distance / pps,
        ease: "none",
        onUpdate() { x = gsap.getProperty(pet, "x"); },
        onComplete() { clearInterval(poll); x = dest; resolve(); }
      });
      const poll = setInterval(() => {
        if (stale(mine)) { clearInterval(poll); tween.kill(); x = gsap.getProperty(pet, "x"); resolve(); }
      }, 120);
    });
  }

  /* ---------------------------------------------------------------
     idle life
  --------------------------------------------------------------- */
  const RESTS = ["sit", "sit", "bored", "sleep", "bored"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (a, b) => a + Math.random() * (b - a);

  async function idleLoop() {
    const mine = interrupt();
    while (!stale(mine)) {
      Cat.setSpeed(1);
      Cat.setState(pick(RESTS));
      await wait(rand(7, 18), mine);
      if (stale(mine)) { return; }

      await walkTo(rand(EDGE, maxX()), mine);
      if (stale(mine)) { return; }
      Cat.setState("sit");
      await wait(rand(1, 3), mine);
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
  let countdownCall = null;

  const SCOLDS = [
    "Shorts. Again.",
    "That's enough of that.",
    "Closing this one.",
    "You said you'd stop.",
    "Nope."
  ];

  async function onBust(payload) {
    if (alerting) { return; }
    alerting = true;
    const mine = interrupt();

    Cat.setSpeed(1.5);

    if (typeof Cat.alert === "function") {
      await Cat.alert();
      if (stale(mine)) { abandon(); return; }
    }

    // storm toward the middle of the screen, ears back, 💢 up
    Cat.setState("angry");

    const label = payload.rule.label;
    const nagging = payload.mode !== "close";
    let left = nagging ? 0 : payload.countdown;

    showBubble(nagging ? label + "?" : pick(SCOLDS),
      nagging ? "seen" : left + "s", nagging ? "hint" : null);

    const centre = (window.innerWidth - BOX_W) / 2 + rand(-160, 160);
    walkTo(centre, mine);                       // deliberately not awaited

    if (nagging) {
      await wait(2.6, mine);
      finish(mine, "nag");
      return;
    }

    await new Promise((resolve) => {
      countdownCall = setInterval(() => {
        left -= 1;
        if (left <= 0) { clearInterval(countdownCall); countdownCall = null; resolve(); }
        else { updateBubble(left + "s"); }
      }, 1000);
    });

    if (stale(mine)) { return; }                // the user snoozed mid-count

    // the paw swipe IS the close: api.act() fires on the strike frame
    let actCall = null;
    Cat.setSpeed(1);
    await Cat.swipe(() => {
      if (stale(mine)) { return; }
      updateBubble("", "done");
      actCall = api.act(payload.target, payload.mode);
    });
    if (stale(mine)) { return; }

    const result = await (actCall || api.act(payload.target, payload.mode));
    if (stale(mine)) { return; }

    if (result && result.acted) {
      updateBubble("closed", "done");
      Cat.setSpeed(1);
      Cat.setState("pat");                      // pleased with itself
    } else {
      updateBubble("let it go", "hint");
      Cat.setSpeed(1);
      Cat.setState("sit");
    }
    await wait(2.2, mine);
    finish(mine, "done");
  }

  function finish(mine, _why) {
    if (stale(mine)) { return; }
    alerting = false;
    hideBubble();
    Cat.setSpeed(1);
    idleLoop();
  }

  async function cancelToSnooze() {
    if (!alerting) { return; }
    if (countdownCall) { clearInterval(countdownCall); countdownCall = null; }
    alerting = false;
    interrupt();
    await api.snooze();
    Cat.setSpeed(1);
    Cat.setState("pat");
    showBubble("Fine. Five minutes.", "snoozed", "hint");
    setTimeout(() => { hideBubble(); idleLoop(); }, 2000);
  }

  /* ---------------------------------------------------------------
     pointer: click-through unless you are actually on the cat
  --------------------------------------------------------------- */
  let interactive = false;
  let dragging = false;
  let dragDx = 0;
  let movedWhileDown = 0;

  function hot(clientX, clientY) {
    // the cat occupies roughly x 30..185, y 20..137 of its design box
    const u = PX_PER_UNIT;
    const catBox = {
      left: x + 30 * u,
      right: x + 185 * u,
      top: window.innerHeight - 130 * u,
      bottom: window.innerHeight
    };
    if (clientX >= catBox.left && clientX <= catBox.right &&
        clientY >= catBox.top && clientY <= catBox.bottom) { return true; }
    if (!bubble.hidden) {
      const b = bubble.getBoundingClientRect();
      if (clientX >= b.left && clientX <= b.right && clientY >= b.top && clientY <= b.bottom) { return true; }
    }
    return false;
  }

  function setInteractive(on) {
    if (on === interactive) { return; }
    interactive = on;
    api.setInteractive(on);
  }

  window.addEventListener("mousemove", (e) => {
    if (dragging) {
      movedWhileDown += 1;
      setX(clamp(e.clientX - dragDx));
      return;
    }
    setInteractive(hot(e.clientX, e.clientY));
  });

  window.addEventListener("mousedown", (e) => {
    if (!hot(e.clientX, e.clientY)) { return; }
    dragging = true;
    movedWhileDown = 0;
    dragDx = e.clientX - x;
    interrupt();
    Cat.setState("bored");                      // dangling in mid-air
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) { return; }
    dragging = false;
    if (movedWhileDown < 3) {
      // a click, not a drag
      if (alerting) { cancelToSnooze(); return; }
      const mine = interrupt();
      Cat.setState("pat");
      wait(3, mine).then(() => { if (!stale(mine)) { idleLoop(); } });
      return;
    }
    if (!alerting) { idleLoop(); }
  });

  /* ---------------------------------------------------------------
     wiring
  --------------------------------------------------------------- */
  api.onBust(onBust);

  api.onStatus((s) => {
    // The cat notices a few seconds before it acts: it stops what it is
    // doing and stares. That pause is the actual warning.
    if (alerting || dragging) { return; }
    if (s.watching && s.remaining <= 5) {
      if (Cat.getState() !== "sit") {
        const mine = interrupt();
        Cat.setState("sit");
        wait(6, mine).then(() => { if (!stale(mine)) { idleLoop(); } });
      }
    }
  });

  window.addEventListener("resize", () => setX(clamp(x)));

  /* dev harness, only reachable when running outside Electron */
  if (!window.morphcat) {
    window.__morphcatTest = {
      bust: (label, mode) => onBust({
        rule: { id: "test", label: label || "YouTube Shorts" },
        target: { hwnd: 1, title: "test", proc: "chrome" },
        mode: mode || "close",
        countdown: 3
      }),
      walkTo: (px) => walkTo(px, epoch),
      state: (name) => { interrupt(); Cat.setState(name); },
      swipe: () => { interrupt(); return Cat.swipe(); },
      idle: () => idleLoop()
    };
  }

  idleLoop();
})();
