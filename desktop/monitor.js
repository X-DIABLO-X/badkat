"use strict";

/* ------------------------------------------------------------------
   monitor.js — who is in front, and for how long
   ------------------------------------------------------------------
   Wraps the long-lived PowerShell watcher. The watcher only speaks when
   the foreground window changes, so this module keeps the last snapshot
   and runs its own 1s tick to measure dwell time.

   Nothing leaves the machine: the only thing read is the title and
   process name of the window that already has your attention.
------------------------------------------------------------------ */

const { spawn } = require("child_process");
const path = require("path");
const { EventEmitter } = require("events");

class Monitor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.pollMs = opts.pollMs || 1000;
    this.child = null;
    this.current = null;      // { hwnd, procId, proc, title }
    this.since = 0;           // Date.now() when `current` came to front
    this.ticker = null;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this._spawn();
    this.ticker = setInterval(() => this._tick(), 500);
  }

  stop() {
    this.stopped = true;
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    if (this.child) { this.child.kill(); this.child = null; }
  }

  /* Seconds the current foreground window has been in front. */
  heldSeconds() {
    return this.since ? (Date.now() - this.since) / 1000 : 0;
  }

  _spawn() {
    const script = path.join(__dirname, "scripts", "watch-foreground.ps1");
    this.child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", script, "-IntervalMs", String(this.pollMs)
    ], { windowsHide: true });

    let buffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) { this._onLine(line); }
      }
    });

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (d) => this.emit("error", new Error(String(d).trim())));

    this.child.on("exit", (code) => {
      this.child = null;
      if (!this.stopped) {
        // the watcher should never exit on its own; if it does, bring it back
        this.emit("error", new Error("foreground watcher exited (" + code + "), restarting"));
        setTimeout(() => { if (!this.stopped) { this._spawn(); } }, 2000);
      }
    });
  }

  _onLine(line) {
    let payload;
    try { payload = JSON.parse(line); } catch (_) { return; }
    if (payload.error) { this.emit("error", new Error(payload.error)); return; }

    // Only a change of window restarts the focus clock. Title and URL
    // churn constantly inside one window -- every reel you swipe past
    // is a new URL -- and treating that as "you just arrived" would
    // reset the grace timer forever while you scrolled.
    const movedWindow = !this.current || payload.hwnd !== this.current.hwnd;

    this.current = payload;
    if (movedWindow) {
      this.since = Date.now();
      this.emit("change", payload);
    }
  }

  _tick() {
    if (this.current) {
      this.emit("tick", this.current, this.heldSeconds());
    }
  }
}

module.exports = { Monitor };
