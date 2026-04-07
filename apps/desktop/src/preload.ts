import { contextBridge, ipcRenderer } from "electron";

// Stub preload — full IPC bridge implemented in ckt bead.
// Exposes panopticonBridge with isDesktopApp() so the renderer can detect Electron mode.

contextBridge.exposeInMainWorld("panopticonBridge", {
  isDesktopApp: () => true,
});

declare global {
  interface Window {
    panopticonBridge?: { isDesktopApp(): boolean };
  }
}
