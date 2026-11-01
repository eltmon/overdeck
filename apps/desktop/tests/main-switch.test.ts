/**
 * Mode-switch tests for the desktop main process (PAN-4402 review).
 *
 * Boots main.ts on a chosen machine with Electron and the sibling modules
 * mocked. The fake BrowserWindow fires window-all-closed synchronously when
 * the last window is destroyed, as Electron 40 does, so a switch that leaves
 * no window would reach app.quit().
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  class FakeBrowserWindow {
    static all: FakeBrowserWindow[] = [];
    static getAllWindows() {
      return FakeBrowserWindow.all.filter((w) => !w.destroyed);
    }
    static getFocusedWindow() {
      return null;
    }
    destroyed = false;
    url = "";
    webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
    };
    constructor(public options: { webPreferences?: { partition?: string } }) {
      FakeBrowserWindow.all.push(this);
    }
    once() {}
    on() {}
    loadURL(url: string) {
      this.url = url;
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      if (FakeBrowserWindow.getAllWindows().length === 0) appHandlers.get("window-all-closed")?.();
    }
  }
  const cookiesSet = vi.fn(async () => undefined);
  return {
    appHandlers,
    FakeBrowserWindow,
    cookiesSet,
    app: {
      requestSingleInstanceLock: vi.fn(() => true),
      exit: vi.fn(),
      quit: vi.fn(),
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
        appHandlers.set(name, handler);
      }),
      commandLine: { appendSwitch: vi.fn() },
      getVersion: vi.fn(() => "0.0.0"),
      setAppUserModelId: vi.fn(),
      isPackaged: false,
    },
  };
});

vi.mock("electron", () => ({
  app: electron.app,
  BrowserWindow: electron.FakeBrowserWindow,
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  shell: { openExternal: vi.fn() },
  session: { fromPartition: vi.fn(() => ({ cookies: { set: electron.cookiesSet } })) },
}));

const RECORD = {
  version: 1,
  active: true,
  baseUrl: "http://100.101.102.103:3011",
  environmentId: "env-desk",
  label: "desk",
  deviceId: "dev_1",
  pairedAt: "2026-11-01T05:00:00.000Z",
  tokenCiphertext: "cipher",
};

const mocks = vi.hoisted(() => ({
  startServer: vi.fn(),
  stopServer: vi.fn(),
  openConnectWindow: vi.fn(),
  closeConnectWindow: vi.fn(),
}));

vi.mock("../src/tray.js", () => ({ createTray: vi.fn(), destroyTray: vi.fn(), refreshTrayMode: vi.fn() }));
vi.mock("../src/settings.js", () => ({
  loadDesktopSettings: vi.fn(),
  getDesktopSettings: vi.fn(),
  updateDesktopSetting: vi.fn(),
}));
vi.mock("../src/server.js", () => ({ startServer: mocks.startServer, stopServer: mocks.stopServer }));
vi.mock("../src/menu.js", () => ({ configureApplicationMenu: vi.fn(), refreshApplicationMenu: vi.fn() }));
vi.mock("../src/notifications.js", () => ({ initializeNotifications: vi.fn(), registerNotificationHandlers: vi.fn() }));
vi.mock("../src/autostart.js", () => ({ handleAutoStartNag: vi.fn() }));
vi.mock("../src/protocol.js", () => ({ registerDesktopProtocol: vi.fn() }));
vi.mock("../src/updater.js", () => ({
  initializeAutoUpdater: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  getUpdateStatus: vi.fn(),
  onUpdateStatusChange: vi.fn(),
}));
vi.mock("../src/machine-store.js", () => ({
  loadMachineRecord: vi.fn(() => RECORD),
  setMachineActive: vi.fn(),
  deleteMachineRecord: vi.fn(),
  readMachineToken: vi.fn(() => "odk_token"),
}));
vi.mock("../src/machine-client.js", () => ({
  preflightMachine: vi.fn(async () => ({ ok: true, token: "odk_token" })),
  pairWithMachine: vi.fn(),
  revokeOwnDevice: vi.fn(),
  deviceLabel: vi.fn(() => "Overdeck desktop on test"),
  lookupAllAddresses: vi.fn(),
}));
vi.mock("../src/connect-window.js", () => ({
  openConnectWindow: mocks.openConnectWindow.mockImplementation(() => new electron.FakeBrowserWindow({})),
  closeConnectWindow: mocks.closeConnectWindow,
  registerConnectIpc: vi.fn(),
}));

import { useThisComputer } from "../src/main.js";
import { getActiveDashboard } from "../src/connection.js";

function remoteMainWindow() {
  return electron.FakeBrowserWindow.getAllWindows().find(
    (w) => w.options.webPreferences?.partition === "remote-env-desk",
  );
}

beforeAll(async () => {
  electron.appHandlers.get("ready")?.();
  await vi.waitFor(() => expect(remoteMainWindow()).toBeDefined());
});

describe("main process on a chosen machine", () => {
  it("boots remote without starting the embedded server", () => {
    expect(getActiveDashboard().kind).toBe("remote");
    expect(mocks.startServer).not.toHaveBeenCalled();
  });

  it("guards navigation, redirects and child windows of the remote window", () => {
    const events = remoteMainWindow()!.webContents.on.mock.calls.map(([name]) => name);
    expect(events).toEqual(expect.arrayContaining(["will-navigate", "will-redirect", "did-create-window"]));
  });

  it("switches to this computer from the menu or tray without quitting the app", () => {
    useThisComputer();

    expect(electron.app.quit).not.toHaveBeenCalled();
    expect(remoteMainWindow()).toBeUndefined();
    expect(electron.FakeBrowserWindow.getAllWindows().length).toBeGreaterThan(0);
    expect(mocks.openConnectWindow).toHaveBeenCalled();
    expect(mocks.startServer).toHaveBeenCalledTimes(1);
    expect(getActiveDashboard()).toEqual({ kind: "local", baseUrl: "" });
  });
});
