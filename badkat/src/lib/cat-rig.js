/* ------------------------------------------------------------------
   cat-rig.js — the SVG markup for the character
   ------------------------------------------------------------------
   Two surfaces mount this rig: the demo page and the desktop overlay.
   Keeping the markup here rather than in either HTML file means the
   element ids cat.js reaches for can never drift between them.

   Everything is drawn in a 0 0 200 150 design space:
     the floor sits at y = 137, the cat spans roughly x = 30..185.
------------------------------------------------------------------ */
(function (global) {
  "use strict";

  var MARKUP = [
    '<defs>',
    '  <filter id="catSoftShadow" x="-30%" y="-120%" width="160%" height="340%">',
    '    <feGaussianBlur stdDeviation="2.6" />',
    '  </filter>',
    '</defs>',

    '<ellipse id="shadow" cx="100" cy="138" rx="56" ry="5" filter="url(#catSoftShadow)" />',

    '<path id="legBF" class="leg leg--far" d="M0,0" />',
    '<path id="legFF" class="leg leg--far" d="M0,0" />',

    '<g id="bodyGroup">',
    '  <path id="tail" class="tail" d="M0,0" />',
    '  <path id="body" class="fur" d="M0,0" />',
    '</g>',

    '<path id="legBN" class="leg" d="M0,0" />',
    '<path id="legFN" class="leg" d="M0,0" />',

    // headBob carries the animation offset, headGroup carries the pose
    '<g id="headBob">',
    '  <g id="headGroup">',
    '    <path id="head" class="fur" d="M0,0" />',
    '    <path id="earL" class="ear-inner" d="M0,0" />',
    '    <path id="earR" class="ear-inner" d="M0,0" />',
    '    <path id="eyeL" class="eye" d="M0,0" />',
    '    <path id="eyeR" class="eye" d="M0,0" />',
    '    <path id="mouth" class="mouth" d="M0,0" />',
    '  </g>',
    '</g>',

    // props — each is only shown by the states that use it
    // anger: three arc bands, each a filled shape carrying its own dark
    // border, which is what gives the vein-pop symbol its cartoon edge.
    '<g id="anger" aria-hidden="true">',
    '  <path class="anger-mark" d="M0,0" /><path class="anger-mark" d="M0,0" />',
    '  <path class="anger-mark" d="M0,0" />',
    '</g>',

    '<path id="pawprint" class="pawprint" aria-hidden="true" d="M0,0" />',

    // level-up: faint rising streaks behind, then sparkles and dots
    // around a dark "Lv. N" pill. Painted back-to-front in that order.
    '<g id="levelup" aria-hidden="true">',
    '  <g id="lvlStreaks">',
    '    <rect class="streak" x="-0.6" y="-11" width="1.2" height="22" rx="0.6" />',
    '    <rect class="streak" x="-0.6" y="-11" width="1.2" height="22" rx="0.6" />',
    '    <rect class="streak" x="-0.6" y="-11" width="1.2" height="22" rx="0.6" />',
    '    <rect class="streak" x="-0.6" y="-11" width="1.2" height="22" rx="0.6" />',
    '  </g>',
    '  <g id="lvlSparks">',
    '    <path class="lvl-spark" d="M0,0" /><path class="lvl-spark" d="M0,0" />',
    '    <path class="lvl-spark" d="M0,0" /><path class="lvl-spark" d="M0,0" />',
    '    <circle class="lvl-dot" cx="0" cy="0" r="1.05" />',
    '    <circle class="lvl-dot" cx="0" cy="0" r="1.05" />',
    '    <circle class="lvl-dot" cx="0" cy="0" r="1.05" />',
    '    <circle class="lvl-dot" cx="0" cy="0" r="1.05" />',
    '  </g>',
    '  <g id="lvlBadge">',
    '    <rect id="lvlPill" class="lvl-pill" x="-24" y="-7.6" width="48" height="15.2" rx="7.6" />',
    '    <text id="lvlText" class="lvl-text" x="0" y="0">Lv. 1</text>',
    '    <path id="lvlArrow" class="lvl-arrow" d="M0,-4.1 L3.5,0.1 L1.45,0.1 L1.45,4.1 L-1.45,4.1 L-1.45,0.1 L-3.5,0.1 Z" />',
    '  </g>',
    '</g>',

    // "+25 XP", floating up off the cat every time XP lands. Its own
    // element rather than part of #levelup: most XP never levels
    // anything, so this has to be able to play entirely on its own.
    '<text id="xpFloat" class="xp-float" x="0" y="0" aria-hidden="true">+0 XP</text>',

    '<g id="hearts" aria-hidden="true">',
    '  <path class="heart" d="M0,0" /><path class="heart" d="M0,0" /><path class="heart" d="M0,0" />',
    '</g>',

    '<g id="zzz" aria-hidden="true">',
    '  <text class="z" x="0" y="0">z</text><text class="z" x="0" y="0">z</text>',
    '  <text class="z" x="0" y="0">z</text>',
    '</g>'
  ].join("\n");

  /* Mounts the rig into `parent` (an <svg> or <g>).
     opts.offsetX / opts.offsetY shift the whole character, which is how
     the demo centres it in its wider stage without touching #cat --
     #cat itself is left free for GSAP to drive. opts.before inserts the
     rig ahead of an existing node, so overlays stay on top. */
  function mount(parent, opts) {
    opts = opts || {};
    var root = document.createElementNS("http://www.w3.org/2000/svg", "g");
    root.setAttribute("id", "catRoot");
    if (opts.offsetX || opts.offsetY) {
      root.setAttribute("transform",
        "translate(" + (opts.offsetX || 0) + ", " + (opts.offsetY || 0) + ")");
    }

    var cat = document.createElementNS("http://www.w3.org/2000/svg", "g");
    cat.setAttribute("id", "cat");
    cat.innerHTML = MARKUP;

    root.appendChild(cat);
    if (opts.before) { parent.insertBefore(root, opts.before); }
    else { parent.appendChild(root); }
    return cat;
  }

  global.CatRig = { markup: MARKUP, mount: mount };
})(window);
