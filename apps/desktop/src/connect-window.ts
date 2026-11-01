/**
 * The connect window: a small local page that takes a pairing link and shows
 * the chosen machine's state and errors (PAN-4402 W-5).
 *
 * It works with no server running anywhere. Its IPC handlers answer only the
 * connect window's own webContents, so a dashboard page — local or remote —
 * cannot pair, switch or forget (D-8). getState never carries the token.
 */

import * as Path from "node:path";

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";

import { resolveResourcePath } from "./main.js";

// ─── IPC channel names (must match connect-preload.ts) ───────────────────────

export const CONNECT_IPC = {
  GET_STATE: "pan:connect-get-state",
  PAIR: "pan:connect-pair",
  OPEN_MACHINE: "pan:connect-open-machine",
  USE_LOCAL: "pan:connect-use-local",
  FORGET: "pan:connect-forget",
  STATE_CHANGED: "pan:connect-state-changed",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectMachineView {
  label: string;
  baseUrl: string;
}

export interface ConnectState {
  mode: "local" | "remote";
  machine: ConnectMachineView | null;
  /** True when this computer's dashboard is not showing: remote mode, or a failed launch with no server. */
  canUseThisComputer: boolean;
  error: string | null;
}

export type ConnectActionResult = { ok: true; message?: string } | { ok: false; error: string };

export interface ConnectHandlers {
  getState(): Omit<ConnectState, "error">;
  pair(link: string): Promise<ConnectActionResult>;
  openMachine(): Promise<ConnectActionResult>;
  useLocal(): Promise<ConnectActionResult>;
  forget(): Promise<ConnectActionResult>;
}

const NOT_ALLOWED: ConnectActionResult = { ok: false, error: "not allowed" };

// ─── State ────────────────────────────────────────────────────────────────────

let connectWindow: BrowserWindow | null = null;
let lastError: string | null = null;

function fromConnectWindow(event: IpcMainInvokeEvent): boolean {
  return connectWindow !== null && !connectWindow.isDestroyed() && event.sender === connectWindow.webContents;
}

function notifyStateChanged(): void {
  if (connectWindow && !connectWindow.isDestroyed()) {
    connectWindow.webContents.send(CONNECT_IPC.STATE_CHANGED);
  }
}

async function runAction(action: () => Promise<ConnectActionResult>): Promise<ConnectActionResult> {
  try {
    const result = await action();
    lastError = result.ok ? null : result.error;
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    lastError = error;
    return { ok: false, error };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Opens the one connect window, or focuses it and shows the new error. */
export function openConnectWindow(error?: string): BrowserWindow {
  if (error !== undefined) lastError = error;

  if (connectWindow && !connectWindow.isDestroyed()) {
    notifyStateChanged();
    if (connectWindow.isMinimized()) connectWindow.restore();
    connectWindow.show();
    connectWindow.focus();
    return connectWindow;
  }

  const win = new BrowserWindow({
    width: 520,
    height: 560,
    title: "Open another machine",
    autoHideMenuBar: true,
    webPreferences: {
      preload: Path.join(__dirname, "connect-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });
  connectWindow = win;
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (connectWindow === win) connectWindow = null;
  });

  const page = resolveResourcePath("connect.html");
  if (page) void win.loadFile(page);
  else console.error("[desktop] connect.html not found");
  return win;
}

export function closeConnectWindow(): void {
  if (connectWindow && !connectWindow.isDestroyed()) connectWindow.close();
  connectWindow = null;
}

export function registerConnectIpc(handlers: ConnectHandlers): void {
  ipcMain.handle(CONNECT_IPC.GET_STATE, (event): ConnectState | ConnectActionResult => {
    if (!fromConnectWindow(event)) return NOT_ALLOWED;
    const { mode, machine, canUseThisComputer } = handlers.getState();
    // Project explicitly so nothing but label and origin reaches the renderer.
    return {
      mode,
      machine: machine ? { label: machine.label, baseUrl: machine.baseUrl } : null,
      canUseThisComputer,
      error: lastError,
    };
  });

  ipcMain.handle(CONNECT_IPC.PAIR, (event, link: unknown) => {
    if (!fromConnectWindow(event)) return NOT_ALLOWED;
    if (typeof link !== "string") return { ok: false, error: "That is not an Overdeck pairing link." };
    return runAction(() => handlers.pair(link));
  });

  ipcMain.handle(CONNECT_IPC.OPEN_MACHINE, (event) => {
    if (!fromConnectWindow(event)) return NOT_ALLOWED;
    return runAction(() => handlers.openMachine());
  });

  ipcMain.handle(CONNECT_IPC.USE_LOCAL, (event) => {
    if (!fromConnectWindow(event)) return NOT_ALLOWED;
    return runAction(() => handlers.useLocal());
  });

  ipcMain.handle(CONNECT_IPC.FORGET, (event) => {
    if (!fromConnectWindow(event)) return NOT_ALLOWED;
    return runAction(() => handlers.forget());
  });
}
