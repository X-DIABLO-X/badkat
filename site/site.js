/* ------------------------------------------------------------------
   site.js — the landing page
   ------------------------------------------------------------------
   Two jobs: run the real cat rig in the hero, and ask GitHub what the
   latest release is so the download button points at a real file
   instead of a page the visitor has to go hunting through.
------------------------------------------------------------------ */
(function () {
  "use strict";

  var REPO = "X-DIABLO-X/badcat";

  /* ---------------- the live cat ---------------- */
  if (window.CatRig && window.Cat && window.gsap) {
    if (window.MorphSVGPlugin) { gsap.registerPlugin(MorphSVGPlugin); }

    var mount = document.getElementById("sceneCat");
    if (mount) {
      CatRig.mount(mount, { offsetX: 50, offsetY: 12 });
      Cat.init({ state: "sit", roam: true });

      var row = document.getElementById("poseRow");
      row.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) { return; }

        Array.prototype.forEach.call(row.children, function (n) { n.classList.remove("on"); });

        if (b.dataset.act === "swipe") {
          b.classList.add("on");
          Cat.swipe();
          return;
        }
        if (b.dataset.act === "levelup") {
          b.classList.add("on");
          // the site has no save file, so just show the thing itself
          Cat.gainXp(25);
          gsap.delayedCall(0.45, function () { Cat.levelUp(5); });
          return;
        }
        b.classList.add("on");
        Cat.setState(b.dataset.state);
      });
    }
  }

  /* ---------------- the latest release ---------------- */
  /* The GitHub API is called from the visitor's browser, unauthenticated
     and read-only, so there is no token here and nothing to leak. If it
     is rate-limited or offline the buttons still work — they already
     point at /releases/latest, which resolves server-side. */
  var heroVersion = document.getElementById("heroVersion");
  var dlMeta = document.getElementById("dlMeta");
  var dlPrimary = document.getElementById("dlPrimary");

  function human(bytes) {
    if (!bytes) { return ""; }
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function whenDate(iso) {
    if (!iso) { return ""; }
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric"
      });
    } catch (_) { return ""; }
  }

  function noRelease() {
    if (heroVersion) { heroVersion.textContent = "No release published yet — build it from source on GitHub."; }
    if (dlMeta) { dlMeta.textContent = "No release published yet. The source is on GitHub."; }
  }

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
    headers: { Accept: "application/vnd.github+json" }
  })
    .then(function (r) {
      if (!r.ok) { throw new Error("status " + r.status); }
      return r.json();
    })
    .then(function (rel) {
      if (!rel || !rel.tag_name) { noRelease(); return; }

      // the installer, not the updater's .zip/.sig sidecars
      var setup = (rel.assets || []).filter(function (a) {
        return /setup\.exe$/i.test(a.name);
      })[0];

      var bits = [rel.tag_name];
      if (setup) { bits.push(human(setup.size)); }
      var when = whenDate(rel.published_at);
      if (when) { bits.push(when); }

      if (heroVersion) {
        heroVersion.textContent = "Latest: " + bits.join(" · ") + " — Windows 10 and 11.";
      }
      if (dlMeta) {
        dlMeta.textContent = setup
          ? bits.join(" · ") + " — installs without admin rights."
          : bits.join(" · ");
      }
      if (setup && dlPrimary) {
        dlPrimary.href = setup.browser_download_url;
        dlPrimary.textContent = "Download " + rel.tag_name + " for Windows";
      }
    })
    .catch(function () {
      // rate limited, offline, or no releases yet — leave the buttons be
      if (heroVersion) { heroVersion.textContent = "Windows 10 and 11 · installs without admin rights."; }
      if (dlMeta) { dlMeta.textContent = "Pick the .exe installer from the latest release."; }
    });
})();
