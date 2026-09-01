"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/* The overlay renderer gets exactly these five calls and nothing else:
   no node, no fs, no direct window control. */
contextBridge.exposeInMainWorld("morphcat", {
  /* main -> renderer */
  onBust: (cb) => ipcRenderer.on("bust", (_e, payload) => cb(payload)),
  onStatus: (cb) => ipcRenderer.on("status", (_e, payload) => cb(payload)),

  /* renderer -> main */
  act: (target, mode) => ipcRenderer.invoke("act", { target, mode }),
  snooze: () => ipcRenderer.invoke("snooze"),

  /* click-through toggle: the overlay is transparent to the mouse
     except while the pointer is actually over the cat or its bubble */
  setInteractive: (on) => ipcRenderer.send("set-interactive", !!on)
});
