"use strict";

/* ------------------------------------------------------------------
   hit.js — the whole reason this window exists
   ------------------------------------------------------------------
   Windows offers no way to make ONE window click-through everywhere
   except a moving region: set_ignore_cursor_events is all-or-nothing,
   and WM_NCHITTEST subclassing (the standard per-pixel technique) is
   not honoured by WebView2's own input routing — both were tried and
   measurably failed before this file existed.

   So the "pet" window (the actual cat) is permanently click-through,
   and this separate, tiny, ordinary window sits on top of it wherever
   the cat currently is — moved there by Rust's set_hitbox(), itself
   driven by pet.js reporting the cat's position. An ordinary small
   window naturally only blocks clicks within its own bounds; nothing
   clever is needed for that part, which is the whole point.

   This file's only job is forwarding raw pointer events to "pet" using
   OS-absolute PHYSICAL screen pixels, so pet.js doesn't need to know
   this window's current position to interpret them — it already knows
   its own (the overlay always sits at the work area's origin), and
   Rust's side of every position calculation (work_area, PhysicalSize,
   PhysicalPosition) is in physical pixels throughout.

   e.screenX/screenY are NOT physical pixels, though — a webview
   reports them in CSS/logical pixels, scaled down by the system's DPI
   factor (measurably: at 125% scaling a physical 778px click came back
   as e.screenX 622, exactly /1.25). window.devicePixelRatio is that
   same factor, so multiplying by it is what makes these numbers land
   in the same space Rust is already working in.
------------------------------------------------------------------ */
(function () {
  const T = window.__TAURI__;
  if (!T) { return; }                 // opened outside Tauri: nothing to relay to

  const emit = (name, e) => {
    const dpr = window.devicePixelRatio || 1;
    T.event.emit(name, { x: Math.round(e.screenX * dpr), y: Math.round(e.screenY * dpr) }).catch(() => {});
  };

  window.addEventListener("mousedown", (e) => emit("hit-down", e));
  window.addEventListener("mousemove", (e) => emit("hit-move", e));
  window.addEventListener("mouseup", (e) => emit("hit-up", e));

  // a double-click on the cat opens settings, same as before
  window.addEventListener("dblclick", () => {
    T.core.invoke("open_settings", {}).catch(() => {});
  });
})();
