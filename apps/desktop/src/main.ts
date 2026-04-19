import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  shell,
} from "electron";

import { createTray, destroyTray } from "./tray.js";
import { loadDesktopSettings, getDesktopSettings, updateDesktopSetting } from "./settings.js";
import { startServer, stopServer } from "./server.js";
import { configureApplicationMenu } from "./menu.js";
import { initializeNotifications, registerNotificationHandlers } from "./notifications.js";
import { handleAutoStartNag } from "./autostart.js";
import { registerDesktopProtocol } from "./protocol.js";
import { initializeAutoUpdater, checkForUpdates, downloadUpdate, quitAndInstall, getUpdateStatus, onUpdateStatusChange } from "./updater.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const ROOT_DIR = Path.resolve(__dirname, "../../..");
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "Panopticon (Dev)" : "Panopticon";
const APP_ID = "com.panopticon.app";
const LINUX_WM_CLASS = isDevelopment ? "panopticon-dev" : "panopticon";
export const DESKTOP_SCHEME = "panopticon";

// IPC channel names
export const IPC = {
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
  GET_UPDATE_STATUS: "pan:get-update-status",
  CHECK_FOR_UPDATES: "pan:check-for-updates",
  DOWNLOAD_UPDATE: "pan:download-update",
  QUIT_AND_INSTALL: "pan:quit-and-install",
} as const;

// ─── State ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
export let serverPort = 0;
export let serverUrl = "";
export let serverWsUrl = "";
export let isQuitting = false;
const terminalWindows = new Map<string, BrowserWindow>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    Path.join(__dirname, "../resources", fileName),
    Path.join(process.resourcesPath ?? "", "resources", fileName),
    Path.join(ROOT_DIR, "apps/desktop/resources", fileName),
  ];
  for (const candidate of candidates) {
    if (FS.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveServerEntry(): string {
  if (!app.isPackaged) {
    return Path.join(ROOT_DIR, "dist/dashboard/server.js");
  }
  return Path.join(process.resourcesPath ?? "", "server/server.js");
}

export function resolveServerStaticDir(): string | null {
  const candidates = [
    Path.join(ROOT_DIR, "dist/dashboard/public"),
    Path.join(process.resourcesPath ?? "", "server/public"),
  ];
  for (const candidate of candidates) {
    if (FS.existsSync(Path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

export function resolveWindowUrl(): string {
  if (isDevelopment) {
    return process.env.VITE_DEV_SERVER_URL!;
  }
  return `${DESKTOP_SCHEME}://app/index.html`;
}

function createTerminalWindow(sessionName: string, title: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    title,
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  win.once("ready-to-show", () => win.show());
  void win.loadURL(`${resolveWindowUrl()}?terminal=${encodeURIComponent(sessionName)}&title=${encodeURIComponent(title)}`);
  return win;
}

// ─── IPC: basic handlers ──────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  ipcMain.on(IPC.GET_SERVER_URL, (event) => {
    event.returnValue = serverUrl;
  });

  ipcMain.on(IPC.GET_WS_URL, (event) => {
    event.returnValue = serverWsUrl;
  });

  ipcMain.handle(IPC.PICK_FOLDER, async () => {
    const { dialog } = await import("electron");
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: unknown) => {
    if (typeof url !== "string") return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle(IPC.GET_DESKTOP_SETTINGS, () => getDesktopSettings());

  ipcMain.on(IPC.OPEN_TERMINAL_WINDOW, (_event, sessionName: unknown, title: unknown) => {
    if (typeof sessionName !== "string" || typeof title !== "string") return;

    const existing = terminalWindows.get(sessionName);
    if (existing && !existing.isDestroyed()) {
      if (!existing.isVisible()) existing.show();
      existing.focus();
      return;
    }

    const win = createTerminalWindow(sessionName, title);
    terminalWindows.set(sessionName, win);
    win.on("closed", () => terminalWindows.delete(sessionName));
  });

  ipcMain.on(IPC.SET_ALWAYS_ON_TOP, (_event, value: unknown) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.setAlwaysOnTop(value === true);
    }
  });

  ipcMain.handle(IPC.UPDATE_DESKTOP_SETTING, (_event, key: unknown, value: unknown) => {
    if (typeof key !== "string") return;
    const updated = updateDesktopSetting(key, value);
    // Apply auto-start setting immediately
    if (updated && key === "autoStart.enabled") {
      app.setLoginItemSettings({ openAtLogin: value === true });
    }
  });

  // Update IPC handlers
  ipcMain.handle(IPC.GET_UPDATE_STATUS, () => getUpdateStatus());

  ipcMain.handle(IPC.CHECK_FOR_UPDATES, async () => {
    try {
      await checkForUpdates();
    } catch (err) {
      console.error("[main] checkForUpdates failed:", err);
    }
    return getUpdateStatus();
  });

  ipcMain.handle(IPC.DOWNLOAD_UPDATE, async () => {
    try {
      await downloadUpdate();
    } catch (err) {
      console.error("[main] downloadUpdate failed:", err);
    }
    return getUpdateStatus();
  });

  ipcMain.on(IPC.QUIT_AND_INSTALL, () => {
    quitAndInstall();
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_DISPLAY_NAME,
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  win.once("ready-to-show", () => win.show());

  win.on("close", (event) => {
    if (!isQuitting && process.platform === "darwin") {
      event.preventDefault();
      win.hide();
    }
  });

  void win.loadURL(resolveWindowUrl());
  return win;
}

export function showOrCreateWindow(): void {
  const existing =
    BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (existing) {
    if (!existing.isVisible()) existing.show();
    existing.focus();
    return;
  }
  mainWindow = createWindow();
}

export function dispatchMenuAction(action: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (!win) {
    showOrCreateWindow();
    setTimeout(() => dispatchMenuAction(action), 500);
    return;
  }
  const send = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(IPC.MENU_ACTION, action);
    if (!win.isVisible()) win.show();
    win.focus();
  };
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

// ─── Server API helper ────────────────────────────────────────────────────────

export function callServerApi(path: string, method: string): void {
  if (!serverUrl) return;
  fetch(`${serverUrl}${path}`, { method }).catch((err: unknown) => {
    console.error("[desktop] server API call failed:", err);
  });
}

// ─── Protocol registration (before app.ready) ─────────────────────────────────

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

if (process.platform === "linux") {
  app.commandLine.appendSwitch("class", LINUX_WM_CLASS);
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.on("ready", () => {
  loadDesktopSettings();
  registerIpcHandlers();
  registerNotificationHandlers();
  initializeNotifications();
  configureApplicationMenu();
  registerDesktopProtocol();
  const updateChannel = app.getVersion().includes("-canary") ? "beta" : "latest";
  initializeAutoUpdater(updateChannel);

  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
  }

  if (process.platform === "darwin" && app.dock) {
    const iconPath = resolveResourcePath("icon.png");
    if (iconPath) app.dock.setIcon(iconPath);
  }

  createTray();

  startServer((port, wsUrl) => {
    serverPort = port;
    serverUrl = `http://127.0.0.1:${port}`;
    serverWsUrl = wsUrl;
    mainWindow = createWindow();
    handleAutoStartNag();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    isQuitting = true;
    app.quit();
  }
});

app.on("activate", () => showOrCreateWindow());

app.on("before-quit", () => {
  isQuitting = true;
  destroyTray();
  stopServer();
});
