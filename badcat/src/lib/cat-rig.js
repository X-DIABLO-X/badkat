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
    '<g id="anger" aria-hidden="true">',
    '  <path class="anger-mark" d="M0,0" /><path class="anger-mark" d="M0,0" />',
    '  <path class="anger-mark" d="M0,0" /><path class="anger-mark" d="M0,0" />',
    '</g>',

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
