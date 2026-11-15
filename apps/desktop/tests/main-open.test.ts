/**
 * `--open <path>` from a second launch (PAN-5349 O-D11). Electron and the
 * sibling modules are mocked like main-switch.test.ts; the app is never
 * booted, so the second-instance handler sees a pre-made window.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const ipcOn = new Map<string, (...args: unknown[]) => void>();
  class FakeBrowserWindow {
    static all: FakeBrowserWindow[] = [];
    static getAllWindows() {
      return FakeBrowserWindow.all;
    }
    static getFocusedWindow() {
      return null;
    }
    static fromWebContents = vi.fn(() => FakeBrowserWindow.all[0] ?? null);
    url = "";
    visible = false;
    show = vi.fn(() => {
      this.visible = true;
    });
    focus = vi.fn();
    loadURL = vi.fn((url: string) => {
      this.url = url;
      return Promise.resolve();
    });
    isVisible() {
      return this.visible;
    }
    isDestroyed() {
      return false;
    }
  }
  return {
    appHandlers,
    ipcOn,
    FakeBrowserWindow,
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

const connection = vi.hoisted(() => ({ kind: "local" as "local" | "remote" }));

vi.mock("electron", () => ({
  app: electron.app,
  BrowserWindow: electron.FakeBrowserWindow,
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => electron.ipcOn.set(channel, handler)),
    handle: vi.fn(),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  shell: { openExternal: vi.fn() },
  session: { fromPartition: vi.fn() },
}));
vi.mock("../src/connection.js", () => ({
  getActiveDashboard: () => (connection.kind === "remote" ? { kind: "remote", baseUrl: "http://desk:3011" } : { kind: "local", baseUrl: "" }),
  dashboardFetch: vi.fn(),
  isSameOrigin: vi.fn(() => true),
  prepareRemoteSession: vi.fn(),
  setLocalDashboard: vi.fn(),
  setRemoteDashboard: vi.fn(),
}));
vi.mock("../src/tray.js", () => ({ createTray: vi.fn(), destroyTray: vi.fn(), refreshTrayMode: vi.fn() }));
vi.mock("../src/settings.js", () => ({ loadDesktopSettings: vi.fn(), getDesktopSettings: vi.fn(), updateDesktopSetting: vi.fn() }));
vi.mock("../src/server.js", () => ({ startServer: vi.fn(), stopServer: vi.fn() }));
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
  loadMachineRecord: vi.fn(() => null),
  setMachineActive: vi.fn(),
  deleteMachineRecord: vi.fn(),
  readMachineToken: vi.fn(),
}));
vi.mock("../src/machine-client.js", () => ({
  preflightMachine: vi.fn(),
  pairWithMachine: vi.fn(),
  revokeOwnDevice: vi.fn(),
  deviceLabel: vi.fn(() => "test"),
  lookupAllAddresses: vi.fn(),
}));
vi.mock("../src/connect-window.js", () => ({ openConnectWindow: vi.fn(), closeConnectWindow: vi.fn(), registerConnectIpc: vi.fn() }));

import { parseOpenArg } from "../src/main.js";

function secondInstance(argv: string[]) {
  electron.appHandlers.get("second-instance")?.({}, argv);
}

let win: InstanceType<typeof electron.FakeBrowserWindow>;

beforeEach(() => {
  connection.kind = "local";
  electron.FakeBrowserWindow.all = [];
  win = new electron.FakeBrowserWindow();
  electron.FakeBrowserWindow.all.push(win);
});

describe("second launch with --open", () => {
  it("loads the /open link for the path in local mode", () => {
    secondInstance(["app", "--open", "/a/b"]);
    expect(win.show).toHaveBeenCalled();
    expect(win.loadURL).toHaveBeenCalledTimes(1);
    expect(win.url.endsWith("/open?path=%2Fa%2Fb")).toBe(true);
  });

  it("only shows the window without --open", () => {
    secondInstance(["app"]);
    expect(win.show).toHaveBeenCalled();
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it("only shows the window in remote mode", () => {
    connection.kind = "remote";
    secondInstance(["app", "--open", "/a/b"]);
    expect(win.focus).toHaveBeenCalled();
    expect(win.loadURL).not.toHaveBeenCalled();
  });
});

describe("parseOpenArg", () => {
  it("returns the value after --open, or null", () => {
    expect(parseOpenArg(["app", "--open", "/x"])).toBe("/x");
    expect(parseOpenArg(["app", "--open"])).toBeNull();
    expect(parseOpenArg(["app", "--open", "--other"])).toBeNull();
    expect(parseOpenArg(["app"])).toBeNull();
  });
});
