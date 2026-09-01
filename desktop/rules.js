"use strict";

/* ------------------------------------------------------------------
   rules.js — what counts as doomscrolling, and how long a leash
   ------------------------------------------------------------------
   Rules match against the foreground window's URL, title and process
   name together, all lowercased. `all` patterns must every one match;
   `any` needs a single hit. `grace` is how many seconds that rule has
   to keep holding the foreground before the cat gets up.

   Both URL and title matter, because neither is enough alone:

     - A browser only exposes the site's own <title>, so Instagram Reels
       reads as "Instagram" and a YouTube Short as "<name> - YouTube".
       Only the URL says reels/shorts.
     - A browser playing fullscreen video has no address bar in its UI
       tree at all, so the URL is empty exactly when you are watching a
       film. Only the title says Crunchyroll/Netflix.

   Patterns are strings, not RegExp literals, so the whole rule set can
   live in an editable JSON config.
------------------------------------------------------------------ */

const DEFAULT_CONFIG = {
  enabled: true,
  /* "close" acts on the window. "nag" only shows the cat being cross,
     which is the setting to use while you are still calibrating rules. */
  mode: "close",
  countdownSeconds: 3,
  snoozeMinutes: 5,
  pollMs: 1000,

  /* A window whose title matches any of these is never touched, no
     matter what else it matches. Escape hatch for false positives. */
  never: ["zoom meeting", "microsoft teams", "google meet"],

  rules: [
    {
      id: "youtube-shorts",
      label: "YouTube Shorts",
      any: ["youtube.com/shorts"],
      grace: 6,
      action: "tab"
    },
    {
      id: "instagram-reels",
      label: "Instagram Reels",
      any: ["instagram.com/reel"],
      grace: 6,
      action: "tab"
    },
    {
      id: "tiktok",
      label: "TikTok",
      any: ["tiktok.com"],
      grace: 6,
      action: "tab"
    },
    {
      id: "facebook-reels",
      label: "Facebook Reels",
      any: ["facebook.com/reel", "facebook.com/watch", "fb.watch"],
      grace: 10,
      action: "tab"
    },
    {
      id: "snapchat",
      label: "Snapchat",
      any: ["snapchat.com"],
      grace: 15,
      action: "tab"
    },
    {
      id: "streaming",
      label: "Streaming",
      any: [
        "netflix.com", "netflix",
        "primevideo.com", "prime video",
        "hotstar.com", "hotstar",
        "disneyplus.com", "disney+",
        "crunchyroll",
        "hulu.com",
        "jiocinema", "sonyliv", "zee5", "aha.video", "mxplayer",
        "peacocktv.com", "tv.apple.com", "max.com/video"
      ],
      grace: 20,
      action: "tab"
    },
    {
      id: "instagram",
      label: "Instagram",
      any: ["instagram.com"],
      grace: 45,
      action: "tab"
    },
    {
      id: "reddit",
      label: "Reddit",
      any: ["reddit.com"],
      grace: 90,
      action: "tab"
    },
    {
      id: "youtube-watch",
      label: "YouTube",
      any: ["youtube.com/watch", "- youtube"],
      grace: 240,           // a long leash: plenty of YouTube is work
      action: "tab"
    }
  ]
};

/* Browsers get Ctrl+W (close the tab). Anything else gets WM_CLOSE. */
const BROWSERS = new Set([
  "chrome", "msedge", "firefox", "brave", "opera", "vivaldi",
  "arc", "chromium", "librewolf", "zen"
]);

function normalise(s) {
  return String(s || "").toLowerCase();
}

/* Returns the first matching rule, or null. */
function match(config, snapshot) {
  if (!config.enabled) { return null; }

  const title = normalise(snapshot.title);
  const proc = normalise(snapshot.proc);
  const url = normalise(snapshot.url);

  // URL first: it is the only place "reels" / "shorts" ever appears.
  // Title second: it is all that is left when a browser goes fullscreen
  // for video and drops its address bar out of the UI tree.
  const hay = url + " | " + title + " | " + proc;

  if (!title && !url) { return null; }

  for (const pattern of config.never || []) {
    if (hay.includes(normalise(pattern))) { return null; }
  }

  for (const rule of config.rules || []) {
    const all = rule.all || [];
    const any = rule.any || [];

    const allHit = all.every((p) => hay.includes(normalise(p)));
    const anyHit = any.length === 0 || any.some((p) => hay.includes(normalise(p)));

    if (all.length + any.length > 0 && allHit && anyHit) {
      return rule;
    }
  }
  return null;
}

/* A browser tab is cheap to close; a desktop app is not. */
function actionFor(rule, snapshot) {
  const proc = normalise(snapshot.proc);
  if (rule.action === "close") { return "close"; }
  return BROWSERS.has(proc) ? "tab" : "close";
}

/* A rule the matcher can actually use: an object with an id and at
   least one pattern. Anything else would sit in the list matching
   nothing, which looks exactly like the app being broken. */
function validRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) { return false; }
  if (typeof rule.id !== "string" || !rule.id) { return false; }
  const all = Array.isArray(rule.all) ? rule.all : [];
  const any = Array.isArray(rule.any) ? rule.any : [];
  return all.length + any.length > 0;
}

/* Fill in anything a hand-edited config left out, and drop anything the
   matcher could not use. Returns { config, dropped } so the caller can
   tell the user which of their rules were ignored. */
function withDefaults(partial) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, partial || {});
  const dropped = [];

  if (Array.isArray(cfg.rules)) {
    cfg.rules = cfg.rules.filter((r, i) => {
      if (validRule(r)) { return true; }
      dropped.push(r && r.id ? r.id : "rule #" + i);
      return false;
    });
  }
  if (!Array.isArray(cfg.rules) || !cfg.rules.length) {
    cfg.rules = DEFAULT_CONFIG.rules;
  }
  if (!Array.isArray(cfg.never)) { cfg.never = DEFAULT_CONFIG.never; }

  cfg.rules.forEach((r) => {
    if (typeof r.grace !== "number" || r.grace < 0) { r.grace = 10; }
  });

  Object.defineProperty(cfg, "__dropped", { value: dropped, enumerable: false });
  return cfg;
}

module.exports = { DEFAULT_CONFIG, match, actionFor, withDefaults, validRule, BROWSERS };
