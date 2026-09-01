/* ------------------------------------------------------------------
   main.js — UI wiring
------------------------------------------------------------------ */
(function () {
  "use strict";

  var START = "sit";
  var buttons = Array.prototype.slice.call(
    document.querySelectorAll("#controls button")
  );
  var speed = document.getElementById("speed");
  var speedOut = document.getElementById("speedOut");
  var fallback = document.getElementById("fallback");

  function paint(state) {
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.state === state));
    });
  }

  function go(state) {
    Cat.setState(state);
    paint(state);
  }

  buttons.forEach(function (b) {
    b.addEventListener("click", function () { go(b.dataset.state); });
  });

  document.addEventListener("keydown", function (e) {
    var map = {
      "1": "walk", "2": "sit", "3": "sleep",
      "4": "pat", "5": "angry", "6": "bored"
    };
    if (map[e.key]) { go(map[e.key]); }
  });

  speed.addEventListener("input", function () {
    var v = parseFloat(speed.value);
    Cat.setSpeed(v);
    speedOut.textContent = v.toFixed(2) + "×";
  });

  // clicking the cat pats it — but wake a sleeping cat and you get a hiss
  document.getElementById("stage").addEventListener("click", function (e) {
    if (e.target.closest("button")) { return; }
    go(Cat.getState() === "sleep" ? "angry" : "pat");
  });

  if (!Cat.hasMorph) {
    fallback.hidden = false;
    fallback.textContent = "MorphSVGPlugin did not load — poses will snap instead of morph.";
  }

  // offset 38 centres the character in the demo's wider 300-unit stage
  CatRig.mount(document.getElementById("scene"), {
    offsetX: 38,
    before: document.getElementById("vignetteRect")
  });

  Cat.init(START);
  paint(START);
  speedOut.textContent = "1.00×";
})();
