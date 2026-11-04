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

import { createTray, destroyTray, refreshTrayMode } from "./tray.js";
import { loadDesktopSettings, getDesktopSettings, updateDesktopSetting } from "./settings.js";
import { startServer, stopServer } from "./server.js";
import { configureApplicationMenu, refreshApplicationMenu } from "./menu.js";
import { initializeNotifications, registerNotificationHandlers } from "./notifications.js";
import { handleAutoStartNag } from "./autostart.js";
import { registerDesktopProtocol } from "./protocol.js";
import { initializeAutoUpdater, checkForUpdates, downloadUpdate, quitAndInstall, getUpdateStatus, onUpdateStatusChange } from "./updater.js";
import { planBoot } from "./boot.js";
import {
  type MachineRecord,
  deleteMachineRecord,
  loadMachineRecord,
  readMachineToken,
  setMachineActive,
} from "./machine-store.js";
import {
  type MachineClientDeps,
  deviceLabel,
  lookupAllAddresses,
  pairWithMachine,
  preflightMachine,
  revokeOwnDevice,
} from "./machine-client.js";
import {
  dashboardFetch,
  getActiveDashboard,
  isSameOrigin,
  prepareRemoteSession,
  setLocalDashboard,
  setRemoteDashboard,
} from "./connection.js";
import {
  type ConnectActionResult,
  closeConnectWindow,
  openConnectWindow,
  registerConnectIpc,
} from "./connect-window.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const ROOT_DIR = Path.resolve(__dirname, "../../..");
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "Overdeck (Dev)" : "Overdeck";
const APP_ID = "com.overdeck.app";
const LINUX_WM_CLASS = isDevelopment ? "overdeck-dev" : "overdeck";
export const DESKTOP_SCHEME = "overdeck";

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
  RESTART_DASHBOARD: "pan:restart-dashboard",
} as const;

// ─── State ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
export let serverPort = 0;
export let serverUrl = "";
export let serverWsUrl = "";
export let isQuitting = false;
const terminalWindows = new Map<string, BrowserWindow>();
let localServerStarted = false;
let autoStartNagHandled = false;
/** Set by Use This Computer: close the connect window once the local window opens. */
let closeConnectWhenLocalReady = false;

const machineClientDeps: MachineClientDeps = {
  fetchImpl: (input, init) => fetch(input, init),
  lookupAll: lookupAllAddresses,
};

// ─── Single instance lock ─────────────────────────────────────────────────────
// A second launch must not boot another full app (window, tray, embedded
// server). Duplicates exit immediately and the running instance is focused
// via the second-instance event below (PAN-2559).

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

app.on("second-instance", () => showOrCreateWindow());

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function resolveResourcePath(fileName: string): string | null {
  const candidates = [
    // Packaged (electron-builder): resources are in process.resourcesPath/resources/
    Path.join(process.resourcesPath ?? "", "resources", fileName),
    // npx / global-install: resources are bundled at <package>/resources/
    Path.join(__dirname, "../resources", fileName),
    // Dev: resources are in the monorepo
    Path.join(ROOT_DIR, "apps/desktop/resources", fileName),
  ];
  for (const candidate of candidates) {
    if (FS.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveServerEntry(): string {
  if (app.isPackaged) {
    return Path.join(process.resourcesPath ?? "", "server/server.js");
  }
  // npx / global-install: server bundle is at <package>/server/server.js
  const npxBundle = Path.join(__dirname, "../server/server.js");
  if (FS.existsSync(npxBundle)) return npxBundle;
  // Dev mode: server is built in the monorepo root
  return Path.join(ROOT_DIR, "dist/dashboard/server.js");
}

export function resolveServerStaticDir(): string | null {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(Path.join(process.resourcesPath ?? "", "server/public"));
  } else {
    // npx / global-install: static assets are at <package>/server/public
    candidates.push(Path.join(__dirname, "../server/public"));
    // Dev mode fallback
    candidates.push(Path.join(ROOT_DIR, "dist/dashboard/public"));
  }
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
  // Remote mode loads the chosen machine's own origin, so the unchanged
  // frontend's relative fetches and sockets reach that machine (PAN-4402 D-2).
  const active = getActiveDashboard();
  if (active.kind === "remote") {
    return active.baseUrl;
  }
  // Serve the window from the embedded server's HTTP origin so the frontend's
  // relative /api fetches and /ws/* sockets are same-origin, exactly like the
  // browser dashboard. The overdeck:// protocol page has no working data
  // layer (relative fetches resolve to the app bundle, PAN-2561) — it is only
  // the pre-server fallback.
  if (serverUrl) {
    return serverUrl;
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
      ...remotePartitionPreference(),
    },
    show: false,
  });

  guardRemoteNavigation(win);
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
    await openExternalSafe(url);
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

  ipcMain.handle(IPC.RESTART_DASHBOARD, async () => {
    const active = getActiveDashboard();
    if (active.kind === "remote") {
      throw new Error(`This window shows ${active.label}. Restart its dashboard on that machine.`);
    }
    console.log("[main] manual dashboard restart requested");
    stopServer();
    // Brief delay so SIGTERM has a chance to land before we re-spawn.
    await new Promise((resolve) => setTimeout(resolve, 500));
    startServer((port, wsUrl) => {
      serverPort = port;
      serverUrl = `http://127.0.0.1:${port}`;
      serverWsUrl = wsUrl;
      setLocalDashboard(serverUrl);
      console.log(`[main] dashboard restarted on ${serverUrl}`);
    });
  });

  registerConnectIpc({
    getState: () => {
      const record = loadMachineRecord();
      return {
        mode: getActiveDashboard().kind,
        machine: record ? { label: record.label, baseUrl: record.baseUrl } : null,
        canUseThisComputer: getActiveDashboard().kind === "remote" || !localServerStarted,
      };
    },
    pair: async (link) => {
      const result = await pairWithMachine(link, machineClientDeps);
      if (!result.ok) return result;
      return openRemoteDashboard(result.record);
    },
    openMachine: async () => {
      const record = loadMachineRecord();
      if (!record) return { ok: false, error: "No machine is paired with this computer." };
      return openRemoteDashboard(record);
    },
    useLocal: async () => switchToLocal({ closeConnectWindow: true }),
    forget: async () => forgetMachine(),
  });
}

// ─── Remote mode (PAN-4402) ───────────────────────────────────────────────────

async function openExternalSafe(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
  await shell.openExternal(parsed.toString());
}

function remotePartitionPreference(): { partition?: string } {
  const active = getActiveDashboard();
  return active.kind === "remote" ? { partition: active.partition } : {};
}

/** D-9: a remote window stays on the chosen machine; other origins open in the browser. */
function guardRemoteNavigation(win: BrowserWindow): void {
  const active = getActiveDashboard();
  if (active.kind !== "remote") return;
  const base = active.baseUrl;
  const keepOnMachine = (event: { url: string; preventDefault(): void }) => {
    if (isSameOrigin(event.url, base)) return;
    event.preventDefault();
    void openExternalSafe(event.url);
  };
  win.webContents.on("will-navigate", keepOnMachine);
  win.webContents.on("will-redirect", keepOnMachine);
  win.webContents.on("did-create-window", (child) => guardRemoteNavigation(child));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, base)) return { action: "allow" };
    void openExternalSafe(url);
    return { action: "deny" };
  });
}

/** A window's partition cannot change, so a mode switch recreates every dashboard window (H-4). */
function destroyDashboardWindows(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  mainWindow = null;
  for (const win of terminalWindows.values()) {
    if (!win.isDestroyed()) win.destroy();
  }
  terminalWindows.clear();
}

function refreshModeUi(): void {
  refreshApplicationMenu();
  refreshTrayMode();
}

function startLocalServer(): void {
  localServerStarted = true;
  startServer(onLocalServerReady);
}

function stopLocalServer(): void {
  localServerStarted = false;
  stopServer();
}

function handleAutoStartNagOnce(): void {
  if (autoStartNagHandled) return;
  autoStartNagHandled = true;
  handleAutoStartNag();
}

function onLocalServerReady(port: number, wsUrl: string): void {
  serverPort = port;
  serverUrl = `http://127.0.0.1:${port}`;
  serverWsUrl = wsUrl;
  // A late callback after a switch to remote mode must not repoint anything.
  if (getActiveDashboard().kind === "remote") return;
  setLocalDashboard(serverUrl);
  // The ready callback fires again after every server crash-restart. One
  // window per callback multiplied windows under a crash loop (PAN-2570) —
  // reuse the existing window and repoint it at the current server URL.
  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(resolveWindowUrl());
    return;
  }
  mainWindow = createWindow();
  handleAutoStartNagOnce();
  if (closeConnectWhenLocalReady) {
    closeConnectWhenLocalReady = false;
    closeConnectWindow();
  }
}

/** D-6: preflight first; only a 200 session mint stops the local server and opens the machine. */
async function openRemoteDashboard(record: MachineRecord): Promise<ConnectActionResult> {
  const result = await preflightMachine(record, machineClientDeps);
  if (!result.ok) {
    openConnectWindow(result.error);
    return { ok: false, error: result.error };
  }

  const previous = getActiveDashboard();
  setRemoteDashboard(record, result.token);
  const active = getActiveDashboard();
  try {
    if (active.kind === "remote") await prepareRemoteSession(active);
  } catch (err) {
    if (previous.kind === "local") setLocalDashboard(previous.baseUrl);
    const error = err instanceof Error ? err.message : String(err);
    openConnectWindow(error);
    return { ok: false, error };
  }

  stopLocalServer();
  setMachineActive(true);
  closeConnectWhenLocalReady = false;
  destroyDashboardWindows();
  mainWindow = createWindow();
  handleAutoStartNagOnce();
  closeConnectWindow();
  refreshModeUi();
  return { ok: true };
}

/**
 * Use This Computer: mark the record inactive and run the embedded server.
 * The connect window stays open until the local window exists, so closing it
 * never leaves the app with no window (window-all-closed would quit).
 */
function switchToLocal(options: { closeConnectWindow: boolean }): ConnectActionResult {
  setMachineActive(false);
  if (getActiveDashboard().kind === "local" && localServerStarted) {
    if (options.closeConnectWindow) closeConnectWindow();
    refreshModeUi();
    return { ok: true };
  }
  // The connect window is the one window that survives the switch. From the
  // menu or tray no window would be left, and window-all-closed quits the app
  // on Linux and Windows; the window closes again once the local window opens.
  openConnectWindow();
  destroyDashboardWindows();
  serverUrl = "";
  setLocalDashboard("");
  closeConnectWhenLocalReady = options.closeConnectWindow;
  startLocalServer();
  refreshModeUi();
  return { ok: true };
}

/** FR-9: best-effort self-revoke, then delete the record whatever the result. */
async function forgetMachine(): Promise<ConnectActionResult> {
  const record = loadMachineRecord();
  if (!record) return switchToLocal({ closeConnectWindow: false });

  let revoked = false;
  try {
    revoked = await revokeOwnDevice(record, readMachineToken(record), machineClientDeps);
  } catch {
    revoked = false;
  }
  deleteMachineRecord();
  switchToLocal({ closeConnectWindow: false });
  if (revoked) return { ok: true };
  return {
    ok: true,
    message: `Removed from this computer. ${record.label} could not be reached; revoke "${deviceLabel()}" in its Settings → Anywhere → Devices.`,
  };
}

export function openConnectWindowFromMenu(): void {
  openConnectWindow();
}

export function useThisComputer(): void {
  switchToLocal({ closeConnectWindow: true });
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
      ...remotePartitionPreference(),
    },
    show: false,
  });

  guardRemoteNavigation(win);
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
  if (!getActiveDashboard().baseUrl) return;
  dashboardFetch(path, { method }).catch((err: unknown) => {
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

  // D-7: with an active chosen machine the embedded server never starts.
  const plan = planBoot(loadMachineRecord(), isDevelopment);
  if (plan.kind === "remote") void openRemoteDashboard(plan.record);
  else startLocalServer();
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
