"use strict";

/* ------------------------------------------------------------------
   enforcer.js — the paw
   ------------------------------------------------------------------
   Runs close-target.ps1, which re-checks that the offending window is
   still in front before it does anything. If you alt-tabbed away during
   the countdown, nothing happens and this resolves with acted:false.
------------------------------------------------------------------ */

const { execFile } = require("child_process");
const path = require("path");

function closeTarget(target, mode) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, "scripts", "close-target.ps1");

    // Only the tail of the title is used for the re-check: browsers
    // rewrite the leading part (unread counts, "(2) ...") constantly.
    const expect = String(target.title || "").slice(-40);

    execFile("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", script,
      "-Hwnd", String(target.hwnd),
      "-Mode", mode === "close" ? "close" : "tab",
      "-ExpectTitle", expect
    ], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      let parsed = null;
      try { parsed = JSON.parse(String(stdout).trim()); } catch (_) { /* ignore */ }

      if (err && (!parsed || parsed.ok !== false)) {
        resolve({ acted: false, reason: "error", detail: err.message });
        return;
      }
      if (parsed && parsed.ok === false) {
        resolve({ acted: false, reason: parsed.reason || "skipped" });
        return;
      }
      resolve({ acted: true, mode: parsed ? parsed.mode : mode });
    });
  });
}

module.exports = { closeTarget };
