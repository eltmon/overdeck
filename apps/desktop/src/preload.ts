/**
 * Preload script for the Panopticon Electron renderer.
 *
 * Exposes `window.panopticonBridge` via contextBridge.exposeInMainWorld.
 * The renderer uses this bridge to communicate with the main process over IPC.
 *
 * Security model:
 *   - contextIsolation: true — renderer JS cannot access Node.js APIs
 *   - sandbox: false — allows contextBridge to expose typed APIs
 *   - All IPC channels are explicitly listed; no dynamic channel names
 *   - External URL validation happens in the main process (ipcMain.handle)
 */

import { contextBridge, ipcRenderer } from "electron";

// ─── IPC channel names (must match main.ts IPC constants) ────────────────────

const IPC = {
  GET_SERVER_URL: "pan:get-server-url",
  GET_WS_URL: "pan:get-ws-url",
  PICK_FOLDER: "pan:pick-folder",
  OPEN_EXTERNAL: "pan:open-external",
  OPEN_TERMINAL_WINDOW: "pan:open-terminal-window",
  SET_ALWAYS_ON_TOP: "pan:set-always-on-top",
  MENU_ACTION: "pan:menu-action",
  GET_DESKTOP_SETTINGS: "pan:get-desktop-settings",
  UPDATE_DESKTOP_SETTING: "pan:update-desktop-setting",
  NOTIFY: "pan:notify",
  RESTART_DASHBOARD: "pan:restart-dashboard",
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DesktopSettings {
  tray: {
    showBadge: boolean;
    tooltipDetail: "minimal" | "full";
  };
  notifications: {
    inputNeeded: boolean;
    stuckAgents: boolean;
    mergeFailures: boolean;
    workComplete: boolean;
    planningDone: boolean;
    mergeReady: boolean;
  };
  autoStart: {
    enabled: boolean;
    nagCount: number;
    nagDismissed: boolean;
  };
}

export type NotificationEventType = keyof DesktopSettings["notifications"];

export interface PanopticonBridge {
  /** Returns true — used by renderer to detect desktop vs browser mode */
  isDesktopApp(): boolean;

  /** Returns base HTTP server URL (e.g. "http://127.0.0.1:7825"), or null */
  getServerUrl(): string | null;

  /** Returns base WebSocket URL (e.g. "ws://127.0.0.1:7825"), or null */
  getWsUrl(): string | null;

  /** Opens a native folder-picker dialog */
  pickFolder(): Promise<string | null>;

  /** Opens a URL in the default browser (https/http only) */
  openExternal(url: string): Promise<void>;

  /** Opens the current terminal in a dedicated desktop window. */
  openTerminalWindow(sessionName: string, title: string): void;

  /** Toggles always-on-top for the focused terminal window. */
  setAlwaysOnTop(value: boolean): void;

  /**
   * Registers a listener for menu actions dispatched from the main process.
   * Returns an unsubscribe function.
   *
   * Actions: "open-settings", "open-workspace:<issueId>",
   *          "auto-start-nag:<count>:<max>", ...
   */
  onMenuAction(listener: (action: string) => void): () => void;

  /** Gets all desktop-specific settings */
  getDesktopSettings(): Promise<DesktopSettings>;

  /**
   * Updates a single desktop setting by dotted key path.
   * e.g. updateDesktopSetting("notifications.inputNeeded", true)
   */
  updateDesktopSetting(key: string, value: unknown): Promise<void>;

  /**
   * Sends a native OS notification (if permitted by per-event-type settings).
   */
  notify(eventType: NotificationEventType, title: string, body: string): Promise<void>;

  /** Stops and restarts the embedded dashboard server in the main process. */
  restartDashboard(): Promise<void>;
}

// ─── Bridge implementation ────────────────────────────────────────────────────

const bridge: PanopticonBridge = {
  isDesktopApp: () => true,

  getServerUrl: () => {
    const result = ipcRenderer.sendSync(IPC.GET_SERVER_URL);
    return typeof result === "string" ? result : null;
  },

  getWsUrl: () => {
    const result = ipcRenderer.sendSync(IPC.GET_WS_URL);
    return typeof result === "string" ? result : null;
  },

  pickFolder: () =>
    ipcRenderer.invoke(IPC.PICK_FOLDER) as Promise<string | null>,

  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url) as Promise<void>,

  openTerminalWindow: (sessionName: string, title: string) => {
    ipcRenderer.send(IPC.OPEN_TERMINAL_WINDOW, sessionName, title);
  },

  setAlwaysOnTop: (value: boolean) => {
    ipcRenderer.send(IPC.SET_ALWAYS_ON_TOP, value);
  },

  onMenuAction: (listener: (action: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action === "string") listener(action);
    };
    ipcRenderer.on(IPC.MENU_ACTION, wrapped);
    return () => ipcRenderer.removeListener(IPC.MENU_ACTION, wrapped);
  },

  getDesktopSettings: () =>
    ipcRenderer.invoke(IPC.GET_DESKTOP_SETTINGS) as Promise<DesktopSettings>,

  updateDesktopSetting: (key: string, value: unknown) =>
    ipcRenderer.invoke(IPC.UPDATE_DESKTOP_SETTING, key, value) as Promise<void>,

  notify: (eventType: NotificationEventType, title: string, body: string) =>
    ipcRenderer.invoke(IPC.NOTIFY, eventType, title, body) as Promise<void>,

  restartDashboard: () =>
    ipcRenderer.invoke(IPC.RESTART_DASHBOARD) as Promise<void>,
};

contextBridge.exposeInMainWorld("panopticonBridge", bridge);

// ─── Global type augmentation (consumed by renderer TypeScript) ───────────────

declare global {
  interface Window {
    panopticonBridge?: PanopticonBridge;
  }
}
