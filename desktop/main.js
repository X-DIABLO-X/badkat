"use strict";

/* ------------------------------------------------------------------
   main.js — the Electron main process
   ------------------------------------------------------------------
   Owns three things:
     1. the transparent overlay strip along the bottom of the screen
     2. the foreground-window monitor and the rule evaluation on top
     3. the tray menu

   The renderer never sees a window handle or gets to close anything on
   its own -- it asks, and main re-verifies before the paw lands.
------------------------------------------------------------------ */

const { app, BrowserWindow, Tray, Menu, screen, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const { Monitor } = require("./monitor");
const enforcer = require("./enforcer");
const rulesLib = require("./rules");

const OVERLAY_HEIGHT = 260;
const DIAGNOSE = process.argv.includes("--diagnose");
const COOLDOWN_MS = 12000;        // after acting, ignore the same window briefly

let win = null;
let tray = null;
let monitor = null;
let config = rulesLib.DEFAULT_CONFIG;
let configPath = null;

let lastMatchId = null;
let matchSince = 0;
let configError = null;
let snoozeUntil = 0;
let cooldownUntil = 0;
let pendingKey = null;            // the window we have already reacted to
const trail = [];                 // recent decisions, surfaced by --diagnose

function note(event, detail) {
  trail.push(Object.assign({ at: new Date().toISOString(), event }, detail || {}));
  if (trail.length > 20) { trail.shift(); }
  if (DIAGNOSE) { console.log("[morphcat] " + event, JSON.stringify(detail || {})); }
}

/* ---------------------------------------------------------------
   config
--------------------------------------------------------------- */
function loadConfig() {
  configPath = path.join(app.getPath("userData"), "config.json");
  try {
    if (fs.existsSync(configPath)) {
      // Notepad, Set-Content and most Windows editors write UTF-8 with a
      // BOM, and JSON.parse throws on it. Since the whole point of this
      // file is that people hand-edit it, strip it.
      const text = fs.readFileSync(configPath, "utf8").replace(/^﻿/, "");
      config = rulesLib.withDefaults(JSON.parse(text));
      if (config.__dropped && config.__dropped.length) {
        console.error("[morphcat] ignoring unusable rules: " + config.__dropped.join(", ") +
          " (each rule needs an id and a non-empty all/any list)");
      }
    } else {
      config = rulesLib.withDefaults({});
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    }
  } catch (err) {
    console.error("[morphcat] config unreadable, using defaults:", err.message);
    config = rulesLib.withDefaults({});
    configError = err.message;
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.error("[morphcat] could not save config:", err.message);
  }
}

/* ---------------------------------------------------------------
   overlay window
--------------------------------------------------------------- */
function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    x: area.x,
    y: area.y + area.height - OVERLAY_HEIGHT,
    width: area.width,
    height: OVERLAY_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,           // never steals focus from what you are doing
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // click-through by default; the renderer opts in when you hover the cat
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, "pet.html"));
  win.once("ready-to-show", () => win.show());

  // the overlay has no devtools you can click into, so surface renderer
  // errors on the main process stdout where they are actually visible
  win.webContents.on("console-message", (_e, level, message, line, source) => {
    if (level >= 2) {
      console.error("[morphcat overlay] " + message + " (" + source + ":" + line + ")");
    }
  });
  win.webContents.on("render-process-gone", (_e, details) =>
    console.error("[morphcat overlay] renderer gone:", details.reason));

  // `--diagnose` writes a PNG of the overlay plus a state dump next to
  // the app. A transparent, always-on-top window is invisible to most
  // screen-capture APIs, so this is the only reliable way to see what
  // the cat is actually doing.
  if (DIAGNOSE) { win.once("ready-to-show", () => setInterval(diagnose, 2500)); }

  // keep the strip glued to the bottom if the display changes
  screen.on("display-metrics-changed", reposition);
  screen.on("display-added", reposition);
  screen.on("display-removed", reposition);
}

function reposition() {
  if (!win || win.isDestroyed()) { return; }
  const area = screen.getPrimaryDisplay().workArea;
  win.setBounds({
    x: area.x,
    y: area.y + area.height - OVERLAY_HEIGHT,
    width: area.width,
    height: OVERLAY_HEIGHT
  });
}

async function diagnose() {
  const dir = path.join(__dirname, "..");
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, ".shot-pet.png"), image.toPNG());

    const state = await win.webContents.executeJavaScript(`(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      catState: window.Cat && Cat.getState(),
      petTransform: getComputedStyle(document.getElementById("pet")).transform,
      bodyPath: (document.getElementById("body") || {}).getAttribute
        ? document.getElementById("body").getAttribute("d").slice(0, 24) : null,
      bubbleHidden: document.getElementById("bubble").hidden
    }))()`);

    state.trail = trail.slice(-8);
    state.mode = config.mode;
    state.configError = configError;
    state.ruleCount = config.rules.length;
    state.foreground = monitor && monitor.current
      ? {
          title: monitor.current.title,
          url: monitor.current.url,
          proc: monitor.current.proc,
          heldByRule: Math.round((Date.now() - matchSince) / 1000)
        }
      : null;
    fs.writeFileSync(path.join(dir, ".shot-pet.json"), JSON.stringify(state, null, 2));
    console.log("[morphcat] diagnose written");
  } catch (err) {
    fs.writeFileSync(path.join(dir, ".shot-pet.json"),
      JSON.stringify({ error: err.message }, null, 2));
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) { win.webContents.send(channel, payload); }
}

/* ---------------------------------------------------------------
   the watch
--------------------------------------------------------------- */
function keyOf(snapshot) {
  return snapshot.hwnd + "|" + snapshot.title + "|" + (snapshot.url || "");
}

function startMonitor() {
  monitor = new Monitor({ pollMs: config.pollMs });

  monitor.on("error", (err) => console.error("[morphcat monitor]", err.message));

  monitor.on("change", () => { pendingKey = null; });

  monitor.on("tick", (snapshot) => {
    const now = Date.now();
    if (now < snoozeUntil || now < cooldownUntil) { return; }

    const rule = rulesLib.match(config, snapshot);
    if (!rule) {
      lastMatchId = null;
      send("status", { watching: false });
      return;
    }

    // The clock runs per matched rule, not per window: switching from a
    // work tab to Reels inside an already-focused browser has to start
    // the grace at zero, and swiping to the next reel must not.
    const matchId = rule.id + "|" + snapshot.hwnd;
    if (lastMatchId !== matchId) {
      lastMatchId = matchId;
      matchSince = now;
      note("matched", { rule: rule.id, url: snapshot.url, title: snapshot.title, grace: rule.grace });
    }
    const held = (now - matchSince) / 1000;

    const key = keyOf(snapshot);
    const remaining = Math.max(0, rule.grace - held);

    if (remaining > 0) {
      // the cat notices before it acts: this is what drives the ears
      // going back a few seconds before anything closes
      send("status", { watching: true, label: rule.label, remaining });
      return;
    }
    if (pendingKey === key) { return; }
    pendingKey = key;
    note("bust", { rule: rule.id, url: snapshot.url, title: snapshot.title, mode: config.mode });

    send("bust", {
      rule: { id: rule.id, label: rule.label },
      target: snapshot,
      mode: config.mode,
      countdown: Math.max(0, config.countdownSeconds)
    });
  });

  monitor.start();
}

/* ---------------------------------------------------------------
   ipc
--------------------------------------------------------------- */
ipcMain.handle("act", async (_e, { target, mode }) => {
  if (config.mode !== "close") {
    return { acted: false, reason: "nag-mode" };
  }
  const rule = rulesLib.match(config, target) || {};
  const action = rulesLib.actionFor(rule, target);
  const result = await enforcer.closeTarget(target, action);
  note("act", { action, acted: result.acted, reason: result.reason || null, title: target.title });

  cooldownUntil = Date.now() + COOLDOWN_MS;
  pendingKey = null;
  return result;
});

ipcMain.handle("snooze", () => {
  snoozeUntil = Date.now() + config.snoozeMinutes * 60 * 1000;
  pendingKey = null;
  refreshTray();
  return { until: snoozeUntil };
});

ipcMain.on("set-interactive", (_e, on) => {
  if (!win || win.isDestroyed()) { return; }
  win.setIgnoreMouseEvents(!on, { forward: true });
});

/* ---------------------------------------------------------------
   tray
--------------------------------------------------------------- */
function refreshTray() {
  if (!tray) { return; }
  const { trayIcon } = require("./tray-icon");
  const snoozing = Date.now() < snoozeUntil;
  const paused = !config.enabled || snoozing;

  tray.setImage(trayIcon(paused));
  tray.setToolTip(paused ? "morphcat — paused" : "morphcat — on patrol");

  const minsLeft = snoozing ? Math.ceil((snoozeUntil - Date.now()) / 60000) : 0;

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: snoozing ? `Snoozed (${minsLeft} min left)` : (config.enabled ? "On patrol" : "Paused"), enabled: false },
    { type: "separator" },
    {
      label: "Enabled",
      type: "checkbox",
      checked: config.enabled,
      click: (item) => { config.enabled = item.checked; saveConfig(); refreshTray(); }
    },
    {
      label: "Close distractions",
      type: "radio",
      checked: config.mode === "close",
      click: () => { config.mode = "close"; saveConfig(); refreshTray(); }
    },
    {
      label: "Only complain (nag)",
      type: "radio",
      checked: config.mode === "nag",
      click: () => { config.mode = "nag"; saveConfig(); refreshTray(); }
    },
    { type: "separator" },
    {
      label: snoozing ? "Cancel snooze" : `Snooze ${config.snoozeMinutes} min`,
      click: () => {
        snoozeUntil = snoozing ? 0 : Date.now() + config.snoozeMinutes * 60 * 1000;
        refreshTray();
      }
    },
    {
      label: win && win.isVisible() ? "Hide the cat" : "Show the cat",
      click: () => {
        if (!win) { return; }
        if (win.isVisible()) { win.hide(); } else { win.show(); }
        refreshTray();
      }
    },
    { type: "separator" },
    { label: "Edit rules…", click: () => shell.openPath(configPath) },
    { label: "Reload rules", click: () => { loadConfig(); refreshTray(); } },
    { type: "separator" },
    { label: "Quit", click: () => { app.quit(); } }
  ]));
}

function createTray() {
  const { trayIcon } = require("./tray-icon");
  tray = new Tray(trayIcon(false));
  refreshTray();
  setInterval(refreshTray, 30000);   // keeps the snooze countdown honest
}

/* ---------------------------------------------------------------
   lifecycle
--------------------------------------------------------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadConfig();
    createWindow();
    createTray();
    startMonitor();
  });
}

app.on("window-all-closed", (e) => { e.preventDefault(); });  // tray app: keep running

app.on("before-quit", () => {
  if (monitor) { monitor.stop(); }
});
