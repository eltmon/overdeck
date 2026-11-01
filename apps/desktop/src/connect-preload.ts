/**
 * Preload script for the connect window (PAN-4402 W-5).
 *
 * Exposes `window.overdeckConnect`. The window runs sandboxed with context
 * isolation; every call is a fixed-channel ipcRenderer.invoke, and the main
 * process answers only this window's webContents.
 */

import { contextBridge, ipcRenderer } from "electron";

// ─── IPC channel names (must match CONNECT_IPC in connect-window.ts) ─────────

const CONNECT_IPC = {
  GET_STATE: "pan:connect-get-state",
  PAIR: "pan:connect-pair",
  OPEN_MACHINE: "pan:connect-open-machine",
  USE_LOCAL: "pan:connect-use-local",
  FORGET: "pan:connect-forget",
  STATE_CHANGED: "pan:connect-state-changed",
} as const;

contextBridge.exposeInMainWorld("overdeckConnect", {
  getState: () => ipcRenderer.invoke(CONNECT_IPC.GET_STATE),
  pair: (link: string) => ipcRenderer.invoke(CONNECT_IPC.PAIR, link),
  openMachine: () => ipcRenderer.invoke(CONNECT_IPC.OPEN_MACHINE),
  useThisComputer: () => ipcRenderer.invoke(CONNECT_IPC.USE_LOCAL),
  forget: () => ipcRenderer.invoke(CONNECT_IPC.FORGET),
  onStateChanged: (callback: () => void) => {
    ipcRenderer.on(CONNECT_IPC.STATE_CHANGED, () => callback());
  },
});
